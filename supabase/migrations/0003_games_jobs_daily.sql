-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0003
--  * registration availability check (clear error instead of a generic one)
--  * jobs ported from the old bot (bot/services/jobs_cases_seed.py):
--    random income in [income_min, income_max], cooldown, capital requirement,
--    car requirement
--  * daily reward ported from bot/services/daily.py: base * streak, 24h
--    cooldown, streak resets after 48h, max streak 7
--  * betting games ported from bot/services/{casino,spin,slots,dice,updown,
--    trade,emoji_games,mines}.py with the same default rules and bet limits.
-- Virtual in-game currency only. Every outcome is decided on the server with a
-- cryptographically strong random source; the client only sends its choice.
-- ============================================================================

-- ------------------------------------------------- new ledger operation types
alter table public.ledger_entries drop constraint ledger_entries_op_type_check;
alter table public.ledger_entries add constraint ledger_entries_op_type_check check (op_type in
  ('signup_bonus','salary','transfer_out','transfer_in','admin_credit','admin_debit',
   'daily_reward','game_bet','game_win'));

-- ------------------------------------------------------ randomness helpers ---
-- Uniform number in [0, 1) from gen_random_uuid() (122 random bits, CSPRNG).
create or replace function public._rand()
returns numeric
language sql
volatile
set search_path = public
as $$
  select ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint
         / 4503599627370496.0;
$$;

-- Integer in [lo, hi].
create or replace function public._rand_int(lo integer, hi integer)
returns integer
language sql
volatile
set search_path = public
as $$
  select lo + floor(public._rand() * (hi - lo + 1))::integer;
$$;

-- Weighted pick from [{"v": <any>, "w": <int>}, ...]; returns the "v" element.
create or replace function public._weighted_pick(p_items jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_total numeric := 0;
  v_roll  numeric;
  v_acc   numeric := 0;
  v_item  jsonb;
begin
  select coalesce(sum((e ->> 'w')::numeric), 0) into v_total from jsonb_array_elements(p_items) e;
  if v_total <= 0 then raise exception 'bad_game_config'; end if;
  v_roll := public._rand() * v_total;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_acc := v_acc + (v_item ->> 'w')::numeric;
    if v_roll < v_acc then return v_item -> 'v'; end if;
  end loop;
  return p_items -> (jsonb_array_length(p_items) - 1) -> 'v';
end;
$$;

-- --------------------------------------------- registration availability ----
create or replace function public.registration_check(p_login text, p_game_name text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'login_taken', exists (select 1 from public.profiles where login = lower(trim(p_login))),
    'name_taken',  exists (select 1 from public.profiles where lower(game_name) = lower(trim(p_game_name)))
  );
$$;

-- ------------------------------------------------------------- jobs (bot) ---
alter table public.jobs rename column salary to income_min;
alter table public.jobs add column income_max numeric(18,2);
alter table public.jobs add column require_car boolean not null default false;
alter table public.jobs add column min_capital numeric(18,2) not null default 0 check (min_capital >= 0);
alter table public.jobs add column sort_order integer not null default 100;

update public.jobs set income_max = income_min;
alter table public.jobs alter column income_max set not null;
alter table public.jobs add constraint jobs_income_range check (income_max >= income_min);

-- Jobs that do not exist in the bot stay for history (work_shifts FK) but are hidden.
update public.jobs set is_active = false
 where key not in ('courier','taxi','mechanic','programmer','engineer','financier','entrepreneur','director');

insert into public.jobs (key, income_min, income_max, cooldown_seconds, xp_reward, min_level,
                         require_car, min_capital, sort_order, is_active) values
  ('courier',       20000.00,   50000.00,  1800, 10, 1, false,         0.00, 1, true),
  ('taxi',          30000.00,   70000.00,  2400, 12, 1, true,          0.00, 2, true),
  ('mechanic',      40000.00,   90000.00,  3600, 15, 1, false,    500000.00, 3, true),
  ('programmer',    60000.00,  130000.00,  5400, 20, 1, false,   1000000.00, 4, true),
  ('engineer',      80000.00,  180000.00,  7200, 25, 1, false,   3000000.00, 5, true),
  ('financier',    120000.00,  300000.00, 10800, 30, 1, false,  10000000.00, 6, true),
  ('entrepreneur', 200000.00,  500000.00, 14400, 40, 1, false,  25000000.00, 7, true),
  ('director',     400000.00, 1000000.00, 21600, 50, 1, false, 100000000.00, 8, true)
on conflict (key) do update set
  income_min = excluded.income_min, income_max = excluded.income_max,
  cooldown_seconds = excluded.cooldown_seconds, xp_reward = excluded.xp_reward,
  min_level = excluded.min_level, require_car = excluded.require_car,
  min_capital = excluded.min_capital, sort_order = excluded.sort_order, is_active = true;

-- Liquid capital used for job requirements until asset tables exist.
create or replace function public._capital(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select cash + bank from public.wallets where user_id = p_user), 0);
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
  v_key   text := 'shift:' || p_idempotency_key;
  v_pay   numeric(18,2);
  v_prev  jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;

  select jsonb_build_object('status', 'duplicate', 'salary', salary, 'xp', xp_awarded)
    into v_prev from public.work_shifts where idempotency_key = v_key;
  if v_prev is not null then return v_prev; end if;

  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;

  select * into j from public.jobs where key = p_job and is_active;
  if not found then raise exception 'job_not_found'; end if;
  if p.level < j.min_level then raise exception 'level_too_low'; end if;
  if j.require_car then raise exception 'need_car'; end if;   -- no garage yet: no player owns a car
  if public._capital(uid) < j.min_capital then raise exception 'need_capital'; end if;

  select max(created_at) into v_last from public.work_shifts where user_id = uid and job_key = p_job;
  if v_last is not null and v_last + make_interval(secs => j.cooldown_seconds) > now() then
    raise exception 'cooldown_active';
  end if;

  v_pay := round(j.income_min + (j.income_max - j.income_min) * public._rand(), 2);

  insert into public.work_shifts (user_id, job_key, salary, xp_awarded, idempotency_key)
  values (uid, p_job, v_pay, j.xp_reward, v_key);

  perform public._apply_wallet_change(uid, 'bank', v_pay, 'salary', 'Зарплата: ' || p_job, v_key, null, 'job', p_job);

  update public.profiles
     set xp = xp + j.xp_reward, level = public._level_for_xp(xp + j.xp_reward)
   where id = uid;

  return jsonb_build_object('status', 'ok', 'salary', v_pay, 'xp', j.xp_reward,
                            'next_at', now() + make_interval(secs => j.cooldown_seconds));
end;
$$;

-- Job list with the player's own cooldown and eligibility.
create or replace function public.my_jobs()
returns table (key text, income_min numeric, income_max numeric, cooldown_seconds integer,
               xp_reward integer, require_car boolean, min_capital numeric,
               next_available_at timestamptz, eligible boolean, blocker text)
language sql
stable
security definer
set search_path = public
as $$
  select j.key, j.income_min, j.income_max, j.cooldown_seconds, j.xp_reward, j.require_car, j.min_capital,
         (select max(s.created_at) from public.work_shifts s where s.user_id = auth.uid() and s.job_key = j.key)
           + make_interval(secs => j.cooldown_seconds) as next_available_at,
         (not j.require_car and public._capital(auth.uid()) >= j.min_capital) as eligible,
         case when j.require_car then 'need_car'
              when public._capital(auth.uid()) < j.min_capital then 'need_capital'
              else null end as blocker
    from public.jobs j
   where j.is_active and auth.uid() is not null
   order by j.sort_order;
$$;

-- --------------------------------------------------------- daily reward ----
alter table public.profiles add column daily_streak integer not null default 0 check (daily_streak >= 0);
alter table public.profiles add column last_daily_at timestamptz;

insert into public.economy_settings (key, value, description) values
  ('daily_base', 100000.00, 'Ежедневная награда: база × серия (1..7)')
on conflict (key) do nothing;

create or replace function public._daily_next_streak(p public.profiles)
returns integer
language sql
stable
set search_path = public
as $$
  select case
    when p.last_daily_at is null then 1
    when now() - p.last_daily_at < interval '24 hours' then greatest(p.daily_streak, 1)
    when now() - p.last_daily_at > interval '48 hours' then 1
    when p.daily_streak + 1 > 7 then 1
    else greatest(p.daily_streak + 1, 1)
  end;
$$;

create or replace function public.daily_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.profiles;
  v_can boolean;
  v_streak integer;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'not_authenticated'; end if;
  v_can := p.last_daily_at is null or now() - p.last_daily_at >= interval '24 hours';
  v_streak := case when v_can then public._daily_next_streak(p) else greatest(p.daily_streak, 1) end;
  return jsonb_build_object(
    'can_claim', v_can,
    'streak', v_streak,
    'reward', round(public._setting('daily_base') * v_streak, 2),
    'next_at', coalesce(p.last_daily_at + interval '24 hours', now()));
end;
$$;

create or replace function public.claim_daily(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  v_streak integer;
  v_reward numeric(18,2);
  v_key text := 'daily:' || p_idempotency_key;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = v_key) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  if p.last_daily_at is not null and now() - p.last_daily_at < interval '24 hours' then
    raise exception 'daily_already_claimed';
  end if;

  v_streak := public._daily_next_streak(p);
  v_reward := round(public._setting('daily_base') * v_streak, 2);

  update public.profiles set daily_streak = v_streak, last_daily_at = now() where id = uid;
  perform public._apply_wallet_change(uid, 'bank', v_reward, 'daily_reward',
                                      'Ежедневная награда, день ' || v_streak, v_key, null, 'daily', v_streak::text);

  return jsonb_build_object('status', 'ok', 'reward', v_reward, 'streak', v_streak);
end;
$$;

-- ------------------------------------------------------------- games -------
create table public.game_settings (
  game       text primary key check (game in
               ('casino','spin','slots','dice','updown','trade','basketball','darts','bowling','mines')),
  enabled    boolean not null default true,
  min_bet    numeric(18,2) not null check (min_bet > 0),
  max_bet    numeric(18,2) not null,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (max_bet >= min_bet)
);

-- Defaults copied from bot/services/settings_service.py (GAME_DEFAULTS and *_DEFAULT_CONFIG).
insert into public.game_settings (game, min_bet, max_bet, config) values
  ('casino', 100, 1000000, '{"multipliers":[{"v":0,"w":40},{"v":0.5,"w":20},{"v":1,"w":15},{"v":2,"w":12},{"v":3,"w":7},{"v":5,"w":4},{"v":10,"w":2}]}'),
  ('spin',   100, 1000000, '{"multipliers":[{"v":0,"w":35},{"v":0.5,"w":22},{"v":1,"w":18},{"v":2,"w":12},{"v":3,"w":7},{"v":5,"w":4},{"v":10,"w":2}]}'),
  ('slots',  100,  500000, '{"symbols":[{"v":"cherry","w":30},{"v":"lemon","w":25},{"v":"orange","w":20},{"v":"star","w":12},{"v":"diamond","w":8},{"v":"seven","w":5}],
                             "triple":{"cherry":5,"lemon":8,"orange":10,"star":20,"diamond":40,"seven":100},"pair":1.5}'),
  ('dice',   100, 1000000, '{"payout_mult":5.5}'),
  ('updown', 100, 1000000, '{"payout_mult":1.9}'),
  ('trade',  100, 1000000, '{"payout_mult":1.9}'),
  ('basketball', 100, 1000000, '{"min":1,"max":5,"value_mults":{"4":2.0,"5":2.0}}'),
  ('darts',      100, 1000000, '{"min":1,"max":6,"value_mults":{"6":5.0,"5":2.0}}'),
  ('bowling',    100, 1000000, '{"min":1,"max":6,"value_mults":{"6":5.0,"5":2.0}}'),
  ('mines',  100,  500000, '{"options":[3,5,10],"multipliers":{
     "3":[1.12,1.28,1.48,1.72,2.02,2.40,2.88,3.50,4.30,5.40,6.90,9.00,12.00,16.50,23.00,33.00,50.00,80.00,140.00,250.00,500.00,1000.00],
     "5":[1.20,1.50,1.90,2.45,3.20,4.25,5.80,8.00,11.50,17.00,26.00,42.00,70.00,120.00,220.00,420.00,850.00,1800.00,4000.00,10000.00],
     "10":[1.45,2.20,3.40,5.40,9.00,15.50,28.00,52.00,100.00,200.00,420.00,950.00,2300.00,6000.00,18000.00]}}');

create table public.game_rounds (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  game            text not null references public.game_settings(game),
  bet             numeric(18,2) not null check (bet > 0),
  multiplier      numeric(18,2) not null default 0 check (multiplier >= 0),
  payout          numeric(18,2) not null default 0 check (payout >= 0),
  status          text not null default 'settled' check (status in ('active','settled')),
  choice          jsonb not null default '{}'::jsonb,
  result          jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create index game_rounds_user_time on public.game_rounds (user_id, created_at desc);
create unique index game_rounds_one_active_mines on public.game_rounds (user_id) where status = 'active';

-- Hidden server state (mine positions). Never readable by clients.
create table public.game_round_secrets (
  round_id uuid primary key references public.game_rounds(id) on delete cascade,
  secret   jsonb not null
);

alter table public.game_settings      enable row level security;
alter table public.game_rounds        enable row level security;
alter table public.game_round_secrets enable row level security;

create policy game_settings_read on public.game_settings for select to authenticated using (true);
create policy game_rounds_read_own on public.game_rounds for select to authenticated using (user_id = auth.uid());

-- Shared bet validation + debit. Returns the locked settings row.
create or replace function public._game_begin(
  p_uid uuid, p_game text, p_bet numeric, p_round uuid, p_key text
) returns public.game_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.game_settings;
  p public.profiles;
begin
  select * into p from public.profiles where id = p_uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  select * into s from public.game_settings where game = p_game;
  if not found then raise exception 'game_not_found'; end if;
  if not s.enabled then raise exception 'game_disabled'; end if;
  if p_bet is null or p_bet <> round(p_bet, 2) or p_bet < s.min_bet or p_bet > s.max_bet then
    raise exception 'invalid_bet';
  end if;
  perform public._apply_wallet_change(p_uid, 'bank', -p_bet, 'game_bet', 'Ставка: ' || p_game,
                                      p_key || ':bet', null, 'game_round', p_round::text);
  return s;
end;
$$;

create or replace function public._game_pay(p_uid uuid, p_game text, p_round uuid, p_payout numeric, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_payout > 0 then
    perform public._apply_wallet_change(p_uid, 'bank', p_payout, 'game_win', 'Выигрыш: ' || p_game,
                                        p_key || ':win', null, 'game_round', p_round::text);
  end if;
end;
$$;

-- One-shot games. p_choice depends on the game:
--   dice {"pick":1..6}; updown/trade {"direction":"up"|"down"}; others {}.
create or replace function public.play_game(p_game text, p_bet numeric, p_choice jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_key  text := 'game:' || p_idempotency_key;
  v_id   uuid := gen_random_uuid();
  s      public.game_settings;
  v_mult numeric := 0;
  v_res  jsonb := '{}'::jsonb;
  v_pay  numeric(18,2);
  v_prev jsonb;
  v_pick integer;
  v_dir  text;
  v_a    integer;
  v_b    integer;
  v_val  integer;
  r1 text; r2 text; r3 text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if p_game = 'mines' then raise exception 'use_mines_rpc'; end if;
  p_choice := coalesce(p_choice, '{}'::jsonb);

  select jsonb_build_object('status','duplicate','round_id',id,'game',game,'bet',bet,'multiplier',multiplier,
                            'payout',payout,'result',result)
    into v_prev from public.game_rounds where idempotency_key = v_key;
  if v_prev is not null then return v_prev; end if;

  -- Validate the choice before money moves.
  if p_game = 'dice' then
    v_pick := (p_choice ->> 'pick')::integer;
    if v_pick is null or v_pick not between 1 and 6 then raise exception 'invalid_choice'; end if;
  elsif p_game in ('updown','trade') then
    v_dir := p_choice ->> 'direction';
    if v_dir is null or v_dir not in ('up','down') then raise exception 'invalid_choice'; end if;
  end if;

  s := public._game_begin(uid, p_game, p_bet, v_id, v_key);

  if p_game in ('casino','spin') then
    v_mult := (public._weighted_pick(s.config -> 'multipliers'))::text::numeric;
    v_res := jsonb_build_object('multiplier', v_mult);

  elsif p_game = 'slots' then
    r1 := public._weighted_pick(s.config -> 'symbols') #>> '{}';
    r2 := public._weighted_pick(s.config -> 'symbols') #>> '{}';
    r3 := public._weighted_pick(s.config -> 'symbols') #>> '{}';
    if r1 = r2 and r2 = r3 then
      v_mult := coalesce((s.config -> 'triple' ->> r1)::numeric, 5);
    elsif r1 = r2 or r2 = r3 or r1 = r3 then
      v_mult := coalesce((s.config ->> 'pair')::numeric, 1.5);
    end if;
    v_res := jsonb_build_object('reels', jsonb_build_array(r1, r2, r3),
                                'jackpot', r1 = 'seven' and r2 = 'seven' and r3 = 'seven');

  elsif p_game = 'dice' then
    v_val := public._rand_int(1, 6);
    if v_val = v_pick then v_mult := (s.config ->> 'payout_mult')::numeric; end if;
    v_res := jsonb_build_object('value', v_val, 'pick', v_pick);

  elsif p_game = 'updown' then
    v_a := public._rand_int(1, 100);
    loop
      v_b := public._rand_int(1, 100);
      exit when v_b <> v_a;
    end loop;
    if (v_b > v_a and v_dir = 'up') or (v_b < v_a and v_dir = 'down') then
      v_mult := (s.config ->> 'payout_mult')::numeric;
    end if;
    v_res := jsonb_build_object('from', v_a, 'to', v_b, 'direction', v_dir);

  elsif p_game = 'trade' then
    v_a := public._rand_int(10000, 50000);
    v_b := public._rand_int(1, 500);
    if public._rand() < 0.5 then v_b := -v_b; end if;
    if (v_b > 0 and v_dir = 'up') or (v_b < 0 and v_dir = 'down') then
      v_mult := (s.config ->> 'payout_mult')::numeric;
    end if;
    -- A short random path that ends at open + tick, for the chart animation.
    v_res := jsonb_build_object('open', v_a, 'close', v_a + v_b, 'direction', v_dir,
      'path', (select jsonb_agg(v_a + round(v_b * i / 12.0 + (public._rand() - 0.5) * abs(v_b) * 0.6 * (12 - i) / 12.0))
                 from generate_series(0, 12) i));

  elsif p_game in ('basketball','darts','bowling') then
    v_val := public._rand_int((s.config ->> 'min')::integer, (s.config ->> 'max')::integer);
    v_mult := coalesce((s.config -> 'value_mults' ->> v_val::text)::numeric, 0);
    v_res := jsonb_build_object('value', v_val);

  else
    raise exception 'game_not_found';
  end if;

  v_pay := round(p_bet * v_mult, 2);
  insert into public.game_rounds (id, user_id, game, bet, multiplier, payout, status, choice, result, idempotency_key, settled_at)
  values (v_id, uid, p_game, p_bet, v_mult, v_pay, 'settled', p_choice, v_res, v_key, now());
  perform public._game_pay(uid, p_game, v_id, v_pay, v_key);

  return jsonb_build_object('status','ok','round_id',v_id,'game',p_game,'bet',p_bet,'multiplier',v_mult,
                            'payout',v_pay,'result',v_res);
end;
$$;

-- ------------------------------------------------------------- mines -------
create or replace function public.mines_start(p_bet numeric, p_mines integer, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  v_key text := 'game:' || p_idempotency_key;
  v_id  uuid := gen_random_uuid();
  s     public.game_settings;
  v_pos integer[];
  v_prev uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  select id into v_prev from public.game_rounds where idempotency_key = v_key;
  if v_prev is not null then return public.mines_state(v_prev); end if;

  select * into s from public.game_settings where game = 'mines';
  if p_mines is null or not (s.config -> 'options') @> to_jsonb(p_mines) then raise exception 'invalid_choice'; end if;
  if exists (select 1 from public.game_rounds where user_id = uid and status = 'active') then
    raise exception 'round_already_active';
  end if;

  s := public._game_begin(uid, 'mines', p_bet, v_id, v_key);

  select array_agg(c order by c) into v_pos
    from (select c from generate_series(0, 24) c order by public._rand() limit p_mines) t;

  insert into public.game_rounds (id, user_id, game, bet, status, choice, result, idempotency_key)
  values (v_id, uid, 'mines', p_bet, 'active', jsonb_build_object('mines', p_mines),
          jsonb_build_object('opened', '[]'::jsonb), v_key);
  insert into public.game_round_secrets (round_id, secret) values (v_id, jsonb_build_object('mines', to_jsonb(v_pos)));

  return public.mines_state(v_id);
end;
$$;

-- Public view of a mines round. Mine positions are revealed only after it ends.
create or replace function public.mines_state(p_round uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.game_rounds;
  v_mines integer;
  v_opened integer;
  v_table jsonb;
  v_next numeric;
  v_curr numeric;
begin
  select * into r from public.game_rounds where id = p_round and user_id = auth.uid() and game = 'mines';
  if not found then raise exception 'round_not_found'; end if;
  v_mines := (r.choice ->> 'mines')::integer;
  v_opened := jsonb_array_length(r.result -> 'opened');
  select config -> 'multipliers' -> v_mines::text into v_table from public.game_settings where game = 'mines';
  v_curr := case when v_opened = 0 then 0 else (v_table ->> (v_opened - 1))::numeric end;
  v_next := (v_table ->> v_opened)::numeric;
  return jsonb_build_object(
    'round_id', r.id, 'status', r.status, 'bet', r.bet, 'mines', v_mines,
    'opened', r.result -> 'opened', 'current_multiplier', v_curr, 'next_multiplier', v_next,
    'cashout_value', round(r.bet * v_curr, 2), 'payout', r.payout, 'outcome', r.result ->> 'outcome',
    'mine_positions', case when r.status = 'settled'
                           then (select secret -> 'mines' from public.game_round_secrets where round_id = r.id)
                           else null end);
end;
$$;

create or replace function public.mines_active()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.mines_state(id) from public.game_rounds
   where user_id = auth.uid() and game = 'mines' and status = 'active' limit 1;
$$;

create or replace function public.mines_open(p_round uuid, p_cell integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.game_rounds;
  v_mines jsonb;
  v_opened jsonb;
  v_safe integer;
  v_table jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_cell is null or p_cell not between 0 and 24 then raise exception 'invalid_choice'; end if;
  select * into r from public.game_rounds where id = p_round and user_id = uid and game = 'mines' for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.status <> 'active' then return public.mines_state(p_round); end if;   -- replay-safe

  v_opened := r.result -> 'opened';
  if v_opened @> to_jsonb(p_cell) then return public.mines_state(p_round); end if;
  select secret -> 'mines' into v_mines from public.game_round_secrets where round_id = p_round;

  if v_mines @> to_jsonb(p_cell) then
    update public.game_rounds
       set status = 'settled', settled_at = now(), multiplier = 0, payout = 0,
           result = jsonb_build_object('opened', v_opened, 'outcome', 'lost', 'hit', p_cell)
     where id = p_round;
    return public.mines_state(p_round);
  end if;

  v_opened := v_opened || to_jsonb(p_cell);
  update public.game_rounds set result = jsonb_set(result, '{opened}', v_opened) where id = p_round;

  v_safe := 25 - (r.choice ->> 'mines')::integer;
  if jsonb_array_length(v_opened) >= v_safe then
    return public.mines_cashout(p_round);                                      -- board cleared
  end if;
  return public.mines_state(p_round);
end;
$$;

create or replace function public.mines_cashout(p_round uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.game_rounds;
  v_n integer;
  v_mult numeric;
  v_pay numeric(18,2);
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into r from public.game_rounds where id = p_round and user_id = uid and game = 'mines' for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.status <> 'active' then return public.mines_state(p_round); end if;    -- already settled: no second payout

  v_n := jsonb_array_length(r.result -> 'opened');
  if v_n = 0 then raise exception 'nothing_to_cashout'; end if;
  select (config -> 'multipliers' -> (r.choice ->> 'mines') ->> (v_n - 1))::numeric into v_mult
    from public.game_settings where game = 'mines';
  v_pay := round(r.bet * v_mult, 2);

  update public.game_rounds
     set status = 'settled', settled_at = now(), multiplier = v_mult, payout = v_pay,
         result = jsonb_set(r.result, '{outcome}', '"cashed_out"')
   where id = p_round;
  perform public._game_pay(uid, 'mines', p_round, v_pay, r.idempotency_key);
  return public.mines_state(p_round);
end;
$$;

-- ---------------------------------------------------- snapshot additions ----
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
  v_assets numeric(18,2) := 0;
  v_debts  numeric(18,2) := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = uid;
  select * into w from public.wallets where user_id = uid;
  if not found then raise exception 'profile_not_found'; end if;

  return jsonb_build_object(
    'game_name', p.game_name, 'public_id', p.public_id, 'status', p.status,
    'xp', p.xp, 'level', p.level, 'xp_per_level', public._setting('xp_per_level'),
    'cash', w.cash, 'bank', w.bank, 'assets_value', v_assets, 'debts', v_debts,
    'total_capital', w.cash + w.bank + v_assets - v_debts,
    'income_today', (select coalesce(sum(amount), 0) from public.ledger_entries
                      where user_id = uid and direction = 'credit' and created_at >= date_trunc('day', now())),
    'spent_today',  (select coalesce(sum(amount), 0) from public.ledger_entries
                      where user_id = uid and direction = 'debit' and created_at >= date_trunc('day', now())),
    'games_played', (select count(*) from public.game_rounds where user_id = uid),
    'shifts_done',  (select count(*) from public.work_shifts where user_id = uid)
  );
end;
$$;

-- Bank balance after each journal entry over the last N entries (capital chart).
create or replace function public.my_balance_history(p_limit integer default 40)
returns table (at timestamptz, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select created_at, balance_after from (
    select created_at, balance_after, id from public.ledger_entries
     where user_id = auth.uid() and account = 'bank'
     order by id desc limit least(greatest(p_limit, 2), 200)
  ) t order by id;
$$;

-- ------------------------------------------------------------- grants -------
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
