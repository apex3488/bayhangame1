-- 0029: Telegram group moderation for the BAYHAN GAME owner.
--
-- Completely separate from game administration: nothing here reads or writes players, wallets,
-- game bans or admin roles (admin_roles is only read to recognise the owner). Group bans, mutes and
-- kicks are Telegram actions in one group; this schema only records them.
--
-- Known members come from what the bot legitimately sees: message authors, join/leave service
-- messages and chat_member updates. Telegram gives bots no full member list, so mass actions only
-- target these ids. Message ids are kept 48 hours (Telegram lets bots delete messages only that long).
--
-- Additive only. Rollback: drop the tg_mod_* tables and functions, the cron job telegram-mod-prune,
-- the columns username/first_name/status/status_at of tg_chat_members, and restore tg_begin and
-- tg_party_tick from 0028.

-- -------------------------------------------------------------- members ----
alter table public.tg_chat_members
  add column if not exists username   text,
  add column if not exists first_name text,
  add column if not exists status     text not null default 'member',
  add column if not exists status_at  timestamptz;
create index if not exists tg_chat_members_seen on public.tg_chat_members (chat_id, last_seen_at desc);

-- --------------------------------------------------------------- tables ----
create table public.tg_mod_settings (
  chat_id        bigint primary key references public.tg_chats(chat_id) on delete cascade,
  silent         boolean not null default true,   -- no public notices after successful actions
  delete_target  boolean not null default true,   -- delete the replied-to message on ban/mute/kick
  default_mute   integer not null default 3600 check (default_mute between 30 and 31622400),
  notice_seconds integer not null default 10 check (notice_seconds between 3 and 120),
  updated_at     timestamptz not null default now()
);

create table public.tg_mod_actions (
  id               bigserial primary key,
  chat_id          bigint not null,
  target_id        bigint,
  moderator_id     bigint not null,
  -- ban, unban, mute, unmute, kick, delete, warn, unwarn, warnreset, lock, unlock, cleanup
  action           text not null,
  duration_seconds integer,
  count            integer,
  reason           text,
  status           text not null check (status in ('ok', 'failed')),
  error            text,
  bulk_id          uuid,
  op_key           text unique,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz
);
create index tg_mod_actions_chat on public.tg_mod_actions (chat_id, created_at desc);
create index tg_mod_actions_target on public.tg_mod_actions (chat_id, target_id, created_at desc);

create table public.tg_mod_warnings (
  id           bigserial primary key,
  chat_id      bigint not null,
  user_id      bigint not null,
  moderator_id bigint not null,
  reason       text,
  created_at   timestamptz not null default now(),
  active       boolean not null default true
);
create index tg_mod_warnings_user on public.tg_mod_warnings (chat_id, user_id) where active;

create table public.tg_mod_messages (
  chat_id     bigint not null,
  message_id  integer not null,
  sender_id   bigint,
  observed_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index tg_mod_messages_age on public.tg_mod_messages (observed_at);

create table public.tg_mod_locks (
  chat_id           bigint primary key,
  locked            boolean not null,
  saved_permissions jsonb,           -- the group's permissions before «закрыть чат»
  changed_by        bigint,
  changed_at        timestamptz not null default now()
);

create table public.tg_mod_bulk (
  id            uuid primary key default gen_random_uuid(),
  chat_id       bigint not null,
  chat_title    text,
  initiated_by  bigint not null,
  action        text not null check (action in ('ban', 'mute', 'kick', 'unban')),
  scope         text not null,       -- all, d1, d7, list, undo
  seconds       integer,             -- mute length (null = forever)
  status        text not null default 'draft' check (status in ('draft', 'confirm', 'running', 'stopped', 'done', 'cancelled')),
  undo_of       uuid references public.tg_mod_bulk(id),
  total         integer not null default 0,
  ok            integer not null default 0,
  failed        integer not null default 0,
  skipped       integer not null default 0,
  panel_chat    bigint,
  panel_message integer,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '10 minutes',
  started_at    timestamptz,
  completed_at  timestamptz
);
create index tg_mod_bulk_running on public.tg_mod_bulk (status) where status = 'running';

create table public.tg_mod_bulk_targets (
  bulk_id uuid not null references public.tg_mod_bulk(id) on delete cascade,
  user_id bigint not null,
  name    text,
  -- already: was banned before this operation (an undo never unbans these)
  status  text not null default 'pending' check (status in ('pending', 'ok', 'failed', 'skipped', 'already')),
  error   text,
  done_at timestamptz,
  primary key (bulk_id, user_id)
);
create index tg_mod_bulk_targets_pending on public.tg_mod_bulk_targets (bulk_id) where status = 'pending';

create table public.tg_mod_autodelete (
  chat_id    bigint not null,
  message_id integer not null,
  delete_at  timestamptz not null,
  primary key (chat_id, message_id)
);
create index tg_mod_autodelete_due on public.tg_mod_autodelete (delete_at);

-- Server-side state behind confirmation buttons (callback data carries only this id).
create table public.tg_mod_sessions (
  id         uuid primary key default gen_random_uuid(),
  owner_tg   bigint not null,
  chat_id    bigint not null,
  kind       text not null,
  data       jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------- owner ----
create or replace function public.tg_mod_owner_ids()
returns bigint[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t.telegram_id), '{}') from public.admin_roles r
    join public.telegram_accounts t on t.user_id = r.user_id where r.role = 'owner';
$$;

create or replace function public.tg_mod_is_owner(p_tg bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles r join public.telegram_accounts t on t.user_id = r.user_id
    where r.role = 'owner' and t.telegram_id = p_tg);
$$;

-- ------------------------------------------------------------- tg_begin ----
-- Same as 0028 plus: the message id for cleanup, member names, and whether the sender is the owner.
drop function if exists public.tg_begin(bigint, bigint, bigint, text, text, integer);
create function public.tg_begin(p_update bigint, p_tg bigint, p_chat bigint, p_chat_type text, p_title text, p_limit integer,
  p_msg integer default null, p_username text default null, p_first_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new boolean; v_rate boolean := true; v_settings jsonb; v_uid uuid; v_party boolean := false; v_state jsonb;
begin
  insert into public.telegram_updates (update_id) values (p_update) on conflict do nothing;
  v_new := found;
  if not v_new then return jsonb_build_object('new', false); end if;
  if p_tg is not null and p_tg > 0 then v_rate := public.tg_rate_hit('bot:' || p_tg, p_limit, 60); end if;
  v_uid := public.tg_user(p_tg);
  if p_chat_type in ('group', 'supergroup') then
    insert into public.tg_chats (chat_id, title, type) values (p_chat, left(p_title, 128), p_chat_type)
    on conflict (chat_id) do update set title = excluded.title, active = true, last_seen_at = now()
      where public.tg_chats.last_seen_at < now() - interval '1 minute' or public.tg_chats.active = false;
    select settings into v_settings from public.tg_chats where chat_id = p_chat;
    if p_tg is not null and p_tg > 0 then
      insert into public.tg_chat_members (chat_id, telegram_id, username, first_name)
      values (p_chat, p_tg, p_username, left(p_first_name, 64))
      on conflict (chat_id, telegram_id) do update set last_seen_at = now(), username = excluded.username,
        first_name = excluded.first_name,
        status = case when public.tg_chat_members.status in ('left', 'kicked') then 'member' else public.tg_chat_members.status end
        where public.tg_chat_members.last_seen_at < now() - interval '1 minute'
           or public.tg_chat_members.first_name is null
           or public.tg_chat_members.status in ('left', 'kicked');
    end if;
    if p_msg is not null then
      insert into public.tg_mod_messages (chat_id, message_id, sender_id) values (p_chat, p_msg, p_tg) on conflict do nothing;
    end if;
    v_party := exists (select 1 from public.tg_party_games where chat_id = p_chat and finished_at is null);
  elsif p_chat_type = 'private' then
    select jsonb_build_object('kind', kind, 'data', data) into v_state
      from public.tg_admin_state where telegram_id = p_tg and expires_at > now();
  end if;
  if random() < 0.01 then delete from public.telegram_updates where received_at < now() - interval '7 days'; end if;
  return jsonb_build_object('new', true, 'rate_ok', v_rate, 'linked', v_uid is not null,
    'settings', coalesce(v_settings, '{"casino": true, "party": true}'::jsonb), 'party', v_party, 'state', v_state,
    'owner', p_tg is not null and public.tg_mod_is_owner(p_tg));
end $$;

-- Join/leave messages and chat_member updates: [{id, username, first_name}] with their status.
create or replace function public.tg_mod_seen(p_chat bigint, p_title text, p_type text, p_users jsonb, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare u jsonb;
begin
  if p_type not in ('group', 'supergroup') then return; end if;
  insert into public.tg_chats (chat_id, title, type) values (p_chat, left(p_title, 128), p_type) on conflict (chat_id) do nothing;
  for u in select * from jsonb_array_elements(coalesce(p_users, '[]'::jsonb)) loop
    continue when coalesce((u->>'id')::bigint, 0) <= 0;
    insert into public.tg_chat_members (chat_id, telegram_id, username, first_name, status, status_at)
    values (p_chat, (u->>'id')::bigint, u->>'username', left(u->>'first_name', 64), p_status, now())
    on conflict (chat_id, telegram_id) do update set username = excluded.username, first_name = excluded.first_name,
      status = excluded.status, status_at = now(),
      last_seen_at = case when excluded.status in ('member', 'restricted', 'administrator', 'creator') then now()
                          else public.tg_chat_members.last_seen_at end;
  end loop;
end $$;

-- ------------------------------------------------------------ mass ops ----
-- Draft of a mass action: the eligible known members of the chat, minus protected ids.
create or replace function public.tg_mod_bulk_create(p_owner bigint, p_chat bigint, p_action text, p_scope text,
  p_ids bigint[], p_exclude bigint[], p_seconds integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_total integer; v_title text; v_owners bigint[] := public.tg_mod_owner_ids();
begin
  if not public.tg_mod_is_owner(p_owner) then raise exception 'forbidden'; end if;
  if p_action not in ('ban', 'mute', 'kick') or p_scope not in ('all', 'd1', 'd7', 'list') then raise exception 'invalid_value'; end if;
  select title into v_title from public.tg_chats where chat_id = p_chat;
  if not found then raise exception 'target_not_found'; end if;
  -- One open draft per owner and chat.
  update public.tg_mod_bulk set status = 'cancelled'
    where chat_id = p_chat and initiated_by = p_owner and status in ('draft', 'confirm');
  insert into public.tg_mod_bulk (chat_id, chat_title, initiated_by, action, scope, seconds)
    values (p_chat, v_title, p_owner, p_action, p_scope, p_seconds) returning id into v_id;
  insert into public.tg_mod_bulk_targets (bulk_id, user_id, name)
  select v_id, u.id, coalesce(m.first_name, '@' || m.username, u.id::text)
  from (
    select telegram_id as id from public.tg_chat_members
      where chat_id = p_chat and p_scope in ('all', 'd1', 'd7') and status not in ('left', 'kicked')
        and (p_scope = 'all' or last_seen_at > now() - case p_scope when 'd1' then interval '1 day' else interval '7 days' end)
    union
    select x from unnest(coalesce(p_ids, '{}'::bigint[])) as x where p_scope = 'list'
  ) u
  left join public.tg_chat_members m on m.chat_id = p_chat and m.telegram_id = u.id
  where u.id > 0 and u.id <> all (coalesce(p_exclude, '{}')) and u.id <> all (v_owners)
    and u.id not in (777000, 1087968824, 136817688)
  limit 5000;
  get diagnostics v_total = row_count;
  update public.tg_mod_bulk set total = v_total where id = v_id;
  return jsonb_build_object('id', v_id, 'total', v_total, 'title', v_title,
    'preview', (select coalesce(jsonb_agg(name), '[]'::jsonb) from (select name from public.tg_mod_bulk_targets where bulk_id = v_id limit 10) x));
end $$;

-- Undo of a mass ban: unbans only the users this operation banned (never ones banned before it).
create or replace function public.tg_mod_bulk_undo(p_owner bigint, p_bulk uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.tg_mod_bulk; v_id uuid; v_total integer;
begin
  select * into b from public.tg_mod_bulk where id = p_bulk;
  if not found or b.initiated_by <> p_owner or not public.tg_mod_is_owner(p_owner) then raise exception 'forbidden'; end if;
  if b.action <> 'ban' or b.undo_of is not null or b.status not in ('done', 'stopped') then raise exception 'invalid_value'; end if;
  if exists (select 1 from public.tg_mod_bulk where undo_of = p_bulk and status in ('confirm', 'running', 'done', 'stopped')) then
    raise exception 'already_exists';
  end if;
  insert into public.tg_mod_bulk (chat_id, chat_title, initiated_by, action, scope, status, undo_of)
    values (b.chat_id, b.chat_title, p_owner, 'unban', 'undo', 'confirm', p_bulk) returning id into v_id;
  insert into public.tg_mod_bulk_targets (bulk_id, user_id, name)
    select v_id, user_id, name from public.tg_mod_bulk_targets where bulk_id = p_bulk and status = 'ok';
  get diagnostics v_total = row_count;
  update public.tg_mod_bulk set total = v_total where id = v_id;
  return jsonb_build_object('id', v_id, 'total', v_total);
end $$;

-- Results of one batch: [{user_id, status, error}]. Only pending targets change, so two runners
-- processing the same batch cannot count a user twice.
create or replace function public.tg_mod_bulk_report(p_bulk uuid, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.tg_mod_bulk; r jsonb; v_st text; v_uid bigint;
begin
  select * into b from public.tg_mod_bulk where id = p_bulk for update;
  if not found then raise exception 'target_not_found'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_st := r->>'status'; v_uid := (r->>'user_id')::bigint;
    continue when v_st not in ('ok', 'failed', 'skipped', 'already');
    update public.tg_mod_bulk_targets set status = v_st, error = left(r->>'error', 200), done_at = now()
      where bulk_id = p_bulk and user_id = v_uid and status = 'pending';
    continue when not found;
    update public.tg_mod_bulk set ok = ok + (v_st = 'ok')::int, failed = failed + (v_st = 'failed')::int,
      skipped = skipped + (v_st in ('skipped', 'already'))::int where id = p_bulk;
    if v_st in ('ok', 'failed') then
      insert into public.tg_mod_actions (chat_id, target_id, moderator_id, action, duration_seconds, status, error, bulk_id, reason, expires_at)
      values (b.chat_id, v_uid, b.initiated_by, b.action, b.seconds, v_st, left(r->>'error', 200), p_bulk,
        case when b.undo_of is not null then 'Отмена массовой операции' else 'Массовая операция' end,
        case when b.action = 'mute' and b.seconds is not null then now() + make_interval(secs => b.seconds) end);
    end if;
    if v_st = 'ok' then
      update public.tg_chat_members set status_at = now(),
        status = case b.action when 'ban' then 'kicked' when 'mute' then 'restricted' else 'left' end
        where chat_id = b.chat_id and telegram_id = v_uid;
    end if;
  end loop;
  if not exists (select 1 from public.tg_mod_bulk_targets where bulk_id = p_bulk and status = 'pending') then
    update public.tg_mod_bulk set status = 'done', completed_at = now() where id = p_bulk and status in ('running', 'stopped');
  end if;
  select * into b from public.tg_mod_bulk where id = p_bulk;
  return to_jsonb(b);
end $$;

-- ---------------------------------------------------------------- views ----
-- Bans and mutes in force: the latest ban/mute/unban/unmute/kick per user decides.
create or replace function public.tg_mod_active(p_chat bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  with last as (
    select distinct on (target_id) target_id, action, expires_at, reason, created_at
    from public.tg_mod_actions
    where chat_id = p_chat and status = 'ok' and target_id is not null and action in ('ban', 'unban', 'mute', 'unmute', 'kick')
    order by target_id, created_at desc, id desc
  ), act as (
    select * from last where action in ('ban', 'mute') and (expires_at is null or expires_at > now())
  )
  select jsonb_build_object('total', (select count(*) from act), 'items', coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('user_id', a.target_id, 'action', a.action, 'expires_at', a.expires_at, 'reason', a.reason,
        'name', coalesce(m.first_name, '@' || m.username, a.target_id::text)) x
      from act a left join public.tg_chat_members m on m.chat_id = p_chat and m.telegram_id = a.target_id
      order by a.created_at desc limit 30) s), '[]'::jsonb));
$$;

create or replace function public.tg_mod_warn_list(p_chat bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('user_id', w.user_id, 'count', count(*), 'name', coalesce(max(m.first_name), '@' || max(m.username), w.user_id::text)) x
    from public.tg_mod_warnings w left join public.tg_chat_members m on m.chat_id = p_chat and m.telegram_id = w.user_id
    where w.chat_id = p_chat and w.active group by w.user_id order by max(w.created_at) desc limit 20) s;
$$;

create or replace function public.tg_mod_stats(p_chat bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bans',     count(*) filter (where action = 'ban' and status = 'ok' and expires_at is null),
    'tempbans', count(*) filter (where action = 'ban' and status = 'ok' and expires_at is not null),
    'mutes',    count(*) filter (where action = 'mute' and status = 'ok'),
    'kicks',    count(*) filter (where action = 'kick' and status = 'ok'),
    'deleted',  coalesce(sum(count) filter (where action in ('delete', 'cleanup') and status = 'ok'), 0),
    'warns',    count(*) filter (where action = 'warn' and status = 'ok'),
    'failed',   count(*) filter (where status = 'failed'),
    'bulk',     (select count(*) from public.tg_mod_bulk where chat_id = p_chat and status in ('done', 'stopped')),
    'members',  (select count(*) from public.tg_chat_members where chat_id = p_chat and status not in ('left', 'kicked')),
    'active',   (public.tg_mod_active(p_chat)->>'total')::int)
  from public.tg_mod_actions where chat_id = p_chat;
$$;

-- ---------------------------------------------------------------- timer ----
create or replace function public.tg_mod_autodelete_due()
returns table (chat_id bigint, message_id integer) language sql security definer set search_path = public as $$
  delete from public.tg_mod_autodelete d
  where (d.chat_id, d.message_id) in (
    select a.chat_id, a.message_id from public.tg_mod_autodelete a where a.delete_at <= now() order by a.delete_at limit 300)
  returning d.chat_id, d.message_id;
$$;

create or replace function public.tg_mod_prune()
returns void language sql security definer set search_path = public as $$
  delete from public.tg_mod_messages where observed_at < now() - interval '48 hours';
  delete from public.tg_mod_sessions where expires_at < now();
  delete from public.tg_mod_autodelete where delete_at < now() - interval '1 day';
  update public.tg_mod_bulk set status = 'cancelled' where status in ('draft', 'confirm') and expires_at < now();
$$;
select cron.schedule('telegram-mod-prune', '7 * * * *', 'select public.tg_mod_prune()');

-- The 10-second timer also wakes the bot for mass operations and notices to delete.
create or replace function public.tg_party_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from public.tg_party_games where finished_at is null and deadline < now())
     and not exists (select 1 from public.tg_lotteries where status = 'open' and draw_at <= now())
     and not exists (select 1 from public.tg_giveaways where status = 'open' and expires_at <= now())
     and not exists (select 1 from public.tg_mod_bulk where status = 'running')
     and not exists (select 1 from public.tg_mod_autodelete where delete_at <= now()) then
    return;
  end if;
  perform net.http_post(
    url := 'https://byjhzqpchxvzssipjfnh.supabase.co/functions/v1/telegram-bot?forceFunctionRegion=ap-southeast-1',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-telegram-bot-api-secret-token', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret')),
    body := '{"tick": true}'::jsonb,
    timeout_milliseconds := 20000);
end $$;

-- ---------------------------------------------------------------- grants ----
alter table public.tg_mod_settings     enable row level security;
alter table public.tg_mod_actions      enable row level security;
alter table public.tg_mod_warnings     enable row level security;
alter table public.tg_mod_messages     enable row level security;
alter table public.tg_mod_locks        enable row level security;
alter table public.tg_mod_bulk         enable row level security;
alter table public.tg_mod_bulk_targets enable row level security;
alter table public.tg_mod_autodelete   enable row level security;
alter table public.tg_mod_sessions     enable row level security;
revoke all on public.tg_mod_settings, public.tg_mod_actions, public.tg_mod_warnings, public.tg_mod_messages, public.tg_mod_locks,
  public.tg_mod_bulk, public.tg_mod_bulk_targets, public.tg_mod_autodelete, public.tg_mod_sessions from anon, authenticated;
grant select, insert, update, delete on public.tg_mod_settings, public.tg_mod_actions, public.tg_mod_warnings, public.tg_mod_messages,
  public.tg_mod_locks, public.tg_mod_bulk, public.tg_mod_bulk_targets, public.tg_mod_autodelete, public.tg_mod_sessions to service_role;
grant usage on sequence public.tg_mod_actions_id_seq, public.tg_mod_warnings_id_seq to service_role;

revoke all on function public.tg_mod_owner_ids(), public.tg_mod_is_owner(bigint),
  public.tg_begin(bigint, bigint, bigint, text, text, integer, integer, text, text),
  public.tg_mod_seen(bigint, text, text, jsonb, text),
  public.tg_mod_bulk_create(bigint, bigint, text, text, bigint[], bigint[], integer), public.tg_mod_bulk_undo(bigint, uuid),
  public.tg_mod_bulk_report(uuid, jsonb), public.tg_mod_active(bigint), public.tg_mod_warn_list(bigint), public.tg_mod_stats(bigint),
  public.tg_mod_autodelete_due(), public.tg_mod_prune(), public.tg_party_tick()
  from public, anon, authenticated;
grant execute on function public.tg_mod_owner_ids(), public.tg_mod_is_owner(bigint),
  public.tg_begin(bigint, bigint, bigint, text, text, integer, integer, text, text),
  public.tg_mod_seen(bigint, text, text, jsonb, text),
  public.tg_mod_bulk_create(bigint, bigint, text, text, bigint[], bigint[], integer), public.tg_mod_bulk_undo(bigint, uuid),
  public.tg_mod_bulk_report(uuid, jsonb), public.tg_mod_active(bigint), public.tg_mod_warn_list(bigint), public.tg_mod_stats(bigint),
  public.tg_mod_autodelete_due()
  to service_role;
