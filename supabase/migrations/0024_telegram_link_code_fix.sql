-- 0024: telegram_link_code_create() could not find gen_random_bytes: on Supabase pgcrypto lives
-- in the `extensions` schema, outside the function's search_path. Same function, qualified call.
create or replace function public.telegram_link_code_create()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_code text; v_exp timestamptz := now() + interval '10 minutes';
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.telegram_accounts where user_id = uid) then raise exception 'account_already_linked'; end if;
  if (select count(*) from public.telegram_link_codes where user_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  delete from public.telegram_link_codes where user_id = uid and used_at is null;
  -- 10 chars from a 32-symbol alphabet without look-alikes: ~50 bits, valid for 10 minutes, single use.
  v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
               from (select extensions.gen_random_bytes(10) b) s, generate_series(0, 9) i);
  insert into public.telegram_link_codes (code, user_id, expires_at) values (v_code, uid, v_exp);
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

