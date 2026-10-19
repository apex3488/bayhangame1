-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0007: quests, achievements, VIP, events in the
-- daily reward, referrals, nickname change. Ported from bot/services/
-- {quests,achievements,vip,events,daily,users,nickname}.py.
-- ============================================================================

-- ---------------------------------------------------------------- quests ----
create table public.quests (
  code        text primary key,
  quest_type  text not null check (quest_type in ('play_games','win_games','mine_resources','invite_refs','earn_usd')),
  target      numeric(18,2) not null check (target > 0),
  reward_usd  numeric(18,2) not null check (reward_usd >= 0),
  active      boolean not null default true,
  sort_order  integer not null default 100
);
insert into public.quests values
  ('play_5_games',  'play_games',      5,  1000, true, 1),
  ('win_3_games',   'win_games',       3,  2500, true, 2),
  ('mine_10',       'mine_resources', 10,  1500, true, 3),
  ('invite_1',      'invite_refs',     1,  5000, true, 4),
  ('earn_10000',    'earn_usd',    10000,  3000, true, 5);

create table public.user_quests (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code       text not null references public.quests(code),
  claimed_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- ---------------------------------------------------------- achievements ----
create table public.achievements (
  code            text primary key,
  condition_type  text not null check (condition_type in ('games_played','games_won','total_wagered','total_won','referrals_count','capital')),
  condition_value numeric(18,2) not null check (condition_value > 0),
  reward_usd      numeric(18,2) not null check (reward_usd >= 0),
  sort_order      integer not null default 100
);
insert into public.achievements values
  ('first_steps', 'games_played',       1,    5000, 1),
  ('gambler_50',  'games_played',      50,   25000, 2),
  ('winner_10',   'games_won',         10,   15000, 3),
  ('high_roller', 'total_wagered', 1000000,  100000, 4),
  ('big_winner',  'total_won',      500000,   50000, 5),
  ('recruiter',   'referrals_count',     5,   30000, 6),
  ('millionaire', 'capital',       1000000,  200000, 7),
  ('tycoon',      'capital',      10000000, 1000000, 8);

create table public.user_achievements (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code       text not null references public.achievements(code),
  claimed_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- -------------------------------------------------------------- referrals ----
alter table public.profiles add column referral_code text unique;
alter table public.profiles add column referrer_id uuid references public.profiles(id);
alter table public.profiles add column referral_rewarded boolean not null default false;

create or replace function public._new_referral_code()
returns text language plpgsql volatile set search_path = public as $$
declare v text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    select string_agg(substr(alphabet, public._rand_int(1, length(alphabet)), 1), '') into v from generate_series(1, 6);
    exit when not exists (select 1 from public.profiles where referral_code = v);
  end loop;
  return v;
end $$;

update public.profiles set referral_code = public._new_referral_code() where referral_code is null;
alter table public.profiles alter column referral_code set not null;

-- Counted progress values shared by quests and achievements.
create or replace function public._stat(p_user uuid, p_kind text)
returns numeric language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'play_games'      then (select count(*)::numeric from public.game_rounds where user_id = p_user and status = 'settled')
    when 'games_played'    then (select count(*)::numeric from public.game_rounds where user_id = p_user and status = 'settled')
    when 'win_games'       then (select count(*)::numeric from public.game_rounds where user_id = p_user and payout > bet)
    when 'games_won'       then (select count(*)::numeric from public.game_rounds where user_id = p_user and payout > bet)
    when 'total_wagered'   then (select coalesce(sum(bet), 0) from public.game_rounds where user_id = p_user and status = 'settled')
    when 'total_won'       then (select coalesce(sum(payout), 0) from public.game_rounds where user_id = p_user)
    when 'mine_resources'  then (select coalesce(sum(total), 0)::numeric from public.mining_log where user_id = p_user)
    when 'invite_refs'     then (select count(*)::numeric from public.profiles where referrer_id = p_user and referral_rewarded)
    when 'referrals_count' then (select count(*)::numeric from public.profiles where referrer_id = p_user and referral_rewarded)
    when 'earn_usd'        then (select coalesce(sum(amount), 0) from public.ledger_entries where user_id = p_user and account = 'cash'
                                   and op_type in ('salary','daily_reward','game_win','realty_income','business_income','resource_sell','case_reward'))
    when 'capital'         then public._capital(p_user)
  end;
$$;

create or replace function public.my_quests()
returns table (code text, quest_type text, target numeric, reward_usd numeric, progress numeric, claimed boolean)
language sql stable security definer set search_path = public as $$
  select q.code, q.quest_type, q.target, q.reward_usd, least(public._stat(auth.uid(), q.quest_type), q.target),
         exists (select 1 from public.user_quests u where u.user_id = auth.uid() and u.code = q.code)
    from public.quests q where q.active and auth.uid() is not null order by q.sort_order;
$$;

create or replace function public.claim_quest(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q public.quests; v_status public.account_status;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select status into v_status from public.profiles where id = uid for update;
  if v_status <> 'active' then raise exception 'account_restricted'; end if;
  select * into q from public.quests where code = p_code and active;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.user_quests where user_id = uid and code = p_code) then raise exception 'already_claimed'; end if;
  if public._stat(uid, q.quest_type) < q.target then raise exception 'not_completed'; end if;
  insert into public.user_quests (user_id, code) values (uid, p_code);
  if q.reward_usd > 0 then
    perform public._apply_wallet_change(uid, 'cash', q.reward_usd, 'quest_reward', 'Задание: ' || p_code, 'quest:' || p_code || ':' || uid, null, 'quest', p_code);
  end if;
  return jsonb_build_object('status','ok','reward',q.reward_usd);
end $$;

create or replace function public.my_achievements()
returns table (code text, condition_type text, condition_value numeric, reward_usd numeric, progress numeric, claimed boolean)
language sql stable security definer set search_path = public as $$
  select a.code, a.condition_type, a.condition_value, a.reward_usd, least(public._stat(auth.uid(), a.condition_type), a.condition_value),
         exists (select 1 from public.user_achievements u where u.user_id = auth.uid() and u.code = a.code)
    from public.achievements a where auth.uid() is not null order by a.sort_order;
$$;

create or replace function public.claim_achievement(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a public.achievements; v_status public.account_status;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select status into v_status from public.profiles where id = uid for update;
  if v_status <> 'active' then raise exception 'account_restricted'; end if;
  select * into a from public.achievements where code = p_code;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.user_achievements where user_id = uid and code = p_code) then raise exception 'already_claimed'; end if;
  if public._stat(uid, a.condition_type) < a.condition_value then raise exception 'not_completed'; end if;
  insert into public.user_achievements (user_id, code) values (uid, p_code);
  if a.reward_usd > 0 then
    perform public._apply_wallet_change(uid, 'cash', a.reward_usd, 'achievement_reward', 'Достижение: ' || p_code, 'achievement:' || p_code || ':' || uid, null, 'achievement', p_code);
  end if;
  return jsonb_build_object('status','ok','reward',a.reward_usd);
end $$;

-- -------------------------------------------------------------------- VIP ----
create table public.vip_levels (
  level            integer primary key check (level between 1 and 4),
  daily_multiplier numeric(6,2) not null check (daily_multiplier >= 1)
);
insert into public.vip_levels values (1, 1.10), (2, 1.25), (3, 1.50), (4, 2.00);

create table public.user_vip (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  level      integer not null references public.vip_levels(level),
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null
);

create or replace function public._vip_multiplier(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select l.daily_multiplier from public.user_vip v join public.vip_levels l using (level)
                    where v.user_id = p_user and v.ends_at > now()), 1);
$$;

create or replace function public.my_vip()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('level', v.level, 'ends_at', v.ends_at, 'multiplier', l.daily_multiplier, 'active', v.ends_at > now())
                     from public.user_vip v join public.vip_levels l using (level) where v.user_id = auth.uid()),
                  jsonb_build_object('level', 0, 'active', false, 'multiplier', 1));
$$;

-- VIP is granted by admins (bot: admin only). Extends from the current end date.
create or replace function public.admin_grant_vip(p_target uuid, p_level integer, p_days integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']); v_end timestamptz;
begin
  if p_level not between 1 and 4 or p_days not between 1 and 365 then raise exception 'invalid_choice'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  insert into public.user_vip (user_id, level, ends_at) values (p_target, p_level, now() + make_interval(days => p_days))
  on conflict (user_id) do update set level = excluded.level,
    ends_at = greatest(user_vip.ends_at, now()) + make_interval(days => p_days)
  returning ends_at into v_end;
  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (v_actor, 'vip_grant', 'profile', p_target::text, jsonb_build_object('level', p_level, 'days', p_days, 'reason', trim(p_reason)));
  return jsonb_build_object('status','ok','ends_at',v_end);
end $$;

-- ------------------------------------------- daily reward: VIP × events ----
create or replace function public.daily_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; v_can boolean; v_streak integer; v_mult numeric;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'not_authenticated'; end if;
  v_can := p.last_daily_at is null or now() - p.last_daily_at >= interval '24 hours';
  v_streak := case when v_can then public._daily_next_streak(p) else greatest(p.daily_streak, 1) end;
  v_mult := public._vip_multiplier(p.id) * public._event_multiplier('daily');
  return jsonb_build_object('can_claim', v_can, 'streak', v_streak, 'multiplier', v_mult,
    'reward', round(public._setting('daily_base') * v_streak * v_mult, 2),
    'next_at', coalesce(p.last_daily_at + interval '24 hours', now()));
end $$;

create or replace function public.claim_daily(p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; v_streak integer; v_reward numeric(18,2); v_key text := 'daily:' || p_idempotency_key;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = v_key) then return jsonb_build_object('status','duplicate'); end if;
  select * into p from public.profiles where id = uid for update;
  if p.status <> 'active' then raise exception 'account_restricted'; end if;
  if p.last_daily_at is not null and now() - p.last_daily_at < interval '24 hours' then raise exception 'daily_already_claimed'; end if;
  v_streak := public._daily_next_streak(p);
  v_reward := round(public._setting('daily_base') * v_streak * public._vip_multiplier(uid) * public._event_multiplier('daily'), 2);
  update public.profiles set daily_streak = v_streak, last_daily_at = now() where id = uid;
  perform public._apply_wallet_change(uid, 'cash', v_reward, 'daily_reward', 'Ежедневная награда, день ' || v_streak, v_key, null, 'daily', v_streak::text);
  return jsonb_build_object('status','ok','reward',v_reward,'streak',v_streak);
end $$;

-- ------------------------------------------------ signup with referrer ----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_login text := lower(trim(coalesce(new.raw_user_meta_data ->> 'login', '')));
  v_name  text := trim(coalesce(new.raw_user_meta_data ->> 'game_name', ''));
  v_ref   text := upper(trim(coalesce(new.raw_user_meta_data ->> 'ref', '')));
  v_referrer uuid;
begin
  if v_login !~ '^[a-z0-9_]{3,20}$' then raise exception 'invalid_login'; end if;
  if char_length(v_name) not between 3 and 20 or v_name !~ '^[A-Za-z0-9_ ]+$' then raise exception 'invalid_game_name'; end if;
  if v_ref <> '' then select id into v_referrer from public.profiles where referral_code = v_ref; end if;
  insert into public.profiles (id, login, game_name, referral_code, referrer_id)
  values (new.id, v_login, v_name, public._new_referral_code(), v_referrer);
  insert into public.wallets (user_id, cash, bank) values (new.id, 0, 0);
  perform public._apply_wallet_change(new.id, 'cash', public._setting('starting_capital'), 'signup_bonus',
    'Стартовый капитал', 'signup:' || new.id::text, null, 'account', new.id::text);
  return new;
end $$;

-- Pays the referrer once the invited player has worked 3 shifts (anti-abuse; the bot paid at signup).
create or replace function public._maybe_pay_referral(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user for update;
  if p.referrer_id is null or p.referral_rewarded then return; end if;
  if (select count(*) from public.work_shifts where user_id = p_user) < 3 then return; end if;
  update public.profiles set referral_rewarded = true where id = p_user;
  perform public._apply_wallet_change(p.referrer_id, 'cash', public._setting('referral_reward'), 'referral_reward',
    'Реферал: ' || p.game_name, 'referral:' || p_user, p_user, 'referral', p_user::text);
end $$;

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
  perform public._maybe_pay_referral(uid);
  return jsonb_build_object('status','ok','salary',v_pay,'xp',j.xp_reward,'next_at', now() + make_interval(secs => j.cooldown_seconds));
end $$;

create or replace function public.my_referrals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', (select referral_code from public.profiles where id = auth.uid()),
    'reward', public._setting('referral_reward'),
    'invited', (select count(*) from public.profiles where referrer_id = auth.uid()),
    'qualified', (select count(*) from public.profiles where referrer_id = auth.uid() and referral_rewarded),
    'earned', (select coalesce(sum(amount), 0) from public.ledger_entries where user_id = auth.uid() and op_type = 'referral_reward'),
    'list', coalesce((select jsonb_agg(jsonb_build_object('game_name', game_name, 'qualified', referral_rewarded, 'joined', created_at) order by created_at desc)
                        from public.profiles where referrer_id = auth.uid()), '[]'::jsonb));
$$;

-- ------------------------------------------------------------- nickname ----
create or replace function public.rename_game_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v) not between 3 and 20 or v !~ '^[A-Za-z0-9_ ]+$' then raise exception 'invalid_game_name'; end if;
  if exists (select 1 from public.profiles where lower(game_name) = lower(v) and id <> uid) then raise exception 'name_taken'; end if;
  update public.profiles set game_name = v where id = uid;
  return jsonb_build_object('status','ok','game_name',v);
end $$;

create or replace function public.my_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('game_name', p.game_name, 'login', p.login, 'public_id', p.public_id, 'level', p.level, 'xp', p.xp,
    'created_at', p.created_at, 'referral_code', p.referral_code,
    'stats', jsonb_build_object('games_played', public._stat(p.id, 'games_played'), 'games_won', public._stat(p.id, 'games_won'),
                                'total_wagered', public._stat(p.id, 'total_wagered'), 'total_won', public._stat(p.id, 'total_won'),
                                'shifts', (select count(*) from public.work_shifts s where s.user_id = p.id),
                                'mined', public._stat(p.id, 'mine_resources')))
    from public.profiles p where p.id = auth.uid();
$$;

-- ----------------------------------------------------------------- RLS ----
alter table public.quests            enable row level security;
alter table public.user_quests       enable row level security;
alter table public.achievements      enable row level security;
alter table public.user_achievements enable row level security;
alter table public.vip_levels        enable row level security;
alter table public.user_vip          enable row level security;
create policy read_all on public.quests       for select to authenticated using (active);
create policy read_all on public.achievements for select to authenticated using (true);
create policy read_all on public.vip_levels   for select to authenticated using (true);
create policy read_own on public.user_quests       for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_achievements for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_vip          for select to authenticated using (user_id = auth.uid());

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
grant execute on function public.admin_grant_vip(uuid, integer, integer, text)  to authenticated;
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
grant execute on function public.my_quests()                                    to authenticated;
grant execute on function public.claim_quest(text)                              to authenticated;
grant execute on function public.my_achievements()                              to authenticated;
grant execute on function public.claim_achievement(text)                        to authenticated;
grant execute on function public.my_vip()                                       to authenticated;
grant execute on function public.my_referrals()                                 to authenticated;
grant execute on function public.rename_game_name(text)                         to authenticated;
grant execute on function public.my_profile()                                   to authenticated;
