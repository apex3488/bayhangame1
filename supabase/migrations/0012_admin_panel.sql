-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0012: web admin panel.
-- Every function checks the caller's role on the server (_require_admin) and
-- writes changes to the append-only audit_logs. Roles:
--   operator, moderator : view everything; moderator may restrict/block players
--   admin               : + balances, economy, games, jobs, promo, events, VIP
--   owner               : + grant/revoke admin roles
-- ============================================================================

create or replace function public._audit(p_actor uuid, p_action text, p_type text, p_target text, p_payload jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (p_actor, p_action, p_type, p_target, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function public._admin_role(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.admin_roles where user_id = p_uid;
$$;

-- --------------------------------------------------------------- session ----
create or replace function public.admin_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', public._admin_role(auth.uid()),
                            'game_name', (select game_name from public.profiles where id = auth.uid()));
$$;

-- Called once when the admin panel opens: "admin logins" in the audit log.
create or replace function public.admin_session_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin','moderator','operator']);
begin
  perform public._audit(v_actor, 'admin_login', 'admin', v_actor::text, jsonb_build_object('role', public._admin_role(v_actor)));
  return jsonb_build_object('status','ok','role', public._admin_role(v_actor));
end $$;

-- ------------------------------------------------------------- dashboard ----
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin','moderator','operator']);
begin
  return jsonb_build_object(
    'players_total',   (select count(*) from public.profiles),
    'players_new_24h', (select count(*) from public.profiles where created_at > now() - interval '24 hours'),
    'players_new_7d',  (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'players_active_24h', (select count(distinct user_id) from public.ledger_entries where created_at > now() - interval '24 hours'),
    'players_blocked', (select count(*) from public.profiles where status <> 'active'),
    'money_cash',      (select coalesce(sum(cash), 0) from public.wallets),
    'money_bank',      (select coalesce(sum(bank), 0) from public.wallets),
    'money_btc',       (select coalesce(sum(btc), 0) from public.wallets),
    'money_deposits',  (select coalesce(sum(amount), 0) from public.bank_deposits where not claimed),
    'ops_24h',         (select count(*) from public.ledger_entries where created_at > now() - interval '24 hours'),
    'transfers_24h',   (select coalesce(sum(amount), 0) from public.ledger_entries where op_type = 'transfer_in' and created_at > now() - interval '24 hours'),
    'transfers_count_24h', (select count(*) from public.ledger_entries where op_type = 'transfer_in' and created_at > now() - interval '24 hours'),
    'rounds_24h',      (select count(*) from public.game_rounds where created_at > now() - interval '24 hours'),
    'bets_24h',        (select coalesce(sum(bet), 0) from public.game_rounds where created_at > now() - interval '24 hours'),
    'payouts_24h',     (select coalesce(sum(payout), 0) from public.game_rounds where created_at > now() - interval '24 hours'),
    'shifts_24h',      (select count(*) from public.work_shifts where created_at > now() - interval '24 hours'),
    'income_issued_24h', (select coalesce(sum(amount), 0) from public.ledger_entries where direction = 'credit' and account <> 'btc'
                           and op_type in ('salary','daily_reward','realty_income','business_income','quest_reward','achievement_reward','promo_reward','referral_reward','signup_bonus')
                           and created_at > now() - interval '24 hours'),
    'admin_actions_24h', (select count(*) from public.audit_logs where created_at > now() - interval '24 hours' and action <> 'admin_login'),
    'games', (select coalesce(jsonb_agg(row_to_json(g) order by g.rounds desc), '[]'::jsonb) from (
               select game, count(*) rounds, sum(bet) bets, sum(payout) payouts
                 from public.game_rounds where created_at > now() - interval '7 days' group by game) g));
end $$;

-- Per-day series for charts.
create or replace function public.admin_daily_stats(p_days integer default 14)
returns table (day date, registrations bigint, rounds bigint, bets numeric, payouts numeric, ops bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query
  select d::date,
         (select count(*) from public.profiles where created_at::date = d::date),
         (select count(*) from public.game_rounds where created_at::date = d::date),
         (select coalesce(sum(bet), 0) from public.game_rounds where created_at::date = d::date),
         (select coalesce(sum(payout), 0) from public.game_rounds where created_at::date = d::date),
         (select count(*) from public.ledger_entries where created_at::date = d::date)
    from generate_series(current_date - (least(greatest(p_days, 1), 90) - 1), current_date, interval '1 day') d
   order by 1;
end $$;

-- --------------------------------------------------------------- players ----
create or replace function public.admin_search_players(p_query text default '', p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, login text, game_name text, public_id bigint, status public.account_status, level integer,
               cash numeric, bank numeric, btc numeric, capital numeric, created_at timestamptz, last_activity timestamptz, role text, total bigint)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, ''));
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query
  select p.id, p.login, p.game_name, p.public_id, p.status, p.level, w.cash, w.bank, w.btc, public._capital(p.id), p.created_at,
         (select max(l.created_at) from public.ledger_entries l where l.user_id = p.id),
         public._admin_role(p.id),
         count(*) over ()
    from public.profiles p join public.wallets w on w.user_id = p.id
   where q = '' or p.login ilike '%' || q || '%' or p.game_name ilike '%' || q || '%'
         or p.public_id::text = q or p.id::text = q
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_player(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; w public.wallets;
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'target_not_found'; end if;
  select * into w from public.wallets where user_id = p_user;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'login', p.login, 'game_name', p.game_name, 'public_id', p.public_id, 'status', p.status,
                                  'level', p.level, 'xp', p.xp, 'created_at', p.created_at, 'referral_code', p.referral_code,
                                  'referrer', (select game_name from public.profiles r where r.id = p.referrer_id),
                                  'daily_streak', p.daily_streak, 'last_daily_at', p.last_daily_at),
    'role', public._admin_role(p.id),
    'wallet', jsonb_build_object('cash', w.cash, 'bank', w.bank, 'btc', w.btc),
    'assets', public._assets(p.id),
    'capital', public._capital(p.id),
    'vip', (select jsonb_build_object('level', level, 'ends_at', ends_at, 'active', ends_at > now()) from public.user_vip where user_id = p.id),
    'corporation', (select jsonb_build_object('name', c.name, 'role', m.role) from public.corp_members m join public.corporations c on c.id = m.corp_id where m.user_id = p.id),
    'stats', jsonb_build_object('games_played', public._stat(p.id, 'games_played'), 'games_won', public._stat(p.id, 'games_won'),
                                'total_wagered', public._stat(p.id, 'total_wagered'), 'total_won', public._stat(p.id, 'total_won'),
                                'shifts', (select count(*) from public.work_shifts s where s.user_id = p.id),
                                'cosmetics', (select count(*) from public.user_cosmetics c where c.user_id = p.id)),
    'owned', jsonb_build_object(
       'realty', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'level', level)) from public.user_realty where user_id = p.id), '[]'::jsonb),
       'cars', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'level', level)) from public.user_cars where user_id = p.id), '[]'::jsonb),
       'business', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'level', level, 'employees', employees)) from public.user_businesses where user_id = p.id), '[]'::jsonb)),
    'ledger', coalesce((select jsonb_agg(row_to_json(l)) from (
                select id, op_type, direction, account, amount, balance_before, balance_after, reason, created_at, idempotency_key
                  from public.ledger_entries where user_id = p.id order by id desc limit 50) l), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(row_to_json(r)) from (
                select game, bet, multiplier, payout, status, created_at from public.game_rounds where user_id = p.id order by created_at desc limit 20) r), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(row_to_json(a)) from (
                select a.action, a.payload, a.created_at, ap.game_name actor from public.audit_logs a left join public.profiles ap on ap.id = a.actor_id
                 where a.target_id = p.id::text order by a.id desc limit 20) a), '[]'::jsonb));
end $$;

-- Restrict / block / reactivate. Moderators may act on ordinary players only.
create or replace function public.admin_set_status(p_user uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin','moderator']); v_old public.account_status;
        v_actor_role text := public._admin_role(v_actor); v_target_role text := public._admin_role(p_user);
begin
  if p_status not in ('active','restricted','blocked') then raise exception 'invalid_choice'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_user = v_actor then raise exception 'cannot_target_self'; end if;
  if v_target_role is not null and v_actor_role <> 'owner' then raise exception 'forbidden'; end if;
  select status into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'target_not_found'; end if;
  update public.profiles set status = p_status::public.account_status where id = p_user;
  perform public._audit(v_actor, 'status_change', 'profile', p_user::text,
    jsonb_build_object('old', v_old, 'new', p_status, 'reason', trim(p_reason)));
  return jsonb_build_object('status','ok');
end $$;

-- Balance changes, now also for BTC (8 decimals). Always through the journal.
create or replace function public.admin_adjust_balance(p_target_user uuid, p_account text, p_amount numeric, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public._require_admin(array['owner','admin']);
  v_key   text := 'admin:' || p_idempotency_key;
  v_acc   public.ledger_account;
  v_limit numeric := public._setting('admin_adjust_limit');
  v_before numeric; v_after numeric;
begin
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  if p_account not in ('cash','bank','btc') then raise exception 'invalid_choice'; end if;
  v_acc := p_account::public.ledger_account;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, case when p_account = 'btc' then 8 else 2 end) then raise exception 'invalid_amount'; end if;
  if p_account <> 'btc' and abs(p_amount) > v_limit then raise exception 'admin_adjust_limit_exceeded'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.profiles where id = p_target_user) then raise exception 'target_not_found'; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = v_key) then return jsonb_build_object('status','duplicate'); end if;
  perform public._apply_wallet_change(p_target_user, v_acc, p_amount,
    case when p_amount > 0 then 'admin_credit' else 'admin_debit' end, trim(p_reason), v_key, v_actor, 'admin', v_actor::text);
  select balance_before, balance_after into v_before, v_after from public.ledger_entries where idempotency_key = v_key;
  perform public._audit(v_actor, 'balance_adjust', 'profile', p_target_user::text,
    jsonb_build_object('account', p_account, 'amount', p_amount, 'reason', trim(p_reason), 'before', v_before, 'after', v_after));
  return jsonb_build_object('status','ok','before',v_before,'after',v_after);
end $$;

-- Owner only: grant or revoke admin roles (null removes).
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner']); v_old text := public._admin_role(p_user);
begin
  if p_user = v_actor then raise exception 'cannot_target_self'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'target_not_found'; end if;
  if p_role is null then
    delete from public.admin_roles where user_id = p_user;
  elsif p_role in ('admin','moderator','operator') then
    insert into public.admin_roles (user_id, role) values (p_user, p_role) on conflict (user_id) do update set role = excluded.role;
  else
    raise exception 'invalid_choice';
  end if;
  perform public._audit(v_actor, 'role_change', 'profile', p_user::text, jsonb_build_object('old', v_old, 'new', p_role));
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.admin_revoke_vip(p_user uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']);
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  delete from public.user_vip where user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  perform public._audit(v_actor, 'vip_revoke', 'profile', p_user::text, jsonb_build_object('reason', trim(p_reason)));
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.admin_list_vip()
returns table (user_id uuid, game_name text, level integer, ends_at timestamptz, active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query select v.user_id, p.game_name, v.level, v.ends_at, v.ends_at > now()
                 from public.user_vip v join public.profiles p on p.id = v.user_id order by v.ends_at desc;
end $$;

-- --------------------------------------------------------------- economy ----
create or replace function public.admin_list_settings()
returns table (key text, value numeric, description text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query select s.key, s.value, s.description, s.updated_at from public.economy_settings s order by s.key;
end $$;

create or replace function public.admin_set_game(p_game text, p_enabled boolean, p_min numeric, p_max numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']); g public.game_settings;
begin
  select * into g from public.game_settings where game = p_game for update;
  if not found then raise exception 'not_found'; end if;
  if p_min is null or p_max is null or p_min <= 0 or p_max < p_min or p_min <> round(p_min, 2) or p_max <> round(p_max, 2) then raise exception 'invalid_value'; end if;
  update public.game_settings set enabled = p_enabled, min_bet = p_min, max_bet = p_max, updated_at = now() where game = p_game;
  perform public._audit(v_actor, 'game_settings_change', 'game', p_game,
    jsonb_build_object('old', jsonb_build_object('enabled', g.enabled, 'min', g.min_bet, 'max', g.max_bet),
                       'new', jsonb_build_object('enabled', p_enabled, 'min', p_min, 'max', p_max)));
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.admin_list_jobs()
returns setof public.jobs language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query select * from public.jobs order by is_active desc, sort_order, key;
end $$;

create or replace function public.admin_set_job(p_key text, p_income_min numeric, p_income_max numeric, p_cooldown integer,
                                                p_min_capital numeric, p_xp integer, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']); j public.jobs;
begin
  select * into j from public.jobs where key = p_key for update;
  if not found then raise exception 'not_found'; end if;
  if p_income_min is null or p_income_min <= 0 or p_income_max < p_income_min or p_cooldown < 0 or p_min_capital < 0 or p_xp < 0
     or p_income_min <> round(p_income_min, 2) or p_income_max <> round(p_income_max, 2) then raise exception 'invalid_value'; end if;
  update public.jobs set income_min = p_income_min, income_max = p_income_max, cooldown_seconds = p_cooldown,
                         min_capital = p_min_capital, xp_reward = p_xp, is_active = p_active where key = p_key;
  perform public._audit(v_actor, 'job_change', 'job', p_key,
    jsonb_build_object('old', to_jsonb(j), 'new', jsonb_build_object('income_min', p_income_min, 'income_max', p_income_max,
      'cooldown_seconds', p_cooldown, 'min_capital', p_min_capital, 'xp_reward', p_xp, 'is_active', p_active)));
  return jsonb_build_object('status','ok');
end $$;

-- ----------------------------------------------------------------- promo ----
create or replace function public.admin_list_promos()
returns table (code text, reward_usd numeric, reward_btc numeric, max_uses integer, used_count integer,
               starts_at timestamptz, expires_at timestamptz, active boolean, created_by text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query select c.code, c.reward_usd, c.reward_btc, c.max_uses, c.used_count, c.starts_at, c.expires_at, c.active,
                      (select game_name from public.profiles where id = c.created_by), c.created_at
                 from public.promo_codes c order by c.created_at desc;
end $$;

create or replace function public.admin_create_promo(p_code text, p_usd numeric, p_btc numeric, p_max_uses integer,
                                                     p_starts timestamptz, p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']); v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_code !~ '^[A-Z0-9_]{3,32}$' then raise exception 'invalid_code'; end if;
  if coalesce(p_usd, 0) < 0 or coalesce(p_btc, 0) < 0 or (coalesce(p_usd, 0) = 0 and coalesce(p_btc, 0) = 0) then raise exception 'invalid_value'; end if;
  if coalesce(p_usd, 0) > public._setting('admin_adjust_limit') then raise exception 'admin_adjust_limit_exceeded'; end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000000 then raise exception 'invalid_value'; end if;
  if p_expires is not null and p_expires <= coalesce(p_starts, now()) then raise exception 'invalid_value'; end if;
  if exists (select 1 from public.promo_codes where code = v_code) then raise exception 'already_exists'; end if;
  insert into public.promo_codes (code, reward_usd, reward_btc, max_uses, starts_at, expires_at, created_by)
  values (v_code, round(coalesce(p_usd, 0), 2), round(coalesce(p_btc, 0), 8), p_max_uses, coalesce(p_starts, now()), p_expires, v_actor);
  perform public._audit(v_actor, 'promo_create', 'promo', v_code,
    jsonb_build_object('usd', p_usd, 'btc', p_btc, 'max_uses', p_max_uses, 'starts', p_starts, 'expires', p_expires));
  return jsonb_build_object('status','ok','code',v_code);
end $$;

create or replace function public.admin_set_promo_active(p_code text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']);
begin
  update public.promo_codes set active = p_active where code = upper(trim(p_code));
  if not found then raise exception 'not_found'; end if;
  perform public._audit(v_actor, case when p_active then 'promo_enable' else 'promo_disable' end, 'promo', upper(trim(p_code)), '{}'::jsonb);
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.admin_promo_redemptions(p_code text)
returns table (game_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query select p.game_name, r.created_at from public.promo_redemptions r join public.profiles p on p.id = r.user_id
                where r.code = upper(trim(p_code)) order by r.created_at desc limit 200;
end $$;

-- ---------------------------------------------------------------- events ----
create or replace function public.admin_list_events()
returns setof public.events language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query select * from public.events order by starts_at desc;
end $$;

create or replace function public.admin_create_event(p_code text, p_title text, p_description text, p_type text,
                                                     p_multiplier numeric, p_starts timestamptz, p_ends timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']); v_code text := lower(trim(coalesce(p_code, '')));
begin
  if v_code !~ '^[a-z0-9_]{2,40}$' then raise exception 'invalid_code'; end if;
  if p_type not in ('daily','mining') then raise exception 'invalid_choice'; end if;
  if p_multiplier is null or p_multiplier <= 0 or p_multiplier > 10 then raise exception 'invalid_value'; end if;
  if p_title is null or char_length(trim(p_title)) not between 2 and 80 then raise exception 'invalid_value'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'invalid_value'; end if;
  if exists (select 1 from public.events where code = v_code) then raise exception 'already_exists'; end if;
  insert into public.events (code, title, description, event_type, multiplier, starts_at, ends_at)
  values (v_code, trim(p_title), left(coalesce(trim(p_description), ''), 300), p_type, round(p_multiplier, 2), p_starts, p_ends);
  perform public._audit(v_actor, 'event_create', 'event', v_code,
    jsonb_build_object('type', p_type, 'multiplier', p_multiplier, 'starts', p_starts, 'ends', p_ends));
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.admin_set_event_active(p_code text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']);
begin
  update public.events set active = p_active where code = lower(trim(p_code));
  if not found then raise exception 'not_found'; end if;
  perform public._audit(v_actor, case when p_active then 'event_enable' else 'event_disable' end, 'event', lower(trim(p_code)), '{}'::jsonb);
  return jsonb_build_object('status','ok');
end $$;

-- ----------------------------------------------------------------- audit ----
create or replace function public.admin_audit(p_action text default null, p_limit integer default 50, p_offset integer default 0)
returns table (id bigint, action text, actor text, target_type text, target_id text, target_name text, payload jsonb, created_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query
  select a.id, a.action, ap.game_name, a.target_type, a.target_id,
         case when a.target_type = 'profile' then (select game_name from public.profiles t where t.id::text = a.target_id) end,
         a.payload, a.created_at, count(*) over ()
    from public.audit_logs a left join public.profiles ap on ap.id = a.actor_id
   where p_action is null or p_action = '' or a.action = p_action
   order by a.id desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- Large transfers for investigation (spec: suspicious operations).
create or replace function public.admin_large_transfers(p_min numeric default 50000, p_limit integer default 50)
returns table (created_at timestamptz, sender text, receiver text, amount numeric, group_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin','moderator','operator']);
  return query
  select l.created_at, s.game_name, r.game_name, l.amount, l.group_id
    from public.ledger_entries l
    join public.profiles r on r.id = l.user_id
    left join public.profiles s on s.id = l.counterparty_id
   where l.op_type = 'transfer_in' and l.amount >= coalesce(p_min, 0)
   order by l.created_at desc limit least(greatest(p_limit, 1), 200);
end $$;

-- ---------------------------------------------------------------- grants ----
revoke all on function public._audit(uuid, text, text, text, jsonb), public._admin_role(uuid) from public, anon, authenticated;
grant execute on function public.admin_me()                                        to authenticated;
grant execute on function public.admin_session_start()                             to authenticated;
grant execute on function public.admin_dashboard()                                 to authenticated;
grant execute on function public.admin_daily_stats(integer)                        to authenticated;
grant execute on function public.admin_search_players(text, integer, integer)      to authenticated;
grant execute on function public.admin_player(uuid)                                to authenticated;
grant execute on function public.admin_set_status(uuid, text, text)                to authenticated;
grant execute on function public.admin_adjust_balance(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.admin_set_role(uuid, text)                        to authenticated;
grant execute on function public.admin_revoke_vip(uuid, text)                      to authenticated;
grant execute on function public.admin_list_vip()                                  to authenticated;
grant execute on function public.admin_list_settings()                             to authenticated;
grant execute on function public.admin_set_game(text, boolean, numeric, numeric)   to authenticated;
grant execute on function public.admin_list_jobs()                                 to authenticated;
grant execute on function public.admin_set_job(text, numeric, numeric, integer, numeric, integer, boolean) to authenticated;
grant execute on function public.admin_list_promos()                               to authenticated;
grant execute on function public.admin_create_promo(text, numeric, numeric, integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_set_promo_active(text, boolean)             to authenticated;
grant execute on function public.admin_promo_redemptions(text)                     to authenticated;
grant execute on function public.admin_list_events()                               to authenticated;
grant execute on function public.admin_create_event(text, text, text, text, numeric, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_set_event_active(text, boolean)             to authenticated;
grant execute on function public.admin_audit(text, integer, integer)               to authenticated;
grant execute on function public.admin_large_transfers(numeric, integer)           to authenticated;
