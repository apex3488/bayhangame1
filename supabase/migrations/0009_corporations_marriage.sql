-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0009: corporations and marriage.
-- Corporations: bot/services/corporations.py + corporation_seed.py
--   create $1 000 000; roles president > vp > financier > manager > member;
--   invite: president/vp/manager; withdraw: president/financier;
--   buildings: president/vp/financier, paid from the treasury, add prestige;
--   tasks reward the treasury and prestige; level = 1 + prestige / 100.
-- Marriage: bot/services/marriage.py, global instead of per-Telegram-chat,
--   proposals live 24 hours instead of 180 seconds.
-- ============================================================================

create table public.corporations (
  id           bigint generated always as identity primary key,
  name         text not null check (char_length(name) between 3 and 24 and name ~ '^[A-Za-z0-9_ .-]+$'),
  description  text not null default '' check (char_length(description) <= 200),
  treasury     numeric(18,2) not null default 0 check (treasury >= 0),
  prestige     integer not null default 0 check (prestige >= 0),
  president_id uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);
create unique index corporations_name_ci on public.corporations (lower(name));

create table public.corp_members (
  corp_id   bigint not null references public.corporations(id) on delete cascade,
  user_id   uuid not null unique references public.profiles(id) on delete cascade,
  role      text not null check (role in ('president','vp','financier','manager','member')),
  joined_at timestamptz not null default now(),
  primary key (corp_id, user_id)
);

create table public.corp_invites (
  id         bigint generated always as identity primary key,
  corp_id    bigint not null references public.corporations(id) on delete cascade,
  from_user  uuid not null references public.profiles(id),
  to_user    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);
create unique index corp_invites_one_pending on public.corp_invites (corp_id, to_user) where status = 'pending';

create table public.corp_building_catalog (
  code          text primary key,
  price         numeric(18,2) not null check (price > 0),
  prestige      integer not null check (prestige >= 0),
  income_bonus  numeric(6,2) not null default 0,
  sort_order    integer not null default 100
);
insert into public.corp_building_catalog values
  ('warehouse', 250000, 20, 3, 1), ('hq', 500000, 50, 5, 2), ('office', 750000, 40, 7, 3),
  ('lab', 1500000, 80, 10, 4), ('tower', 5000000, 200, 15, 5);

create table public.corp_buildings (
  corp_id   bigint not null references public.corporations(id) on delete cascade,
  code      text not null references public.corp_building_catalog(code),
  bought_at timestamptz not null default now(),
  primary key (corp_id, code)
);

create table public.corp_task_defs (
  code       text primary key,
  task_type  text not null check (task_type in ('members','deposits','buildings')),
  target     integer not null check (target > 0),
  reward_usd numeric(18,2) not null check (reward_usd >= 0),
  prestige   integer not null check (prestige >= 0)
);
insert into public.corp_task_defs values
  ('recruit_5', 'members', 5, 100000, 25), ('deposit_pool', 'deposits', 10, 250000, 40), ('build_empire', 'buildings', 3, 500000, 75);

create table public.corp_task_claims (
  corp_id    bigint not null references public.corporations(id) on delete cascade,
  code       text not null references public.corp_task_defs(code),
  claimed_at timestamptz not null default now(),
  primary key (corp_id, code)
);

-- Treasury movements (the treasury is not a player balance, so it has its own log).
create table public.corp_treasury_log (
  id         bigint generated always as identity primary key,
  corp_id    bigint not null references public.corporations(id) on delete cascade,
  user_id    uuid references public.profiles(id),
  kind       text not null check (kind in ('deposit','withdraw','building','task_reward')),
  amount     numeric(18,2) not null check (amount > 0),
  balance_after numeric(18,2) not null check (balance_after >= 0),
  note       text,
  created_at timestamptz not null default now()
);
create index corp_treasury_log_corp on public.corp_treasury_log (corp_id, created_at desc);

create trigger corp_treasury_log_immutable before update or delete on public.corp_treasury_log
  for each row execute function public._reject_mutation();

insert into public.economy_settings (key, value, description) values
  ('corp_create_cost', 1000000.00, 'Стоимость создания корпорации')
on conflict (key) do nothing;

create or replace function public._corp_member(p_uid uuid)
returns public.corp_members language sql stable security definer set search_path = public as $$
  select * from public.corp_members where user_id = p_uid;
$$;

create or replace function public._corp_require(p_uid uuid, p_roles text[])
returns public.corp_members language plpgsql security definer set search_path = public as $$
declare m public.corp_members;
begin
  if p_uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.corp_members where user_id = p_uid;
  if not found then raise exception 'corp_not_member'; end if;
  if not (m.role = any(p_roles)) then raise exception 'corp_no_permission'; end if;
  return m;
end $$;

create or replace function public.corp_create(p_name text, p_description text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'corpcreate:' || p_idempotency_key; v_id bigint; v_name text := trim(coalesce(p_name, ''));
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if exists (select 1 from public.corp_members where user_id = uid) then raise exception 'corp_already_member'; end if;
  if char_length(v_name) not between 3 and 24 or v_name !~ '^[A-Za-z0-9_ .-]+$' then raise exception 'corp_invalid_name'; end if;
  if exists (select 1 from public.corporations where lower(name) = lower(v_name)) then raise exception 'name_taken'; end if;
  insert into public.corporations (name, description, president_id) values (v_name, left(coalesce(trim(p_description), ''), 200), uid) returning id into v_id;
  insert into public.corp_members (corp_id, user_id, role) values (v_id, uid, 'president');
  perform public._apply_wallet_change(uid, 'cash', -public._setting('corp_create_cost'), 'corp_create', 'Создание корпорации ' || v_name, v_key, null, 'corporation', v_id::text);
  return jsonb_build_object('status','ok','corp_id',v_id);
end $$;

create or replace function public.corp_invite(p_game_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.corp_members; v_to uuid;
begin
  m := public._corp_require(uid, array['president','vp','manager']);
  select id into v_to from public.profiles where lower(game_name) = lower(trim(p_game_name));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = uid then raise exception 'corp_invite_self'; end if;
  if exists (select 1 from public.corp_members where user_id = v_to) then raise exception 'corp_target_in_corp'; end if;
  if exists (select 1 from public.corp_invites where corp_id = m.corp_id and to_user = v_to and status = 'pending') then raise exception 'corp_invite_pending'; end if;
  insert into public.corp_invites (corp_id, from_user, to_user) values (m.corp_id, uid, v_to);
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.corp_respond(p_invite bigint, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv public.corp_invites;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into inv from public.corp_invites where id = p_invite and to_user = uid for update;
  if not found then raise exception 'not_found'; end if;
  if inv.status <> 'pending' then raise exception 'invite_closed'; end if;
  if p_accept then
    if exists (select 1 from public.corp_members where user_id = uid) then raise exception 'corp_already_member'; end if;
    insert into public.corp_members (corp_id, user_id, role) values (inv.corp_id, uid, 'member');
    update public.corp_invites set status = 'accepted' where id = p_invite;
    update public.corp_invites set status = 'cancelled' where to_user = uid and status = 'pending' and id <> p_invite;
  else
    update public.corp_invites set status = 'declined' where id = p_invite;
  end if;
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.corp_leave()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.corp_members;
begin
  m := public._corp_require(uid, array['vp','financier','manager','member','president']);
  if m.role = 'president' then raise exception 'corp_president_cannot_leave'; end if;
  delete from public.corp_members where user_id = uid;
  return jsonb_build_object('status','ok');
end $$;

-- President actions: promote / demote / kick.
create or replace function public.corp_manage(p_target uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.corp_members; t public.corp_members;
        v_order text[] := array['member','manager','financier','vp']; v_idx integer;
begin
  m := public._corp_require(uid, array['president']);
  select * into t from public.corp_members where user_id = p_target and corp_id = m.corp_id for update;
  if not found then raise exception 'corp_member_not_found'; end if;
  if t.role = 'president' then raise exception 'corp_cannot_change_president'; end if;
  v_idx := array_position(v_order, t.role);
  if p_action = 'promote' then
    if v_idx >= array_length(v_order, 1) then raise exception 'corp_max_role'; end if;
    update public.corp_members set role = v_order[v_idx + 1] where user_id = p_target;
  elsif p_action = 'demote' then
    if v_idx <= 1 then raise exception 'corp_min_role'; end if;
    update public.corp_members set role = v_order[v_idx - 1] where user_id = p_target;
  elsif p_action = 'kick' then
    delete from public.corp_members where user_id = p_target;
  else
    raise exception 'invalid_choice';
  end if;
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.corp_deposit(p_amount numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'corpdep:' || p_idempotency_key; m public.corp_members; v_after numeric;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  m := public._corp_require(uid, array['president','vp','financier','manager','member']);
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  perform public._apply_wallet_change(uid, 'cash', -p_amount, 'corp_deposit', 'Взнос в казну корпорации', v_key, null, 'corporation', m.corp_id::text);
  update public.corporations set treasury = treasury + p_amount where id = m.corp_id returning treasury into v_after;
  insert into public.corp_treasury_log (corp_id, user_id, kind, amount, balance_after) values (m.corp_id, uid, 'deposit', p_amount, v_after);
  return jsonb_build_object('status','ok','treasury',v_after);
end $$;

create or replace function public.corp_withdraw(p_amount numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'corpwd:' || p_idempotency_key; m public.corp_members; v_t numeric;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  m := public._corp_require(uid, array['president','financier']);
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  select treasury into v_t from public.corporations where id = m.corp_id for update;
  if v_t < p_amount then raise exception 'insufficient_treasury'; end if;
  update public.corporations set treasury = treasury - p_amount where id = m.corp_id;
  insert into public.corp_treasury_log (corp_id, user_id, kind, amount, balance_after) values (m.corp_id, uid, 'withdraw', p_amount, v_t - p_amount);
  perform public._apply_wallet_change(uid, 'cash', p_amount, 'corp_withdraw', 'Вывод из казны корпорации', v_key, null, 'corporation', m.corp_id::text);
  return jsonb_build_object('status','ok','treasury',v_t - p_amount);
end $$;

create or replace function public.corp_buy_building(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.corp_members; b public.corp_building_catalog; v_t numeric;
begin
  m := public._corp_require(uid, array['president','vp','financier']);
  select * into b from public.corp_building_catalog where code = p_code;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.corp_buildings where corp_id = m.corp_id and code = p_code) then raise exception 'already_owned'; end if;
  select treasury into v_t from public.corporations where id = m.corp_id for update;
  if v_t < b.price then raise exception 'insufficient_treasury'; end if;
  update public.corporations set treasury = treasury - b.price, prestige = prestige + b.prestige where id = m.corp_id;
  insert into public.corp_buildings (corp_id, code) values (m.corp_id, p_code);
  insert into public.corp_treasury_log (corp_id, user_id, kind, amount, balance_after, note) values (m.corp_id, uid, 'building', b.price, v_t - b.price, p_code);
  return jsonb_build_object('status','ok');
end $$;

create or replace function public._corp_task_progress(p_corp bigint, p_type text)
returns integer language sql stable security definer set search_path = public as $$
  select case p_type
    when 'members'   then (select count(*)::integer from public.corp_members where corp_id = p_corp)
    when 'deposits'  then (select count(*)::integer from public.corp_treasury_log where corp_id = p_corp and kind = 'deposit')
    when 'buildings' then (select count(*)::integer from public.corp_buildings where corp_id = p_corp)
  end;
$$;

create or replace function public.corp_claim_task(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.corp_members; d public.corp_task_defs; v_after numeric;
begin
  m := public._corp_require(uid, array['president','vp','manager']);
  select * into d from public.corp_task_defs where code = p_code;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.corporations where id = m.corp_id for update;
  if exists (select 1 from public.corp_task_claims where corp_id = m.corp_id and code = p_code) then raise exception 'already_claimed'; end if;
  if public._corp_task_progress(m.corp_id, d.task_type) < d.target then raise exception 'not_completed'; end if;
  insert into public.corp_task_claims (corp_id, code) values (m.corp_id, p_code);
  update public.corporations set treasury = treasury + d.reward_usd, prestige = prestige + d.prestige where id = m.corp_id returning treasury into v_after;
  if d.reward_usd > 0 then
    insert into public.corp_treasury_log (corp_id, user_id, kind, amount, balance_after, note) values (m.corp_id, uid, 'task_reward', d.reward_usd, v_after, p_code);
  end if;
  return jsonb_build_object('status','ok','reward',d.reward_usd);
end $$;

-- Everything the corporation screen needs, for the caller's own corporation.
create or replace function public.my_corporation()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.corp_members; c public.corporations;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.corp_members where user_id = uid;
  if not found then
    return jsonb_build_object('member', false, 'create_cost', public._setting('corp_create_cost'),
      'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'corp', co.name, 'from', p.game_name, 'created_at', i.created_at))
                             from public.corp_invites i join public.corporations co on co.id = i.corp_id join public.profiles p on p.id = i.from_user
                            where i.to_user = uid and i.status = 'pending'), '[]'::jsonb));
  end if;
  select * into c from public.corporations where id = m.corp_id;
  return jsonb_build_object('member', true, 'role', m.role,
    'corp', jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'treasury', c.treasury,
                               'prestige', c.prestige, 'level', 1 + c.prestige / 100, 'created_at', c.created_at),
    'members', (select jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'game_name', p.game_name, 'role', cm.role, 'level', p.level, 'joined_at', cm.joined_at)
                                 order by array_position(array['president','vp','financier','manager','member'], cm.role), cm.joined_at)
                  from public.corp_members cm join public.profiles p on p.id = cm.user_id where cm.corp_id = c.id),
    'buildings', (select jsonb_agg(jsonb_build_object('code', b.code, 'price', b.price, 'prestige', b.prestige,
                                   'owned', exists (select 1 from public.corp_buildings x where x.corp_id = c.id and x.code = b.code)) order by b.sort_order)
                    from public.corp_building_catalog b),
    'tasks', (select jsonb_agg(jsonb_build_object('code', d.code, 'target', d.target, 'reward', d.reward_usd, 'prestige', d.prestige,
                               'progress', least(public._corp_task_progress(c.id, d.task_type), d.target),
                               'claimed', exists (select 1 from public.corp_task_claims x where x.corp_id = c.id and x.code = d.code)))
                from public.corp_task_defs d),
    'log', coalesce((select jsonb_agg(row_to_json(t)) from (
              select l.kind, l.amount, l.balance_after, l.note, l.created_at, p.game_name
                from public.corp_treasury_log l left join public.profiles p on p.id = l.user_id
               where l.corp_id = c.id order by l.id desc limit 15) t), '[]'::jsonb));
end $$;

-- Corporation rating (bot: treasury + prestige × 100).
create or replace function public.leaderboard_corporations(p_limit integer default 50)
returns table (rank bigint, name text, level integer, prestige integer, members bigint, score numeric)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by c.treasury + c.prestige * 100 desc), c.name, 1 + c.prestige / 100, c.prestige,
         (select count(*) from public.corp_members m where m.corp_id = c.id), c.treasury + c.prestige * 100
    from public.corporations c order by c.treasury + c.prestige * 100 desc limit least(greatest(p_limit, 1), 100);
$$;

-- -------------------------------------------------------------- marriage ----
create table public.marriages (
  id         bigint generated always as identity primary key,
  user1_id   uuid not null references public.profiles(id) on delete cascade,
  user2_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at   timestamptz,
  check (user1_id <> user2_id)
);
create unique index marriages_active_u1 on public.marriages (user1_id) where ended_at is null;
create unique index marriages_active_u2 on public.marriages (user2_id) where ended_at is null;

create table public.marriage_proposals (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create or replace function public._is_married(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.marriages where ended_at is null and (user1_id = p_uid or user2_id = p_uid));
$$;

create or replace function public.marriage_propose(p_game_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_to uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select id into v_to from public.profiles where lower(game_name) = lower(trim(p_game_name));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = uid then raise exception 'marriage_self'; end if;
  if public._is_married(uid) or public._is_married(v_to) then raise exception 'already_married'; end if;
  if exists (select 1 from public.marriage_proposals where from_user = uid and to_user = v_to and status = 'pending' and expires_at > now()) then
    raise exception 'proposal_pending';
  end if;
  insert into public.marriage_proposals (from_user, to_user) values (uid, v_to);
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.marriage_respond(p_proposal bigint, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pr public.marriage_proposals;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into pr from public.marriage_proposals where id = p_proposal and to_user = uid for update;
  if not found then raise exception 'not_found'; end if;
  if pr.status <> 'pending' or pr.expires_at <= now() then raise exception 'proposal_closed'; end if;
  if p_accept then
    -- Lock both profiles in a fixed order so two simultaneous acceptances cannot marry one person twice.
    perform 1 from public.profiles where id in (pr.from_user, uid) order by id for update;
    if public._is_married(uid) or public._is_married(pr.from_user) then raise exception 'already_married'; end if;
    insert into public.marriages (user1_id, user2_id) values (pr.from_user, uid);
    update public.marriage_proposals set status = 'accepted' where id = p_proposal;
    update public.marriage_proposals set status = 'cancelled'
     where status = 'pending' and id <> p_proposal and (from_user in (uid, pr.from_user) or to_user in (uid, pr.from_user));
  else
    update public.marriage_proposals set status = 'declined' where id = p_proposal;
  end if;
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.marriage_divorce()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.marriages set ended_at = now() where ended_at is null and (user1_id = auth.uid() or user2_id = auth.uid());
  if not found then raise exception 'not_married'; end if;
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.my_marriage()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'partner', (select jsonb_build_object('game_name', p.game_name, 'level', p.level, 'since', m.created_at)
                  from public.marriages m join public.profiles p on p.id = case when m.user1_id = auth.uid() then m.user2_id else m.user1_id end
                 where m.ended_at is null and (m.user1_id = auth.uid() or m.user2_id = auth.uid())),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'from', p.game_name, 'expires_at', pr.expires_at))
                            from public.marriage_proposals pr join public.profiles p on p.id = pr.from_user
                           where pr.to_user = auth.uid() and pr.status = 'pending' and pr.expires_at > now()), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'to', p.game_name, 'expires_at', pr.expires_at))
                            from public.marriage_proposals pr join public.profiles p on p.id = pr.to_user
                           where pr.from_user = auth.uid() and pr.status = 'pending' and pr.expires_at > now()), '[]'::jsonb));
$$;

alter table public.corporations          enable row level security;
alter table public.corp_members          enable row level security;
alter table public.corp_invites          enable row level security;
alter table public.corp_building_catalog enable row level security;
alter table public.corp_buildings        enable row level security;
alter table public.corp_task_defs        enable row level security;
alter table public.corp_task_claims      enable row level security;
alter table public.corp_treasury_log     enable row level security;
alter table public.marriages             enable row level security;
alter table public.marriage_proposals    enable row level security;
create policy read_all on public.corp_building_catalog for select to authenticated using (true);
create policy read_all on public.corp_task_defs        for select to authenticated using (true);
-- Everything else is read through my_corporation() / my_marriage().

revoke all on all functions in schema public from public, anon;
revoke execute on function public._corp_member(uuid), public._corp_require(uuid, text[]), public._corp_task_progress(bigint, text),
                           public._is_married(uuid) from authenticated;
grant execute on function public.corp_create(text, text, text) to authenticated;
grant execute on function public.corp_invite(text)             to authenticated;
grant execute on function public.corp_respond(bigint, boolean) to authenticated;
grant execute on function public.corp_leave()                  to authenticated;
grant execute on function public.corp_manage(uuid, text)       to authenticated;
grant execute on function public.corp_deposit(numeric, text)   to authenticated;
grant execute on function public.corp_withdraw(numeric, text)  to authenticated;
grant execute on function public.corp_buy_building(text)       to authenticated;
grant execute on function public.corp_claim_task(text)         to authenticated;
grant execute on function public.my_corporation()              to authenticated;
grant execute on function public.leaderboard_corporations(integer) to authenticated;
grant execute on function public.marriage_propose(text)        to authenticated;
grant execute on function public.marriage_respond(bigint, boolean) to authenticated;
grant execute on function public.marriage_divorce()            to authenticated;
grant execute on function public.my_marriage()                 to authenticated;
grant execute on function public.registration_check(text, text) to anon;
