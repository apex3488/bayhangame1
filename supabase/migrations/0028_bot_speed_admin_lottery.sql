-- 0028: bot speed-up, admin wizards, chat lottery and giveaways.
--
-- tg_begin() replaces four calls the bot made for every update (dedupe, rate limit, chat/member
-- bookkeeping, account lookup) with one, and writes the chat/member rows at most once a minute.
-- tg_admin_state keeps the step of an admin wizard ("send the amount") between messages.
-- Lottery and giveaways move players' own money atomically; the lottery fee is burned, so neither
-- creates money. Additive only. Rollback: drop the functions and tables added here and
-- delete from economy_settings where key like 'lottery_%' or key like 'giveaway_%'.

-- ------------------------------------------------------------ tg_begin ----
create or replace function public.tg_begin(p_update bigint, p_tg bigint, p_chat bigint, p_chat_type text, p_title text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new boolean; v_rate boolean := true; v_settings jsonb; v_uid uuid; v_party boolean := false; v_state jsonb;
begin
  insert into public.telegram_updates (update_id) values (p_update) on conflict do nothing;
  v_new := found;
  if not v_new then return jsonb_build_object('new', false); end if;
  if p_tg is not null and p_tg > 0 then v_rate := public.tg_rate_hit('bot:' || p_tg, p_limit, 60); end if;
  v_uid := public.tg_user(p_tg);
  if p_chat_type in ('group', 'supergroup') then
    insert into public.tg_chats (chat_id, title, type) values (p_chat, left(p_title, 128), p_chat_type)
    on conflict (chat_id) do update set title = excluded.title, active = true, last_seen_at = now()
      where public.tg_chats.last_seen_at < now() - interval '1 minute' or public.tg_chats.active = false;
    select settings into v_settings from public.tg_chats where chat_id = p_chat;
    if p_tg is not null and p_tg > 0 then
      insert into public.tg_chat_members (chat_id, telegram_id) values (p_chat, p_tg)
      on conflict (chat_id, telegram_id) do update set last_seen_at = now()
        where public.tg_chat_members.last_seen_at < now() - interval '1 minute';
    end if;
    v_party := exists (select 1 from public.tg_party_games where chat_id = p_chat and finished_at is null);
  elsif p_chat_type = 'private' then
    select jsonb_build_object('kind', kind, 'data', data) into v_state
      from public.tg_admin_state where telegram_id = p_tg and expires_at > now();
  end if;
  if random() < 0.01 then delete from public.telegram_updates where received_at < now() - interval '7 days'; end if;
  return jsonb_build_object('new', true, 'rate_ok', v_rate, 'linked', v_uid is not null,
    'settings', coalesce(v_settings, '{"casino": true, "party": true}'::jsonb), 'party', v_party, 'state', v_state);
end $$;

-- The same RPC as tg_rpc, plus the player's cash afterwards (one round trip instead of two).
create or replace function public.tg_rpc_cash(p_tg bigint, p_fn text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := public.tg_rpc(p_tg, p_fn, p_args);
begin
  return jsonb_build_object('r', r, 'cash', (select w.cash from public.wallets w join public.telegram_accounts t on t.user_id = w.user_id where t.telegram_id = p_tg));
end $$;

-- ---------------------------------------------------- admin wizard state ----
create table public.tg_admin_state (
  telegram_id bigint primary key,
  kind        text not null,
  data        jsonb not null default '{}'::jsonb,
  expires_at  timestamptz not null default now() + interval '10 minutes'
);
alter table public.tg_admin_state enable row level security;
revoke all on public.tg_admin_state from anon, authenticated;
grant select, insert, update, delete on public.tg_admin_state to service_role;

-- -------------------------------------------------------------- lottery ----
insert into public.economy_settings (key, value, description) values
  ('lottery_min_bet',      100.00, 'Telegram: минимальная ставка в лотерее чата'),
  ('lottery_fee_percent',    5.00, 'Telegram: комиссия лотереи (сгорает), %'),
  ('lottery_minutes',        5.00, 'Telegram: через сколько минут после первой ставки розыгрыш'),
  ('giveaway_min_share',   100.00, 'Telegram: минимальная доля в раздаче')
on conflict (key) do nothing;

create table public.tg_lotteries (
  id         uuid primary key default gen_random_uuid(),
  chat_id    bigint not null,
  pot        numeric(18,2) not null default 0,
  status     text not null default 'open' check (status in ('open', 'drawn', 'refunded')),
  draw_at    timestamptz not null,
  winner     uuid,
  payout     numeric(18,2),
  created_at timestamptz not null default now()
);
create unique index tg_lotteries_open on public.tg_lotteries (chat_id) where status = 'open';
create table public.tg_lottery_bets (
  lottery_id uuid not null references public.tg_lotteries(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     numeric(18,2) not null check (amount > 0),
  primary key (lottery_id, user_id)
);

create or replace function public.tg_lottery_buy(p_tg bigint, p_chat bigint, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.tg_user(p_tg); l public.tg_lotteries; v_key text;
begin
  if uid is null then raise exception 'telegram_not_linked'; end if;
  if p_amount is null or p_amount < public._setting('lottery_min_bet') or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  perform 1 from public.profiles where id = uid and status = 'active' for update;
  if not found then raise exception 'account_restricted'; end if;
  if (select cash from public.wallets where user_id = uid) < p_amount then raise exception 'insufficient_funds'; end if;
  insert into public.tg_lotteries (chat_id, draw_at) values (p_chat, now() + make_interval(mins => public._setting('lottery_minutes')::int))
  on conflict (chat_id) where status = 'open' do nothing;
  select * into l from public.tg_lotteries where chat_id = p_chat and status = 'open' for update;
  v_key := 'lottery:' || l.id || ':' || uid || ':' || extract(epoch from clock_timestamp());
  perform public._apply_wallet_change(uid, 'cash', -p_amount, 'lottery_bet', 'Лотерея чата: ставка', v_key, null, 'lottery', l.id::text);
  insert into public.tg_lottery_bets (lottery_id, user_id, amount) values (l.id, uid, p_amount)
  on conflict (lottery_id, user_id) do update set amount = public.tg_lottery_bets.amount + excluded.amount;
  update public.tg_lotteries set pot = pot + p_amount where id = l.id returning * into l;
  return jsonb_build_object('pot', l.pot, 'draw_at', l.draw_at,
    'players', (select count(*) from public.tg_lottery_bets where lottery_id = l.id),
    'mine', (select amount from public.tg_lottery_bets where lottery_id = l.id and user_id = uid));
end $$;

create or replace function public.tg_lottery_status(p_chat bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pot', l.pot, 'draw_at', l.draw_at,
    'bets', coalesce((select jsonb_agg(jsonb_build_object('name', p.game_name, 'amount', b.amount) order by b.amount desc)
                        from public.tg_lottery_bets b join public.profiles p on p.id = b.user_id where b.lottery_id = l.id), '[]'::jsonb))
    from public.tg_lotteries l where l.chat_id = p_chat and l.status = 'open';
$$;

-- Draws every lottery whose time has come: one winner, chance proportional to the stake.
create or replace function public.tg_lottery_draw_due()
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.tg_lotteries; b record; v_out jsonb := '[]'::jsonb; v_n int; v_pick numeric; v_acc numeric; v_win uuid; v_pay numeric;
begin
  for l in select * from public.tg_lotteries where status = 'open' and draw_at <= now() for update skip locked loop
    select count(*) into v_n from public.tg_lottery_bets where lottery_id = l.id;
    if v_n < 2 then
      for b in select * from public.tg_lottery_bets where lottery_id = l.id loop
        perform public._apply_wallet_change(b.user_id, 'cash', b.amount, 'lottery_refund', 'Лотерея чата: не набралось участников',
          'lottery:' || l.id || ':refund:' || b.user_id, null, 'lottery', l.id::text);
      end loop;
      update public.tg_lotteries set status = 'refunded' where id = l.id;
      v_out := v_out || jsonb_build_object('chat_id', l.chat_id, 'refunded', true, 'pot', l.pot);
      continue;
    end if;
    v_pick := public._rand() * l.pot; v_acc := 0; v_win := null;
    for b in select * from public.tg_lottery_bets where lottery_id = l.id order by user_id loop
      v_acc := v_acc + b.amount;
      if v_win is null and v_pick < v_acc then v_win := b.user_id; end if;
    end loop;
    v_win := coalesce(v_win, (select user_id from public.tg_lottery_bets where lottery_id = l.id order by amount desc limit 1));
    v_pay := round(l.pot * (1 - public._setting('lottery_fee_percent') / 100), 2);
    perform public._apply_wallet_change(v_win, 'cash', v_pay, 'lottery_win', 'Лотерея чата: выигрыш',
      'lottery:' || l.id || ':win', null, 'lottery', l.id::text);
    update public.tg_lotteries set status = 'drawn', winner = v_win, payout = v_pay where id = l.id;
    v_out := v_out || jsonb_build_object('chat_id', l.chat_id, 'refunded', false, 'pot', l.pot, 'payout', v_pay, 'players', v_n,
      'winner', (select game_name from public.profiles where id = v_win),
      'winner_tg', (select telegram_id from public.telegram_accounts where user_id = v_win),
      'chance', round((select amount from public.tg_lottery_bets where lottery_id = l.id and user_id = v_win) / l.pot * 100, 1));
  end loop;
  return v_out;
end $$;

-- ------------------------------------------------------------ giveaways ----
create table public.tg_giveaways (
  id         uuid primary key default gen_random_uuid(),
  chat_id    bigint not null,
  creator    uuid not null references public.profiles(id) on delete cascade,
  share      numeric(18,2) not null check (share > 0),
  shares     integer not null check (shares between 1 and 100),
  claimed    integer not null default 0,
  status     text not null default 'open' check (status in ('open', 'done', 'expired')),
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);
create index tg_giveaways_open on public.tg_giveaways (expires_at) where status = 'open';
create table public.tg_giveaway_claims (
  giveaway_id uuid not null references public.tg_giveaways(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (giveaway_id, user_id)
);

create or replace function public.tg_giveaway_create(p_tg bigint, p_chat bigint, p_total numeric, p_shares integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.tg_user(p_tg); v_share numeric(18,2); v_id uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'telegram_not_linked'; end if;
  if p_shares is null or p_shares not between 1 and 100 then raise exception 'invalid_value'; end if;
  v_share := floor(p_total / p_shares * 100) / 100;
  if p_total is null or v_share < public._setting('giveaway_min_share') then raise exception 'invalid_amount'; end if;
  perform 1 from public.profiles where id = uid and status = 'active' for update;
  if not found then raise exception 'account_restricted'; end if;
  if (select cash from public.wallets where user_id = uid) < v_share * p_shares then raise exception 'insufficient_funds'; end if;
  insert into public.tg_giveaways (id, chat_id, creator, share, shares) values (v_id, p_chat, uid, v_share, p_shares);
  perform public._apply_wallet_change(uid, 'cash', -(v_share * p_shares), 'giveaway_create', 'Раздача в чате',
    'giveaway:' || v_id || ':create', null, 'giveaway', v_id::text);
  return jsonb_build_object('id', v_id, 'share', v_share, 'shares', p_shares, 'total', v_share * p_shares,
    'creator', (select game_name from public.profiles where id = uid));
end $$;

create or replace function public.tg_giveaway_claim(p_id uuid, p_tg bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.tg_user(p_tg); g public.tg_giveaways;
begin
  if uid is null then raise exception 'telegram_not_linked'; end if;
  select * into g from public.tg_giveaways where id = p_id for update;
  if not found or g.status <> 'open' or g.expires_at < now() then raise exception 'giveaway_closed'; end if;
  if g.creator = uid then raise exception 'giveaway_own'; end if;
  if (select status from public.profiles where id = uid) <> 'active' then raise exception 'account_restricted'; end if;
  insert into public.tg_giveaway_claims (giveaway_id, user_id) values (p_id, uid) on conflict do nothing;
  if not found then raise exception 'giveaway_already'; end if;
  perform public._apply_wallet_change(uid, 'cash', g.share, 'giveaway_claim', 'Раздача в чате',
    'giveaway:' || p_id || ':' || uid, g.creator, 'giveaway', p_id::text);
  update public.tg_giveaways set claimed = claimed + 1, status = case when claimed + 1 >= shares then 'done' else status end
   where id = p_id returning * into g;
  return jsonb_build_object('share', g.share, 'left', g.shares - g.claimed, 'name', (select game_name from public.profiles where id = uid));
end $$;

-- Unclaimed shares go back to the creator when the giveaway expires.
create or replace function public.tg_giveaway_expire_due()
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.tg_giveaways; v_out jsonb := '[]'::jsonb; v_back numeric;
begin
  for g in select * from public.tg_giveaways where status = 'open' and expires_at <= now() for update skip locked loop
    v_back := g.share * (g.shares - g.claimed);
    if v_back > 0 then
      perform public._apply_wallet_change(g.creator, 'cash', v_back, 'giveaway_refund', 'Раздача: возврат неразобранного',
        'giveaway:' || g.id || ':refund', null, 'giveaway', g.id::text);
    end if;
    update public.tg_giveaways set status = 'expired' where id = g.id;
    v_out := v_out || jsonb_build_object('chat_id', g.chat_id, 'refunded', v_back, 'claimed', g.claimed, 'shares', g.shares);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------- timer: also lotteries ----
create or replace function public.tg_party_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from public.tg_party_games where finished_at is null and deadline < now())
     and not exists (select 1 from public.tg_lotteries where status = 'open' and draw_at <= now())
     and not exists (select 1 from public.tg_giveaways where status = 'open' and expires_at <= now()) then
    return;
  end if;
  perform net.http_post(
    url := 'https://byjhzqpchxvzssipjfnh.supabase.co/functions/v1/telegram-bot?forceFunctionRegion=ap-southeast-1',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-telegram-bot-api-secret-token', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret')),
    body := '{"tick": true}'::jsonb,
    timeout_milliseconds := 20000);
end $$;

-- ------------------------------------------------------------- grants ----
alter table public.tg_lotteries       enable row level security;
alter table public.tg_lottery_bets    enable row level security;
alter table public.tg_giveaways       enable row level security;
alter table public.tg_giveaway_claims enable row level security;
revoke all on public.tg_lotteries, public.tg_lottery_bets, public.tg_giveaways, public.tg_giveaway_claims from anon, authenticated;
grant select on public.tg_lotteries, public.tg_lottery_bets, public.tg_giveaways, public.tg_giveaway_claims to service_role;

revoke all on function public.tg_begin(bigint, bigint, bigint, text, text, integer), public.tg_rpc_cash(bigint, text, jsonb),
  public.tg_lottery_buy(bigint, bigint, numeric), public.tg_lottery_status(bigint), public.tg_lottery_draw_due(),
  public.tg_giveaway_create(bigint, bigint, numeric, integer), public.tg_giveaway_claim(uuid, bigint), public.tg_giveaway_expire_due(),
  public.tg_party_tick()
  from public, anon, authenticated;
grant execute on function public.tg_begin(bigint, bigint, bigint, text, text, integer), public.tg_rpc_cash(bigint, text, jsonb),
  public.tg_lottery_buy(bigint, bigint, numeric), public.tg_lottery_status(bigint), public.tg_lottery_draw_due(),
  public.tg_giveaway_create(bigint, bigint, numeric, integer), public.tg_giveaway_claim(uuid, bigint), public.tg_giveaway_expire_due()
  to service_role;
