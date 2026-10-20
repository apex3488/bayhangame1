-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0021: secret reveal codes (Mines, Crash) work for
-- the owner only. For anyone else even the right code counts as a wrong attempt
-- (same answer, same rate limit), so the code cannot be shared or leaked into the
-- economy of a public game.
-- ============================================================================

create or replace function public.mines_reveal(p_round uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.game_rounds;
  v_hash text;
  v_ok boolean;
  v_mines jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform 1 from public.profiles where id = uid for update;   -- serialise attempts of one player
  if (select count(*) from public.secret_attempts
       where user_id = uid and not success and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_attempts';
  end if;

  select * into r from public.game_rounds where id = p_round and user_id = uid and game = 'mines';
  if not found then raise exception 'round_not_found'; end if;
  if r.status <> 'active' then raise exception 'round_not_active'; end if;

  select code_hash into v_hash from public.game_secrets where key = 'mines_reveal';
  v_ok := v_hash is not null and public._sha256_hex(trim(p_code)) = v_hash
    and exists (select 1 from public.admin_roles where user_id = uid and role = 'owner');  -- owner-only since launch
  insert into public.secret_attempts (user_id, secret_key, success) values (uid, 'mines_reveal', v_ok);
  if not v_ok then
    -- Return instead of raising so the failed attempt row is kept (a raise would roll it back).
    return jsonb_build_object('status', 'wrong_code',
      'attempts_left', 5 - (select count(*) from public.secret_attempts where user_id = uid and not success and created_at > now() - interval '1 hour'));
  end if;

  select secret -> 'mines' into v_mines from public.game_round_secrets where round_id = p_round;
  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (uid, 'mines_secret_reveal', 'game_round', p_round::text, jsonb_build_object('bet', r.bet, 'mines', r.choice -> 'mines'));
  return jsonb_build_object('status', 'ok', 'mine_positions', v_mines);
end $$;

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
  v_ok := v_hash is not null and public._sha256_hex(trim(p_code)) = v_hash
    and exists (select 1 from public.admin_roles where user_id = uid and role = 'owner');  -- owner-only since launch
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
