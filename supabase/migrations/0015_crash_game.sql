-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0015: Crash.
-- The multiplier grows from 1.00× as m(t) = e^(k·t) on SERVER time. The crash
-- point is drawn at round start (hidden in game_round_secrets):
--   crash = max(1.00, floor(100 · (1 − edge) / (1 − u)) / 100), capped at max,
-- so P(crash ≥ x) = (1 − edge) / x. Cash-out is valued at server time, so
-- network latency can never help the player. Optional auto cash-out.
-- Secret code (key 'crash_reveal', hash stored separately) shows the crash
-- point of the player's active round; same 5-attempts-per-hour limit and audit.
-- ============================================================================

alter table public.game_settings drop constraint game_settings_game_check;
alter table public.game_settings add constraint game_settings_game_check check (game in
  ('casino','spin','slots','dice','updown','trade','basketball','darts','bowling','mines','crash'));

insert into public.game_settings (game, min_bet, max_bet, config)
values ('crash', 100, 1000000, '{"k":0.0693,"edge":0.01,"max":1000}')
on conflict (game) do nothing;

alter table public.game_rounds add column started_at timestamptz;

-- Multiplier after p_seconds, floored to cents of a multiplier.
create or replace function public._crash_mult(p_seconds numeric, p_k numeric)
returns numeric language sql immutable set search_path = public as $$
  select floor(100 * exp(p_k * greatest(p_seconds, 0))) / 100;
$$;

-- Settles a round when the game has decided it (crash reached or auto cash-out hit).
-- p_cashout = true means the player asked to cash out now.
create or replace function public._crash_settle(p_round uuid, p_cashout boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.game_rounds;
  s public.game_settings;
  v_crash numeric;
  v_now numeric;
  v_auto numeric;
  v_mult numeric;
  v_outcome text;
begin
  select * into r from public.game_rounds where id = p_round for update;
  if r.status <> 'active' then return; end if;
  select * into s from public.game_settings where game = 'crash';
  select (secret ->> 'crash')::numeric into v_crash from public.game_round_secrets where round_id = p_round;
  v_now := public._crash_mult(extract(epoch from (now() - r.started_at)), (s.config ->> 'k')::numeric);
  v_auto := (r.choice ->> 'auto')::numeric;

  if v_auto is not null and v_auto < v_crash and v_auto <= v_now then
    v_mult := v_auto; v_outcome := 'auto_cashout';         -- auto cash-out fired before the crash
  elsif v_now >= v_crash then
    v_mult := 0; v_outcome := 'crashed';
  elsif p_cashout then
    v_mult := v_now; v_outcome := 'cashed_out';
  else
    return;                                                  -- still flying
  end if;

  update public.game_rounds
     set status = 'settled', settled_at = now(), multiplier = v_mult, payout = round(r.bet * v_mult, 2),
         result = jsonb_build_object('outcome', v_outcome, 'crash', v_crash, 'at', v_mult)
   where id = p_round;
  perform public._game_pay(r.user_id, 'crash', p_round, round(r.bet * v_mult, 2), r.idempotency_key);
end $$;

create or replace function public._crash_view(p_round uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'round_id', r.id, 'status', r.status, 'bet', r.bet, 'auto', r.choice -> 'auto',
    'started_at', r.started_at, 'server_now', now(), 'k', (s.config ->> 'k')::numeric,
    'multiplier', r.multiplier, 'payout', r.payout, 'outcome', r.result ->> 'outcome',
    'crash', case when r.status = 'settled' then r.result -> 'crash' end)
  from public.game_rounds r, public.game_settings s
  where r.id = p_round and s.game = 'crash';
$$;

create or replace function public.crash_start(p_bet numeric, p_auto numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_key text := 'game:' || p_idempotency_key;
  v_id uuid := gen_random_uuid();
  s public.game_settings;
  v_prev uuid;
  v_crash numeric;
  v_edge numeric;
  v_max numeric;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._valid_key(p_idempotency_key) then raise exception 'invalid_idempotency_key'; end if;
  select id into v_prev from public.game_rounds where idempotency_key = v_key;
  if v_prev is not null then return public._crash_view(v_prev); end if;
  if p_auto is not null and (p_auto < 1.01 or p_auto > 1000 or p_auto <> round(p_auto, 2)) then raise exception 'invalid_choice'; end if;
  if exists (select 1 from public.game_rounds where user_id = uid and status = 'active') then raise exception 'round_already_active'; end if;

  s := public._game_begin(uid, 'crash', p_bet, v_id, v_key);
  v_edge := coalesce((s.config ->> 'edge')::numeric, 0.01);
  v_max := coalesce((s.config ->> 'max')::numeric, 1000);
  v_crash := least(v_max, greatest(1.00, floor(100 * (1 - v_edge) / greatest(1 - public._rand(), 0.0000001)) / 100));

  insert into public.game_rounds (id, user_id, game, bet, status, choice, result, idempotency_key, started_at)
  values (v_id, uid, 'crash', p_bet, 'active', jsonb_build_object('auto', p_auto), '{}'::jsonb, v_key, now());
  insert into public.game_round_secrets (round_id, secret) values (v_id, jsonb_build_object('crash', v_crash));
  return public._crash_view(v_id);
end $$;

-- Polled by the client while the round flies; settles crashed / auto rounds.
create or replace function public.crash_state(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.game_rounds where id = p_round and user_id = auth.uid() and game = 'crash') then
    raise exception 'round_not_found';
  end if;
  perform public._crash_settle(p_round, false);
  return public._crash_view(p_round);
end $$;

create or replace function public.crash_cashout(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.game_rounds where id = p_round and user_id = auth.uid() and game = 'crash') then
    raise exception 'round_not_found';
  end if;
  perform public._crash_settle(p_round, true);              -- replay-safe: settled rounds are left as they are
  return public._crash_view(p_round);
end $$;

create or replace function public.crash_active()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.game_rounds where user_id = auth.uid() and game = 'crash' and status = 'active' limit 1;
  if v_id is null then return null; end if;
  perform public._crash_settle(v_id, false);
  return public._crash_view(v_id);
end $$;

-- Last crash points of the caller's own rounds (for the history strip).
create or replace function public.crash_history(p_limit integer default 20)
returns table (crash numeric, outcome text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select (result ->> 'crash')::numeric, result ->> 'outcome', created_at from public.game_rounds
   where user_id = auth.uid() and game = 'crash' and status = 'settled'
   order by created_at desc limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.crash_reveal(p_round uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.game_rounds; v_hash text; v_ok boolean; v_crash numeric;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform 1 from public.profiles where id = uid for update;
  if (select count(*) from public.secret_attempts where user_id = uid and not success and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_attempts';
  end if;
  select * into r from public.game_rounds where id = p_round and user_id = uid and game = 'crash';
  if not found then raise exception 'round_not_found'; end if;
  if r.status <> 'active' then raise exception 'round_not_active'; end if;
  select code_hash into v_hash from public.game_secrets where key = 'crash_reveal';
  v_ok := v_hash is not null and public._sha256_hex(trim(p_code)) = v_hash;
  insert into public.secret_attempts (user_id, secret_key, success) values (uid, 'crash_reveal', v_ok);
  if not v_ok then
    return jsonb_build_object('status', 'wrong_code',
      'attempts_left', 5 - (select count(*) from public.secret_attempts where user_id = uid and not success and created_at > now() - interval '1 hour'));
  end if;
  select (secret ->> 'crash')::numeric into v_crash from public.game_round_secrets where round_id = p_round;
  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (uid, 'crash_secret_reveal', 'game_round', p_round::text, jsonb_build_object('bet', r.bet));
  return jsonb_build_object('status', 'ok', 'crash', v_crash);
end $$;

-- Mines: an active crash round must not block starting mines and vice versa only within the same game.
-- (game_rounds_one_active_mines is a unique index on user_id where status = 'active', so one active round of any game.)

revoke all on function public._crash_mult(numeric, numeric), public._crash_settle(uuid, boolean), public._crash_view(uuid)
  from public, anon, authenticated;
revoke all on function public.crash_start(numeric, numeric, text), public.crash_state(uuid), public.crash_cashout(uuid),
                       public.crash_active(), public.crash_history(integer), public.crash_reveal(uuid, text) from public, anon;
grant execute on function public.crash_start(numeric, numeric, text) to authenticated;
grant execute on function public.crash_state(uuid)                   to authenticated;
grant execute on function public.crash_cashout(uuid)                 to authenticated;
grant execute on function public.crash_active()                      to authenticated;
grant execute on function public.crash_history(integer)              to authenticated;
grant execute on function public.crash_reveal(uuid, text)            to authenticated;
