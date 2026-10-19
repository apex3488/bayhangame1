-- Secret code in Mines that reveals the mine positions of the player's active round.
-- The code itself is NOT in this repository: only its SHA-256 hash is stored, inserted
-- separately (see docs/STATUS.md). Brute force is limited to 5 wrong attempts per hour
-- per player, and every successful use is written to the audit log.

create table public.game_secrets (
  key        text primary key,
  code_hash  text not null,
  updated_at timestamptz not null default now()
);
alter table public.game_secrets enable row level security;   -- no client policy: never readable

create table public.secret_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  secret_key text not null,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index secret_attempts_user_time on public.secret_attempts (user_id, created_at desc);
alter table public.secret_attempts enable row level security;

create or replace function public._sha256_hex(p text)
returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex');
$$;

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
  v_ok := v_hash is not null and public._sha256_hex(trim(p_code)) = v_hash;
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

revoke all on function public._sha256_hex(text) from public, anon, authenticated;
revoke all on function public.mines_reveal(uuid, text) from public, anon;
grant execute on function public.mines_reveal(uuid, text) to authenticated;
