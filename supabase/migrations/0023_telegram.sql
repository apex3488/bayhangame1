-- 0023: Telegram bot + Mini App on the same accounts and economy.
--
-- One player = one auth user = one profiles row, whichever interface they use.
-- Telegram only adds an optional link (telegram_accounts). The bot and the Mini App
-- auth endpoint run as Supabase Edge Functions with the service role; they never touch
-- balances directly. tg_call() runs the very same game RPCs the browser calls, with
-- auth.uid() set to the linked player, so every rule, lock and idempotency key is shared.
--
-- Additive only: no existing table or function is changed. Rollback:
--   drop function public.tg_call, public.tg_link_user, public.tg_consume_link_code, public.tg_user,
--     public.tg_config, public.tg_rate_hit, public.tg_seen_update, public.telegram_link_code_create,
--     public.my_telegram, public.telegram_unlink;
--   drop table public.telegram_link_codes, public.telegram_updates, public.rate_hits, public.telegram_accounts;

-- ------------------------------------------------------------- tables ----
create table public.telegram_accounts (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  telegram_id  bigint not null unique check (telegram_id > 0),
  username     text,
  first_name   text,
  linked_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One-time codes: the browser creates one, the bot consumes it (t.me/<bot>?start=link_<code>).
create table public.telegram_link_codes (
  code       text primary key check (code ~ '^[A-Z0-9]{10}$'),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index telegram_link_codes_user on public.telegram_link_codes (user_id);

-- Telegram retries a webhook until it gets 200; each update is handled once.
create table public.telegram_updates (
  update_id   bigint primary key,
  received_at timestamptz not null default now()
);

-- Fixed-window rate limiting for the Telegram endpoints.
create table public.rate_hits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

alter table public.telegram_accounts   enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_updates    enable row level security;
alter table public.rate_hits           enable row level security;
-- Players read only their own link; codes, updates and rate counters are service-only.
create policy read_own on public.telegram_accounts for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------- service-only helpers ----
-- Secrets live in Supabase Vault (never in git or the frontend):
--   telegram_bot_token, telegram_webhook_secret.
create or replace function public.tg_config()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'bot_token',      (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_bot_token'),
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret'));
$$;

create or replace function public.tg_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
        v_hits integer;
begin
  insert into public.rate_hits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_hits.hits + 1
  returning hits into v_hits;
  -- Old windows are cleaned up opportunistically.
  if random() < 0.01 then delete from public.rate_hits where window_start < now() - interval '1 day'; end if;
  return v_hits <= p_limit;
end $$;

-- true the first time an update_id is seen.
create or replace function public.tg_seen_update(p_update_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.telegram_updates (update_id) values (p_update_id) on conflict do nothing;
  if not found then return false; end if;
  if random() < 0.01 then delete from public.telegram_updates where received_at < now() - interval '7 days'; end if;
  return true;
end $$;

create or replace function public.tg_user(p_tg bigint)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.telegram_accounts where telegram_id = p_tg;
$$;

-- Links a Telegram id to a player. The caller has already proven both sides
-- (verified initData / bot update + the player's own session or one-time code).
create or replace function public.tg_link_user(p_user uuid, p_tg bigint, p_username text, p_first_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_tg bigint;
begin
  if p_user is null or p_tg is null or p_tg <= 0 then raise exception 'invalid_link'; end if;
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'profile_not_found'; end if;
  select user_id into v_owner from public.telegram_accounts where telegram_id = p_tg;
  if v_owner is not null and v_owner <> p_user then raise exception 'telegram_already_linked'; end if;
  select telegram_id into v_tg from public.telegram_accounts where user_id = p_user;
  if v_tg is not null and v_tg <> p_tg then raise exception 'account_already_linked'; end if;
  insert into public.telegram_accounts (user_id, telegram_id, username, first_name)
  values (p_user, p_tg, left(p_username, 64), left(p_first_name, 64))
  on conflict (user_id) do update set username = excluded.username, first_name = excluded.first_name, last_seen_at = now();
  return jsonb_build_object('status', case when v_tg is null then 'linked' else 'already' end,
    'game_name', (select game_name from public.profiles where id = p_user));
end $$;

create or replace function public.tg_consume_link_code(p_code text, p_tg bigint, p_username text, p_first_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.telegram_link_codes;
begin
  select * into v from public.telegram_link_codes where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or v.used_at is not null or v.expires_at < now() then raise exception 'link_code_invalid'; end if;
  update public.telegram_link_codes set used_at = now() where code = v.code;
  return public.tg_link_user(v.user_id, p_tg, p_username, p_first_name);
end $$;

-- Runs one game RPC as the player linked to p_tg. Only whitelisted read/claim operations;
-- everything else is done in the Mini App, which calls the RPCs with the player's own session.
create or replace function public.tg_call(p_tg bigint, p_fn text, p_arg text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.tg_user(p_tg); r jsonb;
begin
  if p_fn = 'leaderboard' then
    return coalesce((select jsonb_agg(to_jsonb(l) - 'user_id' - 'avatar_version' order by l.rank)
                       from public.leaderboard_capital(least(greatest(coalesce(p_arg::int, 10), 1), 50)) l), '[]'::jsonb);
  end if;
  if uid is null then raise exception 'telegram_not_linked'; end if;
  -- Same identity the API gateway gives a signed-in player (auth.uid() reads these settings).
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  update public.telegram_accounts set last_seen_at = now() where user_id = uid;
  case p_fn
    when 'snapshot'     then r := public.get_my_snapshot();
    when 'profile'      then r := public.my_profile() || jsonb_build_object('snapshot', public.get_my_snapshot());
    when 'daily_status' then r := public.daily_status();
    when 'claim_daily'  then r := public.claim_daily(p_arg);
    when 'quests'       then r := coalesce((select jsonb_agg(to_jsonb(q)) from public.my_quests() q), '[]'::jsonb);
    when 'referrals'    then r := public.my_referrals();
    when 'admin_stats'  then
      if public._admin_role(uid) is null then raise exception 'forbidden'; end if;
      r := jsonb_build_object(
        'role', public._admin_role(uid),
        'players', (select count(*) from public.profiles),
        'players_today', (select count(*) from public.profiles where created_at >= date_trunc('day', now())),
        'telegram_linked', (select count(*) from public.telegram_accounts),
        'active_24h', (select count(*) from public.telegram_accounts where last_seen_at > now() - interval '24 hours'),
        'rounds_today', (select count(*) from public.game_rounds where created_at >= date_trunc('day', now())));
    else raise exception 'unknown_operation';
  end case;
  return r;
end $$;

-- ------------------------------------------------- player-facing RPCs ----
create or replace function public.my_telegram()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('linked', true, 'username', username, 'first_name', first_name, 'linked_at', linked_at)
                     from public.telegram_accounts where user_id = auth.uid()), jsonb_build_object('linked', false));
$$;

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
               from (select gen_random_bytes(10) b) s, generate_series(0, 9) i);
  insert into public.telegram_link_codes (code, user_id, expires_at) values (v_code, uid, v_exp);
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

create or replace function public.telegram_unlink()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.telegram_accounts where user_id = auth.uid();
  return jsonb_build_object('status', 'ok');
end $$;

-- ------------------------------------------------------------- grants ----
revoke all on function public.tg_config(), public.tg_rate_hit(text, integer, integer), public.tg_seen_update(bigint),
  public.tg_user(bigint), public.tg_link_user(uuid, bigint, text, text), public.tg_consume_link_code(text, bigint, text, text),
  public.tg_call(bigint, text, text), public.my_telegram(), public.telegram_link_code_create(), public.telegram_unlink()
  from public, anon, authenticated;
grant execute on function public.tg_config(), public.tg_rate_hit(text, integer, integer), public.tg_seen_update(bigint),
  public.tg_user(bigint), public.tg_link_user(uuid, bigint, text, text), public.tg_consume_link_code(text, bigint, text, text),
  public.tg_call(bigint, text, text)
  to service_role;
grant execute on function public.my_telegram(), public.telegram_link_code_create(), public.telegram_unlink() to authenticated;
revoke insert, update, delete, truncate on public.telegram_accounts, public.telegram_link_codes, public.telegram_updates, public.rate_hits
  from anon, authenticated;
