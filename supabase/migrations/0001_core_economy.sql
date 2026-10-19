-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0001: identity, wallets, financial journal,
-- jobs (work shifts), transfers, admin roles and audit log.
--
-- Target: a NEW Supabase project. Never run this against the old bot database.
-- Money is stored as numeric(18,2); there is no float arithmetic anywhere.
-- All balance changes go through public._apply_wallet_change(), which runs
-- inside a single transaction, locks the wallet row and writes a ledger entry.
-- Clients have no INSERT/UPDATE/DELETE rights on financial tables.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----
create type public.account_status as enum ('active', 'restricted', 'blocked');
create type public.ledger_account as enum ('cash', 'bank');

-- ------------------------------------------------------- economy settings ----
-- Admin-editable economic parameters. Validated in set_economy_setting().
create table public.economy_settings (
  key         text primary key,
  value       numeric(18,2) not null check (value >= 0),
  description text not null default '',
  updated_at  timestamptz not null default now()
);

insert into public.economy_settings (key, value, description) values
  ('starting_capital',        50000.00, 'Стартовый банковский баланс нового игрока'),
  ('transfer_limit',         100000.00, 'Максимум за один перевод игроку'),
  ('transfer_fee_percent',        0.00, 'Комиссия за перевод, % от суммы (0 = без комиссии)'),
  ('admin_adjust_limit',   10000000.00, 'Максимум за одну административную корректировку баланса'),
  ('xp_per_level',              500.00, 'XP на один уровень: уровень = 1 + floor(XP / значение)');

-- ------------------------------------------------------------------ jobs ----
-- Catalogue of ordinary jobs. Salaries below are PLACEHOLDERS: the original
-- bot's numbers were not in the archive. Configure them in the admin panel.
create table public.jobs (
  key              text primary key check (key ~ '^[a-z_]{3,32}$'),
  salary           numeric(18,2) not null check (salary > 0),
  cooldown_seconds integer not null default 600 check (cooldown_seconds >= 0),
  xp_reward        integer not null default 10 check (xp_reward >= 0),
  min_level        integer not null default 1 check (min_level >= 1),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

insert into public.jobs (key, salary, cooldown_seconds, xp_reward, min_level) values
  ('courier',    1500.00,  300,  10, 1),
  ('waiter',     1800.00,  300,  10, 1),
  ('seller',     2000.00,  420,  12, 1),
  ('driver',     2500.00,  600,  15, 2),
  ('mechanic',   3000.00,  600,  15, 2),
  ('designer',   4000.00,  900,  20, 3),
  ('marketer',   4500.00,  900,  20, 3),
  ('programmer', 6000.00, 1200,  25, 4),
  ('engineer',   7000.00, 1200,  25, 5),
  ('finance',    8000.00, 1800,  30, 6),
  ('manager',   10000.00, 1800,  35, 7),
  ('director',  15000.00, 3600,  50, 9);

-- ------------------------------------------------------------- profiles ----
-- One row per auth user. login = unique login name used to sign in.
-- game_name = public display name, unique case-insensitively.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  login         text not null unique check (login ~ '^[a-z0-9_]{3,20}$'),
  game_name     text not null check (char_length(game_name) between 3 and 20
                                     and game_name ~ '^[A-Za-z0-9_ ]+$'),
  public_id     bigint generated always as identity unique,
  status        public.account_status not null default 'active',
  xp            bigint not null default 0 check (xp >= 0),
  level         integer not null default 1 check (level >= 1),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index profiles_game_name_ci on public.profiles (lower(game_name));

-- ------------------------------------------------------------- wallets ----
-- Liquid money only. Total capital is derived by get_my_snapshot(), never
-- edited directly.
create table public.wallets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  cash       numeric(18,2) not null default 0 check (cash >= 0),
  bank       numeric(18,2) not null default 0 check (bank >= 0),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------- financial journal ----
-- Append-only. Every balance change is one row. Transfers create two rows
-- sharing group_id (debit + credit). idempotency_key is globally unique, so a
-- retried request can never post the same money twice.
create table public.ledger_entries (
  id              bigint generated always as identity primary key,
  group_id        uuid not null default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id),
  op_type         text not null check (op_type in
                    ('signup_bonus','salary','transfer_out','transfer_in',
                     'admin_credit','admin_debit')),
  direction       text not null check (direction in ('credit','debit')),
  account         public.ledger_account not null,
  amount          numeric(18,2) not null check (amount > 0),
  balance_before  numeric(18,2) not null check (balance_before >= 0),
  balance_after   numeric(18,2) not null check (balance_after >= 0),
  counterparty_id uuid references public.profiles(id),
  reason          text not null check (char_length(reason) between 3 and 200),
  related_type    text,
  related_id      text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  check ((direction = 'credit' and balance_after = balance_before + amount)
      or (direction = 'debit'  and balance_after = balance_before - amount))
);

create index ledger_entries_user_time on public.ledger_entries (user_id, created_at desc);
create index ledger_entries_group on public.ledger_entries (group_id);

-- ------------------------------------------------------- work history ----
create table public.work_shifts (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  job_key         text not null references public.jobs(key),
  salary          numeric(18,2) not null check (salary > 0),
  xp_awarded      integer not null check (xp_awarded >= 0),
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);

create index work_shifts_user_job_time on public.work_shifts (user_id, job_key, created_at desc);

-- ---------------------------------------------------------- admin ----
-- Admin accounts are ordinary auth users granted a role by a DBA-run INSERT
-- (SQL editor). There is no public admin registration.
create table public.admin_roles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'moderator', 'operator')),
  granted_at timestamptz not null default now()
);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id),
  action      text not null,
  target_type text,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_time on public.audit_logs (created_at desc);

-- ------------------------------------------- append-only enforcement ----
create or replace function public._reject_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'append_only_table: % is immutable', tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger ledger_entries_immutable
  before update or delete on public.ledger_entries
  for each row execute function public._reject_mutation();

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public._reject_mutation();

-- -------------------------------------------------- internal helpers ----
-- The ONLY place where wallet balances change. Must be called from a
-- security definer function that has already validated the caller.
create or replace function public._apply_wallet_change(
  p_user          uuid,
  p_account       public.ledger_account,
  p_delta         numeric,          -- signed: >0 credit, <0 debit
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
  v_before numeric(18,2);
  v_after  numeric(18,2);
  v_amount numeric(18,2) := abs(p_delta);
begin
  if p_delta = 0 then
    raise exception 'zero_amount';
  end if;

  if p_account = 'cash' then
    select w.cash into v_before from public.wallets w where w.user_id = p_user for update;
  else
    select w.bank into v_before from public.wallets w where w.user_id = p_user for update;
  end if;

  if not found then
    raise exception 'wallet_not_found';
  end if;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'insufficient_funds';
  end if;

  if p_account = 'cash' then
    update public.wallets set cash = v_after, updated_at = now() where user_id = p_user;
  else
    update public.wallets set bank = v_after, updated_at = now() where user_id = p_user;
  end if;

  insert into public.ledger_entries (
    group_id, user_id, op_type, direction, account, amount,
    balance_before, balance_after, counterparty_id, reason,
    related_type, related_id, idempotency_key
  ) values (
    p_group, p_user, p_op_type, case when p_delta > 0 then 'credit' else 'debit' end,
    p_account, v_amount, v_before, v_after, p_counterparty, p_reason,
    p_related_type, p_related_id, p_key
  );
end;
$$;

create or replace function public._setting(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select value from public.economy_settings where key = p_key;
$$;

create or replace function public._level_for_xp(p_xp bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 1 + floor(p_xp / greatest(public._setting('xp_per_level'), 1))::integer;
$$;

create or replace function public._valid_key(p_key text)
returns boolean
language sql
immutable
as $$
  select p_key is not null and char_length(p_key) between 8 and 80;
$$;

-- --------------------------------------------------- signup (trigger) ----
-- Runs exactly once per auth.users INSERT. Re-registration with the same
-- login is impossible (unique constraint), so the starting bonus cannot be
-- claimed twice. The bonus is written to the journal with key 'signup:<uid>'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_login text := lower(trim(coalesce(new.raw_user_meta_data ->> 'login', '')));
  v_name  text := trim(coalesce(new.raw_user_meta_data ->> 'game_name', ''));
  v_start numeric(18,2) := public._setting('starting_capital');
begin
  if v_login !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_login';
  end if;
  if char_length(v_name) not between 3 and 20 or v_name !~ '^[A-Za-z0-9_ ]+$' then
    raise exception 'invalid_game_name';
  end if;

  insert into public.profiles (id, login, game_name)
  values (new.id, v_login, v_name);

  insert into public.wallets (user_id, cash, bank)
  values (new.id, 0, 0);

  perform public._apply_wallet_change(
    new.id, 'bank', v_start, 'signup_bonus', 'Стартовый капитал',
    'signup:' || new.id::text, null, 'account', new.id::text
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ RLS ----
alter table public.economy_settings enable row level security;
alter table public.jobs             enable row level security;
alter table public.profiles         enable row level security;
alter table public.wallets          enable row level security;
alter table public.ledger_entries   enable row level security;
alter table public.work_shifts      enable row level security;
alter table public.admin_roles      enable row level security;
alter table public.audit_logs       enable row level security;

create policy economy_settings_read on public.economy_settings
  for select to authenticated using (true);
create policy jobs_read on public.jobs
  for select to authenticated using (is_active);
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy wallets_read_own on public.wallets
  for select to authenticated using (user_id = auth.uid());
create policy ledger_read_own on public.ledger_entries
  for select to authenticated using (user_id = auth.uid());
create policy work_shifts_read_own on public.work_shifts
  for select to authenticated using (user_id = auth.uid());
-- admin_roles and audit_logs: no client policy at all (deny by default).

-- Clients get read access only through policies above. Writes happen only
-- inside security definer functions. The privilege revokes and explicit
-- grants are at the END of this file so they also cover the functions above.

-- ------------------------------------------------------- player RPCs ----
create or replace function public.get_my_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p   public.profiles;
  w   public.wallets;
  v_assets numeric(18,2) := 0;   -- no asset tables yet: real value will come from them
  v_debts  numeric(18,2) := 0;   -- no loan system yet
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = uid;
  select * into w from public.wallets where user_id = uid;
  if not found then raise exception 'profile_not_found'; end if;

  return jsonb_build_object(
    'game_name', p.game_name,
    'public_id', p.public_id,
    'status', p.status,
    'xp', p.xp,
    'level', p.level,
    'cash', w.cash,
    'bank', w.bank,
    'assets_value', v_assets,
    'debts', v_debts,
    'total_capital', w.cash + w.bank + v_assets - v_debts
  );
end;
$$;

create or replace function public.work_shift(p_job text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  p       public.profiles;
  j       public.jobs;
  v_last  timestamptz;
  v_xp    integer;
  v_key   text := 'shift:' || p_idempotency_key;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;

  if exists (select 1 from public.ledger_entries where idempotency_key = v_key) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  -- Serialise all actions of one player.
  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;

  select * into j from public.jobs where key = p_job and is_active;
  if not found then raise exception 'job_not_found'; end if;
  if p.level < j.min_level then raise exception 'level_too_low'; end if;

  select max(created_at) into v_last from public.work_shifts
   where user_id = uid and job_key = p_job;
  if v_last is not null and v_last + make_interval(secs => j.cooldown_seconds) > now() then
    raise exception 'cooldown_active';
  end if;

  insert into public.work_shifts (user_id, job_key, salary, xp_awarded, idempotency_key)
  values (uid, p_job, j.salary, j.xp_reward, v_key);

  perform public._apply_wallet_change(
    uid, 'bank', j.salary, 'salary', 'Зарплата: ' || p_job,
    v_key, null, 'job', p_job
  );

  v_xp := j.xp_reward;
  update public.profiles
     set xp = xp + v_xp,
         level = public._level_for_xp(xp + v_xp)
   where id = uid;

  return jsonb_build_object('status', 'ok', 'salary', j.salary, 'xp', v_xp);
end;
$$;

create or replace function public.transfer_funds(
  p_to_game_name  text,
  p_amount        numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  p       public.profiles;
  v_to    uuid;
  v_group uuid := gen_random_uuid();
  v_limit numeric := public._setting('transfer_limit');
  v_fee_pct numeric := public._setting('transfer_fee_percent');
  v_fee   numeric(18,2);
  v_key   text := 'transfer:' || p_idempotency_key;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount';
  end if;
  if p_amount > v_limit then raise exception 'transfer_limit_exceeded'; end if;

  if exists (select 1 from public.ledger_entries where idempotency_key = v_key || ':out') then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;

  select id into v_to from public.profiles where lower(game_name) = lower(trim(p_to_game_name));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = uid then raise exception 'self_transfer'; end if;

  -- Lock both wallets in a fixed order to prevent deadlocks.
  perform 1 from public.wallets where user_id in (uid, v_to) order by user_id for update;

  v_fee := round(p_amount * v_fee_pct / 100, 2);

  perform public._apply_wallet_change(
    uid, 'bank', -(p_amount + v_fee), 'transfer_out',
    'Перевод игроку ' || p_to_game_name, v_key || ':out',
    v_to, 'transfer', v_group::text, v_group
  );
  perform public._apply_wallet_change(
    v_to, 'bank', p_amount, 'transfer_in',
    'Перевод от ' || p.game_name, v_key || ':in',
    uid, 'transfer', v_group::text, v_group
  );

  return jsonb_build_object('status', 'ok', 'group_id', v_group, 'fee', v_fee);
end;
$$;

create or replace function public.leaderboard_capital(p_limit integer default 50)
returns table (rank bigint, game_name text, level integer, total_capital numeric)
language sql
stable
security definer
set search_path = public
as $$
  select row_number() over (order by (w.cash + w.bank) desc) as rank,
         p.game_name, p.level, (w.cash + w.bank) as total_capital
    from public.profiles p
    join public.wallets w on w.user_id = p.id
   where p.status = 'active'
   order by (w.cash + w.bank) desc
   limit least(greatest(p_limit, 1), 100);
$$;

-- ------------------------------------------------------- admin RPCs ----
create or replace function public._require_admin(p_roles text[] default array['owner','admin'])
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.admin_roles where user_id = uid and role = any(p_roles)) then
    raise exception 'forbidden';
  end if;
  return uid;
end;
$$;

create or replace function public.admin_adjust_balance(
  p_target_user   uuid,
  p_account       text,
  p_amount        numeric,      -- signed: positive credits, negative debits
  p_reason        text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._require_admin(array['owner','admin']);
  v_key   text := 'admin:' || p_idempotency_key;
  v_acc   public.ledger_account := p_account::public.ledger_account;
  v_limit numeric := public._setting('admin_adjust_limit');
begin
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount';
  end if;
  if abs(p_amount) > v_limit then raise exception 'admin_adjust_limit_exceeded'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.profiles where id = p_target_user) then
    raise exception 'target_not_found';
  end if;

  if exists (select 1 from public.ledger_entries where idempotency_key = v_key) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  perform public._apply_wallet_change(
    p_target_user, v_acc, p_amount,
    case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
    trim(p_reason), v_key, v_actor, 'admin', v_actor::text
  );

  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (v_actor, 'balance_adjust', 'profile', p_target_user::text,
          jsonb_build_object('account', p_account, 'amount', p_amount, 'reason', trim(p_reason)));

  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.admin_set_economy_setting(p_key text, p_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._require_admin(array['owner','admin']);
  v_old   numeric;
begin
  if p_value is null or p_value < 0 or p_value <> round(p_value, 2) then
    raise exception 'invalid_value';
  end if;
  select value into v_old from public.economy_settings where key = p_key for update;
  if not found then raise exception 'unknown_setting'; end if;

  update public.economy_settings set value = p_value, updated_at = now() where key = p_key;

  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (v_actor, 'economy_setting_change', 'economy_setting', p_key,
          jsonb_build_object('old', v_old, 'new', p_value));

  return jsonb_build_object('status', 'ok', 'old', v_old, 'new', p_value);
end;
$$;

create or replace function public.admin_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_roles
                  where user_id = auth.uid() and role in ('owner','admin','moderator','operator'));
$$;

-- ------------------------------------------------ grants for RPC access ----
-- Supabase grants new functions to anon/authenticated by default. Remove all
-- of that first; helpers (_apply_wallet_change, _setting, handle_new_user, ...)
-- then stay callable only by the database owner, i.e. from inside the RPCs.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_my_snapshot()                              to authenticated;
grant execute on function public.work_shift(text, text)                         to authenticated;
grant execute on function public.transfer_funds(text, numeric, text)            to authenticated;
grant execute on function public.leaderboard_capital(integer)                   to authenticated;
grant execute on function public.admin_adjust_balance(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.admin_set_economy_setting(text, numeric)       to authenticated;
grant execute on function public.admin_is_admin()                               to authenticated;
