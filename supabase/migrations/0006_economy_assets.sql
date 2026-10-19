-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0006: the bot's economy.
-- Ported from bot/services/{bank,exchange,capital,resources,shop,cases,promo,
-- realty,cars,business}.py and their seeds. Numbers are the bot's defaults.
--
-- Money model (as in the bot):
--   cash  = wallet, the main balance (bets, purchases, salaries, rewards)
--   bank  = bank checking account (wallet <-> bank)
--   btc   = virtual BTC wallet, 8 decimals
-- Existing players' bank balances are moved to cash through journal entries.
-- ============================================================================

-- ------------------------------------------------- journal: BTC precision ----
alter table public.ledger_entries alter column amount type numeric(20,8);
alter table public.ledger_entries alter column balance_before type numeric(20,8);
alter table public.ledger_entries alter column balance_after type numeric(20,8);
alter table public.ledger_entries drop constraint ledger_entries_op_type_check;
alter table public.ledger_entries add constraint ledger_entries_op_type_check check (op_type ~ '^[a-z_]{3,32}$');

alter table public.wallets add column btc numeric(20,8) not null default 0 check (btc >= 0);

insert into public.economy_settings (key, value, description) values
  ('btc_rate',              65967.00, 'Курс BTC в USD (бот: btc_rate)'),
  ('mining_cooldown',          60.00, 'Перерыв добычи ресурсов, секунд'),
  ('offline_income_hours',     24.00, 'Максимум часов накопления дохода недвижимости и бизнеса'),
  ('asset_sell_ratio',          0.70, 'Доля рыночной стоимости при продаже недвижимости, авто и бизнеса'),
  ('referral_reward',      500000.00, 'Награда пригласившему (после 3 смен приглашённого)')
on conflict (key) do nothing;

-- -------------------------------------------- the single balance mutator ----
create or replace function public._apply_wallet_change(
  p_user          uuid,
  p_account       public.ledger_account,
  p_delta         numeric,
  p_op_type       text,
  p_reason        text,
  p_key           text,
  p_counterparty  uuid default null,
  p_related_type  text default null,
  p_related_id    text default null,
  p_group         uuid default gen_random_uuid()
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric(20,8);
  v_after  numeric(20,8);
begin
  if p_delta = 0 then raise exception 'zero_amount'; end if;
  -- USD accounts move whole cents, BTC whole satoshis.
  if p_account in ('cash','bank') and p_delta <> round(p_delta, 2) then raise exception 'invalid_amount'; end if;
  if p_account = 'btc' and p_delta <> round(p_delta, 8) then raise exception 'invalid_amount'; end if;

  if p_account = 'cash' then
    select w.cash into v_before from public.wallets w where w.user_id = p_user for update;
  elsif p_account = 'bank' then
    select w.bank into v_before from public.wallets w where w.user_id = p_user for update;
  else
    select w.btc into v_before from public.wallets w where w.user_id = p_user for update;
  end if;
  if not found then raise exception 'wallet_not_found'; end if;

  v_after := v_before + p_delta;
  if v_after < 0 then raise exception 'insufficient_funds'; end if;

  if p_account = 'cash' then
    update public.wallets set cash = v_after, updated_at = now() where user_id = p_user;
  elsif p_account = 'bank' then
    update public.wallets set bank = v_after, updated_at = now() where user_id = p_user;
  else
    update public.wallets set btc = v_after, updated_at = now() where user_id = p_user;
  end if;

  insert into public.ledger_entries (
    group_id, user_id, op_type, direction, account, amount,
    balance_before, balance_after, counterparty_id, reason,
    related_type, related_id, idempotency_key
  ) values (
    p_group, p_user, p_op_type, case when p_delta > 0 then 'credit' else 'debit' end,
    p_account, abs(p_delta), v_before, v_after, p_counterparty, left(p_reason, 200),
    p_related_type, p_related_id, p_key
  );
end;
$$;

-- Every player action claims its idempotency key here first. A repeated request
-- hits the primary key and is answered as "duplicate" without touching money.
create table public.action_keys (
  key        text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.action_keys enable row level security;

-- Common prelude for player actions: authenticated, key valid and unused, account active, player row locked.
-- Returns true when the key was already used (caller returns "duplicate").
create or replace function public._begin_action(p_uid uuid, p_key text, p_client_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.account_status;
begin
  if p_uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_client_key) then raise exception 'invalid_idempotency_key'; end if;
  insert into public.action_keys (key, user_id) values (p_key, p_uid) on conflict (key) do nothing;
  if not found then return true; end if;
  select status into v_status from public.profiles where id = p_uid for update;
  if v_status <> 'active' then raise exception 'account_restricted'; end if;
  return false;
end;
$$;

-- Move every existing bank balance to cash, through the journal.
do $$
declare
  w record;
begin
  for w in select user_id, bank from public.wallets where bank > 0 loop
    perform public._apply_wallet_change(w.user_id, 'bank', -w.bank, 'bank_withdraw',
      'Перенос на основной кошелёк (BAYHAN 2.0)', 'migrate0006:bank_out:' || w.user_id);
    perform public._apply_wallet_change(w.user_id, 'cash', w.bank, 'bank_withdraw',
      'Перенос на основной кошелёк (BAYHAN 2.0)', 'migrate0006:cash_in:' || w.user_id);
  end loop;
end $$;

-- New players get the starting capital in the wallet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_login text := lower(trim(coalesce(new.raw_user_meta_data ->> 'login', '')));
  v_name  text := trim(coalesce(new.raw_user_meta_data ->> 'game_name', ''));
begin
  if v_login !~ '^[a-z0-9_]{3,20}$' then raise exception 'invalid_login'; end if;
  if char_length(v_name) not between 3 and 20 or v_name !~ '^[A-Za-z0-9_ ]+$' then raise exception 'invalid_game_name'; end if;
  insert into public.profiles (id, login, game_name) values (new.id, v_login, v_name);
  insert into public.wallets (user_id, cash, bank) values (new.id, 0, 0);
  perform public._apply_wallet_change(new.id, 'cash', public._setting('starting_capital'), 'signup_bonus',
    'Стартовый капитал', 'signup:' || new.id::text, null, 'account', new.id::text);
  return new;
end;
$$;

-- ------------------------------------------------------------------ bank ----
create table public.bank_deposits (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  amount        numeric(18,2) not null check (amount > 0),
  rate_percent  numeric(6,2) not null check (rate_percent >= 0),
  days          integer not null check (days in (30, 90, 180)),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  claimed       boolean not null default false,
  interest_paid numeric(18,2) not null default 0,
  created_key   text not null unique
);
create index bank_deposits_user on public.bank_deposits (user_id, claimed);

create table public.bank_terms (
  days         integer primary key,
  rate_percent numeric(6,2) not null check (rate_percent >= 0)
);
insert into public.bank_terms values (30, 3), (90, 8), (180, 15);

-- Wallet -> bank account.
create or replace function public.bank_deposit(p_amount numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'bankin:' || p_idempotency_key; g uuid := gen_random_uuid();
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  perform public._apply_wallet_change(uid, 'cash', -p_amount, 'bank_deposit', 'Пополнение банковского счёта', v_key || ':out', null, 'bank', null, g);
  perform public._apply_wallet_change(uid, 'bank',  p_amount, 'bank_deposit', 'Пополнение банковского счёта', v_key || ':in',  null, 'bank', null, g);
  return jsonb_build_object('status','ok');
end $$;

-- Bank account -> wallet.
create or replace function public.bank_withdraw(p_amount numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'bankout:' || p_idempotency_key; g uuid := gen_random_uuid();
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  perform public._apply_wallet_change(uid, 'bank', -p_amount, 'bank_withdraw', 'Снятие с банковского счёта', v_key || ':out', null, 'bank', null, g);
  perform public._apply_wallet_change(uid, 'cash',  p_amount, 'bank_withdraw', 'Снятие с банковского счёта', v_key || ':in',  null, 'bank', null, g);
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.deposit_open(p_amount numeric, p_days integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'depopen:' || p_idempotency_key; v_rate numeric; v_id bigint;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  select rate_percent into v_rate from public.bank_terms where days = p_days;
  if v_rate is null then raise exception 'invalid_choice'; end if;
  insert into public.bank_deposits (user_id, amount, rate_percent, days, ends_at, created_key)
  values (uid, p_amount, v_rate, p_days, now() + make_interval(days => p_days), v_key) returning id into v_id;
  perform public._apply_wallet_change(uid, 'cash', -p_amount, 'deposit_open',
    'Вклад ' || p_days || ' дн. под ' || v_rate || '%', v_key, null, 'deposit', v_id::text);
  return jsonb_build_object('status','ok','deposit_id',v_id);
end $$;

create or replace function public.deposit_claim(p_deposit bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d public.bank_deposits; v_interest numeric(18,2);
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into d from public.bank_deposits where id = p_deposit and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if d.claimed then raise exception 'already_claimed'; end if;
  if now() < d.ends_at then raise exception 'not_matured'; end if;
  v_interest := round(d.amount * d.rate_percent / 100, 2);
  update public.bank_deposits set claimed = true, interest_paid = v_interest where id = d.id;
  perform public._apply_wallet_change(uid, 'cash', d.amount + v_interest, 'deposit_close',
    'Вклад завершён (' || d.days || ' дн.)', 'depclose:' || d.id, null, 'deposit', d.id::text);
  return jsonb_build_object('status','ok','payout', d.amount + v_interest, 'interest', v_interest);
end $$;

-- ------------------------------------------------------------------- BTC ----
create or replace function public.btc_buy(p_usd numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'btcbuy:' || p_idempotency_key; v_rate numeric := public._setting('btc_rate');
        v_btc numeric(20,8); g uuid := gen_random_uuid();
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_usd is null or p_usd <= 0 or p_usd <> round(p_usd, 2) then raise exception 'invalid_amount'; end if;
  v_btc := trunc(p_usd / v_rate, 8);
  if v_btc <= 0 then raise exception 'invalid_amount'; end if;
  perform public._apply_wallet_change(uid, 'cash', -p_usd, 'btc_buy', 'Покупка BTC по $' || v_rate, v_key || ':usd', null, 'btc', null, g);
  perform public._apply_wallet_change(uid, 'btc',  v_btc, 'btc_buy', 'Покупка BTC по $' || v_rate, v_key || ':btc', null, 'btc', null, g);
  return jsonb_build_object('status','ok','btc',v_btc,'rate',v_rate);
end $$;

create or replace function public.btc_sell(p_btc numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'btcsell:' || p_idempotency_key; v_rate numeric := public._setting('btc_rate');
        v_usd numeric(18,2); g uuid := gen_random_uuid();
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_btc is null or p_btc <= 0 or p_btc <> round(p_btc, 8) then raise exception 'invalid_amount'; end if;
  v_usd := trunc(p_btc * v_rate, 2);
  if v_usd <= 0 then raise exception 'invalid_amount'; end if;
  perform public._apply_wallet_change(uid, 'btc', -p_btc, 'btc_sell', 'Продажа BTC по $' || v_rate, v_key || ':btc', null, 'btc', null, g);
  perform public._apply_wallet_change(uid, 'cash', v_usd, 'btc_sell', 'Продажа BTC по $' || v_rate, v_key || ':usd', null, 'btc', null, g);
  return jsonb_build_object('status','ok','usd',v_usd,'rate',v_rate);
end $$;

-- ------------------------------------------------------------- resources ----
create table public.resources (
  code        text primary key,
  buy_price   numeric(18,2) not null check (buy_price >= 0),
  sell_price  numeric(18,2) not null check (sell_price >= 0),
  mine_chance integer not null check (mine_chance between 0 and 100),
  mine_min    integer not null check (mine_min >= 0),
  mine_max    integer not null,
  sort_order  integer not null default 100,
  enabled     boolean not null default true,
  check (mine_max >= mine_min)
);
insert into public.resources values
  ('wood',    50,   30, 45, 1, 5, 1, true),
  ('stone',   80,   50, 35, 1, 4, 2, true),
  ('iron',   200,  140, 18, 1, 3, 3, true),
  ('diamond',2000,1500,  4, 1, 1, 4, true),
  ('energy', 100,   60, 25, 1, 3, 5, true);

create table public.user_resources (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code    text not null references public.resources(code),
  amount  bigint not null default 0 check (amount >= 0),
  primary key (user_id, code)
);

create table public.mining_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  rewards    jsonb not null,
  total      integer not null check (total >= 0),
  created_at timestamptz not null default now()
);
create index mining_log_user_time on public.mining_log (user_id, created_at desc);

create or replace function public._grant_resource(p_user uuid, p_code text, p_amount bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  if not exists (select 1 from public.resources where code = p_code) then raise exception 'not_found'; end if;
  insert into public.user_resources (user_id, code, amount) values (p_user, p_code, p_amount)
  on conflict (user_id, code) do update set amount = user_resources.amount + excluded.amount;
end $$;

-- Events table is created here because mining reads its multiplier.
create table public.events (
  code        text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  title       text not null,
  description text not null default '',
  event_type  text not null check (event_type in ('daily','mining')),
  multiplier  numeric(6,2) not null check (multiplier > 0),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  active      boolean not null default true,
  check (ends_at > starts_at)
);

create or replace function public._event_multiplier(p_type text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(max(multiplier), 1) from public.events
   where event_type = p_type and active and now() between starts_at and ends_at;
$$;

create or replace function public.mine_resources()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; r public.resources; v_amount integer;
        v_rewards jsonb := '{}'::jsonb; v_total integer := 0;
        v_mult integer := greatest(floor(public._event_multiplier('mining'))::integer, 1);
        v_last timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  select max(created_at) into v_last from public.mining_log where user_id = uid;
  if v_last is not null and v_last + make_interval(secs => public._setting('mining_cooldown')::integer) > now() then
    raise exception 'cooldown_active';
  end if;
  for r in select * from public.resources where enabled and mine_chance > 0 order by sort_order loop
    if public._rand_int(1, 100) <= r.mine_chance then
      v_amount := public._rand_int(r.mine_min, r.mine_max) * v_mult;
      if v_amount > 0 then
        perform public._grant_resource(uid, r.code, v_amount);
        v_rewards := v_rewards || jsonb_build_object(r.code, v_amount);
        v_total := v_total + v_amount;
      end if;
    end if;
  end loop;
  insert into public.mining_log (user_id, rewards, total) values (uid, v_rewards, v_total);
  return jsonb_build_object('status','ok','rewards',v_rewards,'total',v_total,
    'next_at', now() + make_interval(secs => public._setting('mining_cooldown')::integer));
end $$;

create or replace function public.sell_resource(p_code text, p_amount bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'ressell:' || p_idempotency_key; r public.resources; v_have bigint; v_usd numeric(18,2);
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select * into r from public.resources where code = p_code;
  if not found then raise exception 'not_found'; end if;
  select amount into v_have from public.user_resources where user_id = uid and code = p_code for update;
  if coalesce(v_have, 0) < p_amount then raise exception 'insufficient_resources'; end if;
  update public.user_resources set amount = amount - p_amount where user_id = uid and code = p_code;
  v_usd := r.sell_price * p_amount;
  if v_usd > 0 then
    perform public._apply_wallet_change(uid, 'cash', v_usd, 'resource_sell', 'Продажа ресурса: ' || p_code || ' × ' || p_amount, v_key, null, 'resource', p_code);
  end if;
  return jsonb_build_object('status','ok','usd',v_usd);
end $$;

-- ------------------------------------------------------------------ shop ----
create table public.shop_items (
  code       text primary key,
  category   text not null,
  price      numeric(18,2) not null check (price >= 0),
  payload    jsonb not null default '{}'::jsonb,
  stock      integer not null default -1 check (stock >= -1),
  enabled    boolean not null default true,
  sort_order integer not null default 100
);
insert into public.shop_items (code, category, price, payload, sort_order) values
  ('buy_wood',    'resource',   50, '{"resource":"wood","amount":1}',    1),
  ('buy_stone',   'resource',   80, '{"resource":"stone","amount":1}',   2),
  ('buy_iron',    'resource',  200, '{"resource":"iron","amount":1}',    3),
  ('buy_diamond', 'resource', 2000, '{"resource":"diamond","amount":1}', 4),
  ('buy_energy',  'resource',  100, '{"resource":"energy","amount":1}',  5);

create table public.purchases (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_code  text not null,
  kind       text not null,
  quantity   integer not null check (quantity > 0),
  total      numeric(18,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);
create index purchases_user_time on public.purchases (user_id, created_at desc);

create or replace function public.shop_buy(p_code text, p_qty integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'shop:' || p_idempotency_key; it public.shop_items; v_total numeric(18,2);
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then raise exception 'invalid_amount'; end if;
  select * into it from public.shop_items where code = p_code and enabled for update;
  if not found then raise exception 'not_found'; end if;
  if it.stock <> -1 and it.stock < p_qty then raise exception 'out_of_stock'; end if;
  v_total := it.price * p_qty;
  if v_total > 0 then
    perform public._apply_wallet_change(uid, 'cash', -v_total, 'shop_buy', 'Магазин: ' || p_code || ' × ' || p_qty, v_key, null, 'shop', p_code);
  end if;
  if it.stock <> -1 then update public.shop_items set stock = stock - p_qty where code = p_code; end if;
  if it.payload ? 'resource' then
    perform public._grant_resource(uid, it.payload ->> 'resource', (it.payload ->> 'amount')::bigint * p_qty);
  end if;
  insert into public.purchases (user_id, item_code, kind, quantity, total) values (uid, p_code, 'shop', p_qty, v_total);
  return jsonb_build_object('status','ok','total',v_total);
end $$;

-- ----------------------------------------------------------------- cases ----
create table public.cases (
  code       text primary key,
  rarity     text not null,
  price      numeric(18,2) not null check (price >= 0),
  sort_order integer not null default 100,
  active     boolean not null default true
);
create table public.case_rewards (
  id            bigint generated always as identity primary key,
  case_code     text not null references public.cases(code) on delete cascade,
  reward_type   text not null check (reward_type in ('usd','btc','resource')),
  amount        numeric(20,8) not null check (amount > 0),
  resource_code text references public.resources(code),
  weight        integer not null check (weight > 0),
  rarity        text not null,
  check ((reward_type = 'resource') = (resource_code is not null))
);
insert into public.cases values ('starter','common',10000,1,true), ('silver','rare',50000,2,true),
                                ('gold','epic',200000,3,true), ('diamond','legendary',1000000,4,true);
insert into public.case_rewards (case_code, reward_type, amount, resource_code, weight, rarity) values
  ('starter','usd',5000,null,50,'common'), ('starter','usd',15000,null,30,'common'),
  ('starter','usd',30000,null,15,'rare'),  ('starter','resource',5,'wood',5,'rare'),
  ('silver','usd',25000,null,40,'common'), ('silver','usd',75000,null,25,'rare'),
  ('silver','btc',0.001,null,20,'rare'),   ('silver','resource',3,'iron',10,'epic'),
  ('silver','usd',150000,null,5,'epic'),
  ('gold','usd',100000,null,35,'rare'),    ('gold','usd',300000,null,25,'epic'),
  ('gold','btc',0.005,null,20,'epic'),     ('gold','resource',2,'diamond',12,'legendary'),
  ('gold','usd',750000,null,8,'legendary'),
  ('diamond','usd',500000,null,30,'epic'), ('diamond','usd',1500000,null,25,'legendary'),
  ('diamond','btc',0.02,null,20,'legendary'), ('diamond','btc',0.05,null,10,'legendary'),
  ('diamond','resource',10,'energy',10,'epic'), ('diamond','usd',5000000,null,5,'legendary');

create table public.case_openings (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  case_code  text not null references public.cases(code),
  reward_id  bigint not null references public.case_rewards(id),
  price      numeric(18,2) not null,
  key        text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.open_case(p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'case:' || p_idempotency_key; c public.cases; rw public.case_rewards;
        v_pick bigint; v_prev jsonb;
begin
  select jsonb_build_object('status','duplicate','reward', to_jsonb(r)) into v_prev
    from public.case_openings o join public.case_rewards r on r.id = o.reward_id where o.key = v_key;
  if v_prev is not null then return v_prev; end if;
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  select * into c from public.cases where code = p_code and active;
  if not found then raise exception 'not_found'; end if;
  select (public._weighted_pick(jsonb_agg(jsonb_build_object('v', id, 'w', weight))) #>> '{}')::bigint into v_pick
    from public.case_rewards where case_code = p_code;
  select * into rw from public.case_rewards where id = v_pick;
  if c.price > 0 then
    perform public._apply_wallet_change(uid, 'cash', -c.price, 'case_buy', 'Кейс: ' || p_code, v_key || ':buy', null, 'case', p_code);
  end if;
  if rw.reward_type = 'usd' then
    perform public._apply_wallet_change(uid, 'cash', round(rw.amount, 2), 'case_reward', 'Награда кейса ' || p_code, v_key || ':reward', null, 'case', p_code);
  elsif rw.reward_type = 'btc' then
    perform public._apply_wallet_change(uid, 'btc', rw.amount, 'case_reward', 'Награда кейса ' || p_code, v_key || ':reward', null, 'case', p_code);
  else
    perform public._grant_resource(uid, rw.resource_code, rw.amount::bigint);
  end if;
  insert into public.case_openings (user_id, case_code, reward_id, price, key) values (uid, p_code, rw.id, c.price, v_key);
  return jsonb_build_object('status','ok','reward', to_jsonb(rw));
end $$;

-- ----------------------------------------------------------------- promo ----
create table public.promo_codes (
  code        text primary key check (code ~ '^[A-Z0-9_]{3,32}$'),
  reward_usd  numeric(18,2) not null default 0 check (reward_usd >= 0),
  reward_btc  numeric(20,8) not null default 0 check (reward_btc >= 0),
  max_uses    integer not null check (max_uses > 0),
  used_count  integer not null default 0 check (used_count >= 0),
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  check (used_count <= max_uses),
  check (reward_usd > 0 or reward_btc > 0)
);
create table public.promo_redemptions (
  code       text not null references public.promo_codes(code),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);
-- Starter code from bot/services/seed.py (one per player, limited activations).
insert into public.promo_codes (code, reward_usd, max_uses) values ('APEXGAMESTART', 50000, 100000);

create or replace function public.redeem_promo(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_code text := upper(trim(coalesce(p_code, ''))); pc public.promo_codes; v_status public.account_status;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select status into v_status from public.profiles where id = uid for update;
  if v_status <> 'active' then raise exception 'account_restricted'; end if;
  -- Row lock serialises concurrent redemptions, so used_count can never exceed max_uses.
  select * into pc from public.promo_codes where code = v_code for update;
  if not found then raise exception 'promo_not_found'; end if;
  if not pc.active or now() < pc.starts_at then raise exception 'promo_inactive'; end if;
  if pc.expires_at is not null and now() > pc.expires_at then raise exception 'promo_expired'; end if;
  if pc.used_count >= pc.max_uses then raise exception 'promo_limit_reached'; end if;
  if exists (select 1 from public.promo_redemptions where code = v_code and user_id = uid) then raise exception 'promo_already_used'; end if;
  insert into public.promo_redemptions (code, user_id) values (v_code, uid);
  update public.promo_codes set used_count = used_count + 1 where code = v_code;
  if pc.reward_usd > 0 then
    perform public._apply_wallet_change(uid, 'cash', pc.reward_usd, 'promo_reward', 'Промокод ' || v_code, 'promo:' || v_code || ':' || uid || ':usd', null, 'promo', v_code);
  end if;
  if pc.reward_btc > 0 then
    perform public._apply_wallet_change(uid, 'btc', pc.reward_btc, 'promo_reward', 'Промокод ' || v_code, 'promo:' || v_code || ':' || uid || ':btc', null, 'promo', v_code);
  end if;
  return jsonb_build_object('status','ok','usd',pc.reward_usd,'btc',pc.reward_btc);
end $$;

-- ------------------------------------------------- realty / cars / business ----
create table public.realty_items (
  code text primary key, category text not null,
  price numeric(18,2) not null check (price > 0),
  income_per_hour numeric(18,2) not null check (income_per_hour >= 0),
  max_level integer not null default 5 check (max_level >= 1),
  upgrade_cost_base numeric(18,2) not null check (upgrade_cost_base >= 0),
  active boolean not null default true, sort_order integer not null default 100
);
insert into public.realty_items values
  ('studio','apartment',50000,500,5,15000,true,1), ('apartment','apartment',150000,1500,5,40000,true,2),
  ('townhouse','house',400000,4000,5,100000,true,3), ('villa','house',1000000,10000,5,250000,true,4),
  ('penthouse','penthouse',3000000,28000,5,600000,true,5), ('mansion','mansion',8000000,70000,5,1500000,true,6),
  ('island','island',25000000,200000,5,4000000,true,7);

create table public.car_items (
  code text primary key, category text not null,
  price numeric(18,2) not null check (price > 0),
  power integer not null, max_speed integer not null,
  active boolean not null default true, sort_order integer not null default 100
);
insert into public.car_items values
  ('sedan','sedan',30000,180,210,true,1), ('sport_coupe','sport',120000,480,280,true,2),
  ('luxury_sedan','luxury',250000,430,250,true,3), ('suv_lux','suv',500000,570,250,true,4),
  ('supercar','super',900000,630,325,true,5), ('hypercar','hyper',3000000,1500,420,true,6);

create table public.business_items (
  code text primary key, category text not null,
  price numeric(18,2) not null check (price > 0),
  income_per_hour numeric(18,2) not null check (income_per_hour >= 0),
  expense_per_hour numeric(18,2) not null check (expense_per_hour >= 0),
  max_level integer not null default 5 check (max_level >= 1),
  upgrade_cost_base numeric(18,2) not null check (upgrade_cost_base >= 0),
  active boolean not null default true, sort_order integer not null default 100
);
insert into public.business_items values
  ('coffee_shop','shop',80000,1200,200,5,25000,true,1), ('car_wash','service',150000,2200,400,5,45000,true,2),
  ('restaurant','restaurant',300000,4000,800,5,80000,true,3), ('hotel','hotel',1500000,18000,3000,5,350000,true,4),
  ('nightclub','entertainment',2000000,24000,5000,5,450000,true,5), ('factory','factory',5000000,55000,9000,5,1200000,true,6);

insert into public.economy_settings (key, value, description) values
  ('employee_cost', 2000.00, 'Цена найма n-го сотрудника = значение × n'),
  ('max_employees',   10.00, 'Максимум сотрудников в бизнесе'),
  ('employee_bonus',   0.05, 'Прибавка к доходу бизнеса за сотрудника'),
  ('car_upgrade_ratio',0.20, 'Апгрейд авто = цена × значение × уровень'),
  ('car_max_level',    5.00, 'Максимальный уровень авто')
on conflict (key) do nothing;

create table public.user_realty (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.realty_items(code),
  level integer not null default 1 check (level >= 1),
  last_collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);
create table public.user_cars (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.car_items(code),
  level integer not null default 1 check (level >= 1),
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);
create table public.user_businesses (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.business_items(code),
  level integer not null default 1 check (level >= 1),
  employees integer not null default 0 check (employees >= 0),
  last_collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

create or replace function public._market_value(p_price numeric, p_level integer)
returns numeric language sql immutable set search_path = public as $$
  select round(p_price * (1 + 0.15 * (greatest(p_level, 1) - 1)), 2);
$$;

-- Hours of income since last collection, capped by offline_income_hours.
create or replace function public._accrual_hours(p_last timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select least(greatest(extract(epoch from (now() - p_last)) / 3600.0, 0), public._setting('offline_income_hours'));
$$;

create or replace function public._business_net_hour(b public.business_items, p_level integer, p_employees integer)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(b.income_per_hour * p_level * (1 + public._setting('employee_bonus') * p_employees)
                  - b.expense_per_hour * p_level, 0);
$$;

-- Generic buy/sell/upgrade for the three asset kinds.
create or replace function public.asset_buy(p_kind text, p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'assetbuy:' || p_idempotency_key; v_price numeric;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_kind = 'realty' then
    select price into v_price from public.realty_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_realty where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_realty (user_id, code) values (uid, p_code);
  elsif p_kind = 'car' then
    select price into v_price from public.car_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_cars where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_cars (user_id, code) values (uid, p_code);
  elsif p_kind = 'business' then
    select price into v_price from public.business_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_businesses where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_businesses (user_id, code) values (uid, p_code);
  else
    raise exception 'invalid_choice';
  end if;
  perform public._apply_wallet_change(uid, 'cash', -v_price, p_kind || '_buy', 'Покупка: ' || p_code, v_key, null, p_kind, p_code);
  insert into public.purchases (user_id, item_code, kind, quantity, total) values (uid, p_code, p_kind, 1, v_price);
  return jsonb_build_object('status','ok','price',v_price);
end $$;

create or replace function public.asset_upgrade(p_kind text, p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'assetup:' || p_idempotency_key; v_level integer; v_max integer; v_cost numeric;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_kind = 'realty' then
    select u.level, i.max_level, i.upgrade_cost_base * u.level into v_level, v_max, v_cost
      from public.user_realty u join public.realty_items i using (code) where u.user_id = uid and u.code = p_code for update of u;
  elsif p_kind = 'business' then
    select u.level, i.max_level, i.upgrade_cost_base * u.level into v_level, v_max, v_cost
      from public.user_businesses u join public.business_items i using (code) where u.user_id = uid and u.code = p_code for update of u;
  elsif p_kind = 'car' then
    select u.level, public._setting('car_max_level')::integer, round(i.price * public._setting('car_upgrade_ratio') * u.level, 2)
      into v_level, v_max, v_cost
      from public.user_cars u join public.car_items i using (code) where u.user_id = uid and u.code = p_code for update of u;
  else
    raise exception 'invalid_choice';
  end if;
  if v_level is null then raise exception 'not_owned'; end if;
  if v_level >= v_max then raise exception 'max_level'; end if;
  -- Collect income at the old level first so the upgrade only affects future hours.
  if p_kind in ('realty','business') then perform public._collect_one(uid, p_kind, p_code); end if;
  perform public._apply_wallet_change(uid, 'cash', -v_cost, p_kind || '_upgrade', 'Улучшение ' || p_code || ' до ур. ' || (v_level + 1), v_key, null, p_kind, p_code);
  if p_kind = 'realty' then update public.user_realty set level = level + 1 where user_id = uid and code = p_code;
  elsif p_kind = 'business' then update public.user_businesses set level = level + 1 where user_id = uid and code = p_code;
  else update public.user_cars set level = level + 1 where user_id = uid and code = p_code; end if;
  return jsonb_build_object('status','ok','cost',v_cost,'level',v_level + 1);
end $$;

-- Collects pending income of one realty/business; returns the amount.
create or replace function public._collect_one(p_uid uuid, p_kind text, p_code text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_amount numeric(18,2); v_level integer; v_emp integer; ri public.realty_items; bi public.business_items;
begin
  if p_kind = 'realty' then
    select u.last_collected_at, u.level into v_last, v_level from public.user_realty u where u.user_id = p_uid and u.code = p_code for update;
    if v_last is null then raise exception 'not_owned'; end if;
    select * into ri from public.realty_items where code = p_code;
    v_amount := round(ri.income_per_hour * v_level * public._accrual_hours(v_last), 2);
    update public.user_realty set last_collected_at = now() where user_id = p_uid and code = p_code;
  else
    select u.last_collected_at, u.level, u.employees into v_last, v_level, v_emp from public.user_businesses u where u.user_id = p_uid and u.code = p_code for update;
    if v_last is null then raise exception 'not_owned'; end if;
    select * into bi from public.business_items where code = p_code;
    v_amount := round(public._business_net_hour(bi, v_level, v_emp) * public._accrual_hours(v_last), 2);
    update public.user_businesses set last_collected_at = now() where user_id = p_uid and code = p_code;
  end if;
  if v_amount >= 0.01 then
    perform public._apply_wallet_change(p_uid, 'cash', v_amount, p_kind || '_income', 'Доход: ' || p_code,
      'income:' || p_kind || ':' || p_code || ':' || p_uid || ':' || extract(epoch from v_last), null, p_kind, p_code);
    return v_amount;
  end if;
  return 0;
end $$;

-- Collects all pending realty and business income. Naturally idempotent: a repeat finds ~0 pending.
create or replace function public.collect_income(p_kind text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_total numeric := 0; r record; v_status public.account_status;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select status into v_status from public.profiles where id = uid for update;
  if v_status <> 'active' then raise exception 'account_restricted'; end if;
  for r in select 'realty' kind, code from public.user_realty where user_id = uid and (p_kind is null or p_kind = 'realty')
           union all select 'business', code from public.user_businesses where user_id = uid and (p_kind is null or p_kind = 'business') loop
    v_total := v_total + public._collect_one(uid, r.kind, r.code);
  end loop;
  return jsonb_build_object('status','ok','total',v_total);
end $$;

create or replace function public.asset_sell(p_kind text, p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'assetsell:' || p_idempotency_key; v_value numeric; v_proceeds numeric(18,2);
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_kind in ('realty','business') then perform public._collect_one(uid, p_kind, p_code); end if;
  if p_kind = 'realty' then
    select public._market_value(i.price, u.level) into v_value from public.user_realty u join public.realty_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_realty where user_id = uid and code = p_code;
  elsif p_kind = 'car' then
    select public._market_value(i.price, u.level) into v_value from public.user_cars u join public.car_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_cars where user_id = uid and code = p_code;
  elsif p_kind = 'business' then
    select public._market_value(i.price, u.level) into v_value from public.user_businesses u join public.business_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_businesses where user_id = uid and code = p_code;
  else
    raise exception 'invalid_choice';
  end if;
  if v_value is null then raise exception 'not_owned'; end if;
  v_proceeds := round(v_value * public._setting('asset_sell_ratio'), 2);
  perform public._apply_wallet_change(uid, 'cash', v_proceeds, p_kind || '_sell', 'Продажа: ' || p_code, v_key, null, p_kind, p_code);
  return jsonb_build_object('status','ok','proceeds',v_proceeds);
end $$;

create or replace function public.business_hire(p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'hire:' || p_idempotency_key; v_emp integer; v_cost numeric(18,2);
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  select employees into v_emp from public.user_businesses where user_id = uid and code = p_code for update;
  if v_emp is null then raise exception 'not_owned'; end if;
  if v_emp >= public._setting('max_employees') then raise exception 'max_employees'; end if;
  perform public._collect_one(uid, 'business', p_code);
  v_cost := public._setting('employee_cost') * (v_emp + 1);
  perform public._apply_wallet_change(uid, 'cash', -v_cost, 'business_hire', 'Найм сотрудника: ' || p_code, v_key, null, 'business', p_code);
  update public.user_businesses set employees = employees + 1 where user_id = uid and code = p_code;
  return jsonb_build_object('status','ok','cost',v_cost,'employees',v_emp + 1);
end $$;

-- ------------------------------------------------------------- capital ----
-- Bot capital: cash + BTC × rate + realty + cars + business + bank account + active deposits.
create or replace function public._assets(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'realty',   coalesce((select sum(public._market_value(i.price, u.level)) from public.user_realty u join public.realty_items i using (code) where u.user_id = p_user), 0),
    'cars',     coalesce((select sum(public._market_value(i.price, u.level)) from public.user_cars u join public.car_items i using (code) where u.user_id = p_user), 0),
    'business', coalesce((select sum(public._market_value(i.price, u.level)) from public.user_businesses u join public.business_items i using (code) where u.user_id = p_user), 0),
    'deposits', coalesce((select sum(amount) from public.bank_deposits where user_id = p_user and not claimed), 0),
    'btc_usd',  coalesce((select round(btc * public._setting('btc_rate'), 2) from public.wallets where user_id = p_user), 0));
$$;

create or replace function public._capital(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select cash + bank from public.wallets where user_id = p_user), 0)
       + (a ->> 'realty')::numeric + (a ->> 'cars')::numeric + (a ->> 'business')::numeric
       + (a ->> 'deposits')::numeric + (a ->> 'btc_usd')::numeric
    from (select public._assets(p_user) a) t;
$$;

create or replace function public.get_my_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; w public.wallets; a jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = uid;
  select * into w from public.wallets where user_id = uid;
  if not found then raise exception 'profile_not_found'; end if;
  a := public._assets(uid);
  return jsonb_build_object(
    'game_name', p.game_name, 'public_id', p.public_id, 'status', p.status,
    'xp', p.xp, 'level', p.level, 'xp_per_level', public._setting('xp_per_level'),
    'cash', w.cash, 'bank', w.bank, 'btc', w.btc, 'btc_rate', public._setting('btc_rate'),
    'assets', a,
    'assets_value', (a->>'realty')::numeric + (a->>'cars')::numeric + (a->>'business')::numeric,
    'debts', 0,
    'total_capital', public._capital(uid),
    'income_today', (select coalesce(sum(amount), 0) from public.ledger_entries
                      where user_id = uid and direction = 'credit' and account <> 'btc' and created_at >= date_trunc('day', now())
                        and op_type not in ('bank_deposit','bank_withdraw','deposit_close','btc_sell')),
    'spent_today',  (select coalesce(sum(amount), 0) from public.ledger_entries
                      where user_id = uid and direction = 'debit' and account <> 'btc' and created_at >= date_trunc('day', now())
                        and op_type not in ('bank_deposit','bank_withdraw','deposit_open','btc_buy')),
    'games_played', (select count(*) from public.game_rounds where user_id = uid),
    'shifts_done',  (select count(*) from public.work_shifts where user_id = uid),
    'cars_owned',   (select count(*) from public.user_cars where user_id = uid));
end $$;

create or replace function public.leaderboard_capital(p_limit integer default 50)
returns table (rank bigint, game_name text, level integer, total_capital numeric)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by c desc), game_name, level, c
    from (select p.game_name, p.level, public._capital(p.id) c from public.profiles p where p.status = 'active') t
   order by c desc limit least(greatest(p_limit, 1), 100);
$$;

-- Balance chart now follows the wallet.
create or replace function public.my_balance_history(p_limit integer default 40)
returns table (at timestamptz, balance numeric)
language sql stable security definer set search_path = public as $$
  select created_at, balance_after from (
    select created_at, balance_after, id from public.ledger_entries
     where user_id = auth.uid() and account = 'cash'
     order by id desc limit least(greatest(p_limit, 2), 200)
  ) t order by id;
$$;

-- --------------------------------------------- jobs/daily/games use cash ----
create or replace function public.work_shift(p_job text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; j public.jobs; v_last timestamptz;
        v_key text := 'shift:' || p_idempotency_key; v_pay numeric(18,2); v_prev jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  select jsonb_build_object('status','duplicate','salary',salary,'xp',xp_awarded) into v_prev from public.work_shifts where idempotency_key = v_key;
  if v_prev is not null then return v_prev; end if;
  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  select * into j from public.jobs where key = p_job and is_active;
  if not found then raise exception 'job_not_found'; end if;
  if p.level < j.min_level then raise exception 'level_too_low'; end if;
  if j.require_car and not exists (select 1 from public.user_cars where user_id = uid) then raise exception 'need_car'; end if;
  if public._capital(uid) < j.min_capital then raise exception 'need_capital'; end if;
  select max(created_at) into v_last from public.work_shifts where user_id = uid and job_key = p_job;
  if v_last is not null and v_last + make_interval(secs => j.cooldown_seconds) > now() then raise exception 'cooldown_active'; end if;
  v_pay := round(j.income_min + (j.income_max - j.income_min) * public._rand(), 2);
  insert into public.work_shifts (user_id, job_key, salary, xp_awarded, idempotency_key) values (uid, p_job, v_pay, j.xp_reward, v_key);
  perform public._apply_wallet_change(uid, 'cash', v_pay, 'salary', 'Зарплата: ' || p_job, v_key, null, 'job', p_job);
  update public.profiles set xp = xp + j.xp_reward, level = public._level_for_xp(xp + j.xp_reward) where id = uid;
  return jsonb_build_object('status','ok','salary',v_pay,'xp',j.xp_reward,'next_at', now() + make_interval(secs => j.cooldown_seconds));
end $$;

create or replace function public.my_jobs()
returns table (key text, income_min numeric, income_max numeric, cooldown_seconds integer,
               xp_reward integer, require_car boolean, min_capital numeric,
               next_available_at timestamptz, eligible boolean, blocker text)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() uid, public._capital(auth.uid()) cap,
                     exists (select 1 from public.user_cars where user_id = auth.uid()) has_car)
  select j.key, j.income_min, j.income_max, j.cooldown_seconds, j.xp_reward, j.require_car, j.min_capital,
         (select max(s.created_at) from public.work_shifts s where s.user_id = me.uid and s.job_key = j.key)
           + make_interval(secs => j.cooldown_seconds),
         ((not j.require_car or me.has_car) and me.cap >= j.min_capital),
         case when j.require_car and not me.has_car then 'need_car'
              when me.cap < j.min_capital then 'need_capital' end
    from public.jobs j, me
   where j.is_active and me.uid is not null
   order by j.sort_order;
$$;

create or replace function public._game_begin(p_uid uuid, p_game text, p_bet numeric, p_round uuid, p_key text)
returns public.game_settings language plpgsql security definer set search_path = public as $$
declare s public.game_settings; p public.profiles;
begin
  select * into p from public.profiles where id = p_uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  select * into s from public.game_settings where game = p_game;
  if not found then raise exception 'game_not_found'; end if;
  if not s.enabled then raise exception 'game_disabled'; end if;
  if p_bet is null or p_bet <> round(p_bet, 2) or p_bet < s.min_bet or p_bet > s.max_bet then raise exception 'invalid_bet'; end if;
  perform public._apply_wallet_change(p_uid, 'cash', -p_bet, 'game_bet', 'Ставка: ' || p_game, p_key || ':bet', null, 'game_round', p_round::text);
  return s;
end $$;

create or replace function public._game_pay(p_uid uuid, p_game text, p_round uuid, p_payout numeric, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_payout > 0 then
    perform public._apply_wallet_change(p_uid, 'cash', p_payout, 'game_win', 'Выигрыш: ' || p_game, p_key || ':win', null, 'game_round', p_round::text);
  end if;
end $$;

create or replace function public.transfer_funds(p_to_game_name text, p_amount numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; v_to uuid; v_group uuid := gen_random_uuid();
        v_fee numeric(18,2); v_key text := 'transfer:' || p_idempotency_key;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid_amount'; end if;
  if p_amount > public._setting('transfer_limit') then raise exception 'transfer_limit_exceeded'; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = v_key || ':out') then return jsonb_build_object('status','duplicate'); end if;
  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  select id into v_to from public.profiles where lower(game_name) = lower(trim(p_to_game_name));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = uid then raise exception 'self_transfer'; end if;
  perform 1 from public.wallets where user_id in (uid, v_to) order by user_id for update;
  v_fee := round(p_amount * public._setting('transfer_fee_percent') / 100, 2);
  perform public._apply_wallet_change(uid, 'cash', -(p_amount + v_fee), 'transfer_out', 'Перевод игроку ' || p_to_game_name, v_key || ':out', v_to, 'transfer', v_group::text, v_group);
  perform public._apply_wallet_change(v_to, 'cash', p_amount, 'transfer_in', 'Перевод от ' || p.game_name, v_key || ':in', uid, 'transfer', v_group::text, v_group);
  return jsonb_build_object('status','ok','group_id',v_group,'fee',v_fee);
end $$;

-- ------------------------------------------------------------- read RLS ----
alter table public.bank_deposits     enable row level security;
alter table public.bank_terms        enable row level security;
alter table public.resources         enable row level security;
alter table public.user_resources    enable row level security;
alter table public.mining_log        enable row level security;
alter table public.events            enable row level security;
alter table public.shop_items        enable row level security;
alter table public.purchases         enable row level security;
alter table public.cases             enable row level security;
alter table public.case_rewards      enable row level security;
alter table public.case_openings     enable row level security;
alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.realty_items      enable row level security;
alter table public.car_items         enable row level security;
alter table public.business_items    enable row level security;
alter table public.user_realty       enable row level security;
alter table public.user_cars         enable row level security;
alter table public.user_businesses   enable row level security;

create policy read_all on public.bank_terms     for select to authenticated using (true);
create policy read_all on public.resources      for select to authenticated using (enabled);
create policy read_all on public.events         for select to authenticated using (active);
create policy read_all on public.shop_items     for select to authenticated using (enabled);
create policy read_all on public.cases          for select to authenticated using (active);
create policy read_all on public.case_rewards   for select to authenticated using (true);
create policy read_all on public.realty_items   for select to authenticated using (active);
create policy read_all on public.car_items      for select to authenticated using (active);
create policy read_all on public.business_items for select to authenticated using (active);
create policy read_own on public.bank_deposits     for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_resources    for select to authenticated using (user_id = auth.uid());
create policy read_own on public.mining_log        for select to authenticated using (user_id = auth.uid());
create policy read_own on public.purchases         for select to authenticated using (user_id = auth.uid());
create policy read_own on public.case_openings     for select to authenticated using (user_id = auth.uid());
create policy read_own on public.promo_redemptions for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_realty       for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_cars         for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_businesses   for select to authenticated using (user_id = auth.uid());
-- promo_codes: no client policy (codes are secret until entered).

revoke all on all functions in schema public from public, anon, authenticated;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

grant execute on function public.get_my_snapshot()                              to authenticated;
grant execute on function public.work_shift(text, text)                         to authenticated;
grant execute on function public.my_jobs()                                      to authenticated;
grant execute on function public.transfer_funds(text, numeric, text)            to authenticated;
grant execute on function public.leaderboard_capital(integer)                   to authenticated;
grant execute on function public.daily_status()                                 to authenticated;
grant execute on function public.claim_daily(text)                              to authenticated;
grant execute on function public.play_game(text, numeric, jsonb, text)          to authenticated;
grant execute on function public.mines_start(numeric, integer, text)            to authenticated;
grant execute on function public.mines_state(uuid)                              to authenticated;
grant execute on function public.mines_active()                                 to authenticated;
grant execute on function public.mines_open(uuid, integer)                      to authenticated;
grant execute on function public.mines_cashout(uuid)                            to authenticated;
grant execute on function public.my_balance_history(integer)                    to authenticated;
grant execute on function public.admin_adjust_balance(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.admin_set_economy_setting(text, numeric)       to authenticated;
grant execute on function public.admin_is_admin()                               to authenticated;
grant execute on function public.registration_check(text, text)                 to anon, authenticated;
grant execute on function public.bank_deposit(numeric, text)                    to authenticated;
grant execute on function public.bank_withdraw(numeric, text)                   to authenticated;
grant execute on function public.deposit_open(numeric, integer, text)           to authenticated;
grant execute on function public.deposit_claim(bigint)                          to authenticated;
grant execute on function public.btc_buy(numeric, text)                         to authenticated;
grant execute on function public.btc_sell(numeric, text)                        to authenticated;
grant execute on function public.mine_resources()                               to authenticated;
grant execute on function public.sell_resource(text, bigint, text)              to authenticated;
grant execute on function public.shop_buy(text, integer, text)                  to authenticated;
grant execute on function public.open_case(text, text)                          to authenticated;
grant execute on function public.redeem_promo(text)                             to authenticated;
grant execute on function public.asset_buy(text, text, text)                    to authenticated;
grant execute on function public.asset_upgrade(text, text, text)                to authenticated;
grant execute on function public.asset_sell(text, text, text)                   to authenticated;
grant execute on function public.business_hire(text, text)                      to authenticated;
grant execute on function public.collect_income(text)                           to authenticated;
