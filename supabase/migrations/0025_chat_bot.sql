-- 0025: the bot as a full game client in private chats and groups.
--
-- tg_rpc() lets the bot call ANY player RPC (exactly the set the browser may call: functions
-- `authenticated` can execute) as the player linked to a Telegram id. Rules, locks, idempotency
-- and admin role checks stay inside those functions, so the bot cannot do more than the same
-- player could do in the browser. Plus: chats and their members (chat top), PvP duels settled
-- atomically in SQL, party games (Mafia, Spy, Crocodile) with a pg_cron tick for timeouts,
-- and a small capped reward for party winners.
--
-- Additive only. Rollback: select cron.unschedule('telegram-bot-tick'); drop the tg_* functions
-- added here and tables tg_party_games, tg_duels, tg_chat_members, tg_chats;
-- delete from economy_settings where key in ('party_reward','party_rewards_per_day','duel_min_bet').

-- ------------------------------------------------------------ RPC bridge ----
create or replace function public.tg_rpc(p_tg bigint, p_fn text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.tg_user(p_tg);
  v_oid oid; v_set boolean; v_n integer; v_names text[]; v_types oid[];
  v_args text := ''; v_val text; k text; r jsonb;
begin
  if uid is null then raise exception 'telegram_not_linked'; end if;
  p_args := coalesce(p_args, '{}'::jsonb);
  -- Only functions a signed-in player may call from the browser.
  select p.oid, p.proretset, p.pronargs, p.proargnames,
         (select array_agg(t order by o) from unnest(p.proargtypes) with ordinality as a(t, o))
    into v_oid, v_set, v_n, v_names, v_types
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn and has_function_privilege('authenticated', p.oid, 'execute');
  if v_oid is null then raise exception 'unknown_operation'; end if;
  for i in 1 .. v_n loop
    k := v_names[i];
    if p_args ? k then
      v_val := case jsonb_typeof(p_args -> k)
                 when 'null' then null
                 when 'object' then (p_args -> k)::text
                 when 'array' then (p_args -> k)::text
                 else p_args ->> k end;
      -- Arrays of ids (notifications_mark_read) arrive as JSON arrays: convert to the SQL array literal.
      if jsonb_typeof(p_args -> k) = 'array' and format_type(v_types[i], null) <> 'jsonb' then
        v_val := '{' || coalesce((select string_agg(e, ',') from jsonb_array_elements_text(p_args -> k) e), '') || '}';
      end if;
      v_args := v_args || case when v_args = '' then '' else ', ' end
                || format('%I => %L::%s', k, v_val, format_type(v_types[i], null));
    end if;
  end loop;

  -- The same identity the API gateway gives this player's browser session.
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  update public.telegram_accounts set last_seen_at = now() where user_id = uid;

  if v_set then
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I(%s) x', p_fn, v_args) into r;
  else
    execute format('select to_jsonb(public.%I(%s))', p_fn, v_args) into r;
  end if;
  return r;
end $$;

-- ----------------------------------------------------------------- chats ----
create table public.tg_chats (
  chat_id      bigint primary key,
  title        text,
  type         text not null,
  -- casino: betting games allowed in this chat; party: Mafia/Spy/Crocodile/duels allowed.
  settings     jsonb not null default '{"casino": true, "party": true}'::jsonb,
  active       boolean not null default true,
  added_at     timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.tg_chat_members (
  chat_id      bigint not null references public.tg_chats(chat_id) on delete cascade,
  telegram_id  bigint not null,
  last_seen_at timestamptz not null default now(),
  primary key (chat_id, telegram_id)
);
create index tg_chat_members_tg on public.tg_chat_members (telegram_id);

create or replace function public.tg_chat_seen(p_chat bigint, p_title text, p_type text, p_tg bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  insert into public.tg_chats (chat_id, title, type) values (p_chat, left(p_title, 128), p_type)
  on conflict (chat_id) do update set title = excluded.title, type = excluded.type, active = true, last_seen_at = now()
  returning settings into v;
  if p_tg is not null and p_tg > 0 then
    insert into public.tg_chat_members (chat_id, telegram_id) values (p_chat, p_tg)
    on conflict (chat_id, telegram_id) do update set last_seen_at = now();
  end if;
  return v;
end $$;

create or replace function public.tg_chat_set(p_chat bigint, p_key text, p_value boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_key not in ('casino', 'party') then raise exception 'invalid_choice'; end if;
  update public.tg_chats set settings = settings || jsonb_build_object(p_key, p_value) where chat_id = p_chat returning settings into v;
  if v is null then raise exception 'not_found'; end if;
  return v;
end $$;

create or replace function public.tg_chat_left(p_chat bigint)
returns void language sql security definer set search_path = public as $$
  update public.tg_chats set active = false where chat_id = p_chat;
$$;

-- Richest players among the members of one chat.
create or replace function public.tg_chat_top(p_chat bigint, p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('rank', rn, 'game_name', game_name, 'total_capital', cap) order by rn), '[]'::jsonb)
    from (select p.game_name, public._capital(p.id) cap, row_number() over (order by public._capital(p.id) desc) rn
            from public.tg_chat_members m
            join public.telegram_accounts t on t.telegram_id = m.telegram_id
            join public.profiles p on p.id = t.user_id
           where m.chat_id = p_chat and p.status = 'active') s
   where rn <= least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- Game names of Telegram users (for replies: "перевод 1000" in reply to someone's message).
create or replace function public.tg_game_name(p_tg bigint)
returns text language sql stable security definer set search_path = public as $$
  select p.game_name from public.telegram_accounts t join public.profiles p on p.id = t.user_id where t.telegram_id = p_tg;
$$;

-- Linked Telegram ids for broadcasts from the bot's admin panel (admin role checked here).
create or replace function public.tg_broadcast_targets(p_admin_tg bigint)
returns bigint[] language plpgsql stable security definer set search_path = public as $$
begin
  if public._admin_role(public.tg_user(p_admin_tg)) not in ('owner', 'admin') or public.tg_user(p_admin_tg) is null then
    raise exception 'forbidden';
  end if;
  return (select coalesce(array_agg(t.telegram_id), '{}') from public.telegram_accounts t
            join public.profiles p on p.id = t.user_id where p.status = 'active');
end $$;

-- ---------------------------------------------------------------- duels ----
insert into public.economy_settings (key, value, description) values
  ('duel_min_bet',          100.00, 'Telegram: минимальная ставка дуэли'),
  ('party_reward',        10000.00, 'Telegram: награда каждому победителю Мафии/Шпиона/Крокодила'),
  ('party_rewards_per_day',   5.00, 'Telegram: сколько наград за мини-игры игрок может получить в сутки')
on conflict (key) do nothing;

create table public.tg_duels (
  id         uuid primary key default gen_random_uuid(),
  chat_id    bigint not null,
  a_user     uuid not null references public.profiles(id) on delete cascade,
  b_user     uuid references public.profiles(id) on delete cascade,
  amount     numeric(18,2) not null check (amount > 0),
  status     text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  winner     uuid,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index tg_duels_open on public.tg_duels (a_user) where status = 'open';

create or replace function public.tg_duel_create(p_tg bigint, p_chat bigint, p_amount numeric, p_target_tg bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a uuid := public.tg_user(p_tg); b uuid; v_id uuid;
begin
  if a is null then raise exception 'telegram_not_linked'; end if;
  if p_amount is null or p_amount < public._setting('duel_min_bet') or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  if p_target_tg is not null then
    b := public.tg_user(p_target_tg);
    if b is null then raise exception 'player_not_found'; end if;
    if b = a then raise exception 'duel_self'; end if;
  end if;
  if (select status from public.profiles where id = a) <> 'active' then raise exception 'account_restricted'; end if;
  if (select cash from public.wallets where user_id = a) < p_amount then raise exception 'insufficient_funds'; end if;
  -- One open duel per player; stale ones expire after 10 minutes.
  update public.tg_duels set status = 'cancelled', settled_at = now()
   where a_user = a and status = 'open' and created_at < now() - interval '10 minutes';
  if exists (select 1 from public.tg_duels where a_user = a and status = 'open') then raise exception 'duel_pending'; end if;
  insert into public.tg_duels (chat_id, a_user, b_user, amount) values (p_chat, a, b, p_amount) returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount', p_amount, 'a_name', (select game_name from public.profiles where id = a),
    'b_name', (select game_name from public.profiles where id = b));
end $$;

-- Accepting settles the duel at once: both stakes are checked under row locks, the loser pays the
-- winner in one transaction, each leg with its own idempotency key.
create or replace function public.tg_duel_accept(p_id uuid, p_tg bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.tg_duels; b uuid := public.tg_user(p_tg); w uuid; l uuid; v_name_a text; v_name_b text;
begin
  if b is null then raise exception 'telegram_not_linked'; end if;
  select * into d from public.tg_duels where id = p_id for update;
  if not found or d.status <> 'open' then raise exception 'duel_closed'; end if;
  if d.created_at < now() - interval '10 minutes' then
    update public.tg_duels set status = 'cancelled', settled_at = now() where id = p_id;
    raise exception 'duel_closed';
  end if;
  if b = d.a_user then raise exception 'duel_self'; end if;
  if d.b_user is not null and d.b_user <> b then raise exception 'duel_not_for_you'; end if;
  -- Lock both players in a fixed order so two duels between the same pair cannot deadlock.
  perform 1 from public.profiles where id in (d.a_user, b) order by id for update;
  if exists (select 1 from public.profiles where id in (d.a_user, b) and status <> 'active') then raise exception 'account_restricted'; end if;
  if (select cash from public.wallets where user_id = d.a_user) < d.amount then raise exception 'opponent_insufficient_funds'; end if;
  if (select cash from public.wallets where user_id = b) < d.amount then raise exception 'insufficient_funds'; end if;
  if public._rand() < 0.5 then w := d.a_user; l := b; else w := b; l := d.a_user; end if;
  select game_name into v_name_a from public.profiles where id = w;
  select game_name into v_name_b from public.profiles where id = l;
  perform public._apply_wallet_change(l, 'cash', -d.amount, 'duel_loss', 'Дуэль: проигрыш ' || v_name_a,
    'duel:' || p_id || ':loss', w, 'duel', p_id::text, null);
  perform public._apply_wallet_change(w, 'cash', d.amount, 'duel_win', 'Дуэль: победа над ' || v_name_b,
    'duel:' || p_id || ':win', l, 'duel', p_id::text, null);
  update public.tg_duels set status = 'done', b_user = b, winner = w, settled_at = now() where id = p_id;
  return jsonb_build_object('status', 'ok', 'amount', d.amount, 'winner', v_name_a, 'loser', v_name_b);
end $$;

create or replace function public.tg_duel_cancel(p_id uuid, p_tg bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.tg_duels set status = 'cancelled', settled_at = now()
   where id = p_id and status = 'open' and a_user = public.tg_user(p_tg);
  if not found then raise exception 'duel_closed'; end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------- party games ----
create table public.tg_party_games (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  kind        text not null check (kind in ('mafia', 'spy', 'crocodile')),
  phase       text not null,
  state       jsonb not null default '{}'::jsonb,
  deadline    timestamptz,
  message_id  bigint,
  version     integer not null default 0,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
-- One running party game per chat.
create unique index tg_party_games_active on public.tg_party_games (chat_id) where finished_at is null;
create index tg_party_games_deadline on public.tg_party_games (deadline) where finished_at is null;

-- Pays the configured reward to each linked winner, at most N rewards per player per day.
create or replace function public.tg_party_reward(p_game uuid, p_tgs bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tg bigint; uid uuid; v_amt numeric := public._setting('party_reward'); v_paid jsonb := '[]'::jsonb; g public.tg_party_games;
begin
  select * into g from public.tg_party_games where id = p_game;
  if not found or g.finished_at is null then raise exception 'not_found'; end if;
  if v_amt <= 0 then return v_paid; end if;
  foreach v_tg in array coalesce(p_tgs, '{}') loop
    uid := public.tg_user(v_tg);
    continue when uid is null;
    perform 1 from public.profiles where id = uid and status = 'active' for update;
    continue when not found;
    continue when (select count(*) from public.ledger_entries where user_id = uid and op_type = 'party_reward'
                     and created_at > now() - interval '24 hours') >= public._setting('party_rewards_per_day');
    continue when exists (select 1 from public.ledger_entries where idempotency_key = 'party:' || p_game || ':' || uid);
    perform public._apply_wallet_change(uid, 'cash', v_amt, 'party_reward', 'Победа в мини-игре: ' || g.kind,
      'party:' || p_game || ':' || uid, null, 'party', p_game::text, null);
    v_paid := v_paid || to_jsonb(v_tg);
  end loop;
  return jsonb_build_object('amount', v_amt, 'paid', v_paid);
end $$;

-- ------------------------------------------------------------- grants ----
revoke all on function public.tg_rpc(bigint, text, jsonb), public.tg_chat_seen(bigint, text, text, bigint),
  public.tg_chat_set(bigint, text, boolean), public.tg_chat_left(bigint), public.tg_chat_top(bigint, integer),
  public.tg_game_name(bigint), public.tg_broadcast_targets(bigint), public.tg_duel_create(bigint, bigint, numeric, bigint),
  public.tg_duel_accept(uuid, bigint), public.tg_duel_cancel(uuid, bigint), public.tg_party_reward(uuid, bigint[])
  from public, anon, authenticated;
grant execute on function public.tg_rpc(bigint, text, jsonb), public.tg_chat_seen(bigint, text, text, bigint),
  public.tg_chat_set(bigint, text, boolean), public.tg_chat_left(bigint), public.tg_chat_top(bigint, integer),
  public.tg_game_name(bigint), public.tg_broadcast_targets(bigint), public.tg_duel_create(bigint, bigint, numeric, bigint),
  public.tg_duel_accept(uuid, bigint), public.tg_duel_cancel(uuid, bigint), public.tg_party_reward(uuid, bigint[])
  to service_role;

alter table public.tg_chats        enable row level security;
alter table public.tg_chat_members enable row level security;
alter table public.tg_duels        enable row level security;
alter table public.tg_party_games  enable row level security;
revoke all on public.tg_chats, public.tg_chat_members, public.tg_duels, public.tg_party_games from anon, authenticated;
grant select, insert, update, delete on public.tg_party_games to service_role;
grant select on public.tg_chats, public.tg_chat_members, public.tg_duels to service_role;
