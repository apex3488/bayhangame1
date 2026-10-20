-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0019: notifications, broadcasts and news.
--
-- * notifications: per-player inbox. Filled by triggers (incoming transfer,
--   credit from the administration, marriage proposal, corporation invite),
--   by news publishing and by admin broadcasts. Read only through RPCs.
-- * broadcasts: what the administration sent and to whom (history).
-- * news: posts with an optional photo in Storage bucket 'news-media'
--   (public read; only owner/admin may upload).
-- Links inside notifications may only point to pages of the game itself.
-- ============================================================================

create table public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('broadcast','news','transfer_in','admin_credit','marriage_proposal','corp_invite')),
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 1000),
  params jsonb not null default '{}'::jsonb,
  link text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$'),
  broadcast_id bigint,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created on public.notifications (user_id, created_at desc);
create index notifications_user_unread on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;   -- no policies: RPC access only

create table public.broadcasts (
  id bigserial primary key,
  actor_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 1000),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$'),
  target_user uuid references public.profiles(id) on delete set null,   -- null = everyone
  recipients int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.broadcasts enable row level security;

create table public.news (
  id bigserial primary key,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  image_path text check (image_path is null or image_path ~ '^news/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  author_id uuid references public.profiles(id) on delete set null,
  pinned boolean not null default false,
  hidden boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index news_published on public.news (published_at desc);
alter table public.news enable row level security;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-media', 'news-media', true, 5242880, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_news_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid() and role in ('owner','admin'));
$$;
revoke all on function public.is_news_editor() from public, anon;
grant execute on function public.is_news_editor() to authenticated;

create policy "news media: editors insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'news-media' and (storage.foldername(name))[1] = 'news' and public.is_news_editor());
create policy "news media: editors update" on storage.objects for update to authenticated
  using (bucket_id = 'news-media' and public.is_news_editor())
  with check (bucket_id = 'news-media' and (storage.foldername(name))[1] = 'news' and public.is_news_editor());
create policy "news media: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'news-media' and public.is_news_editor());
create policy "news media: editors select" on storage.objects for select to authenticated
  using (bucket_id = 'news-media' and public.is_news_editor());

-- ---------------------------------------------------------------- helpers
create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text, p_params jsonb, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, params, link)
  values (p_user, p_kind, coalesce(p_title, ''), coalesce(p_body, ''), coalesce(p_params, '{}'::jsonb), p_link);
$$;
revoke all on function public._notify(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

create or replace function public._clean_link(p_link text)
returns text language plpgsql immutable as $$
declare v text := nullif(trim(coalesce(p_link, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^/[A-Za-z0-9/_-]*$' then raise exception 'invalid_link'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- triggers
create or replace function public._notify_on_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.op_type = 'transfer_in' and new.direction = 'credit' then
    perform public._notify(new.user_id, 'transfer_in', '', '',
      jsonb_build_object('amount', new.amount, 'account', new.account,
        'from', (select game_name from public.profiles where id = new.counterparty_id)), '/history');
  elsif new.op_type = 'admin_credit' and new.direction = 'credit' then
    perform public._notify(new.user_id, 'admin_credit', '', '',
      jsonb_build_object('amount', new.amount, 'account', new.account, 'reason', new.reason), '/history');
  end if;
  return null;
end $$;
create trigger ledger_notify after insert on public.ledger_entries
  for each row when (new.op_type in ('transfer_in','admin_credit')) execute function public._notify_on_ledger();

create or replace function public._notify_on_proposal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(new.to_user, 'marriage_proposal', '', '',
    jsonb_build_object('from', (select game_name from public.profiles where id = new.from_user)), '/marriage');
  return null;
end $$;
create trigger marriage_proposal_notify after insert on public.marriage_proposals
  for each row execute function public._notify_on_proposal();

create or replace function public._notify_on_corp_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(new.to_user, 'corp_invite', '', '',
    jsonb_build_object('corp', (select name from public.corporations where id = new.corp_id),
                       'from', (select game_name from public.profiles where id = new.from_user)), '/corporation');
  return null;
end $$;
create trigger corp_invite_notify after insert on public.corp_invites
  for each row execute function public._notify_on_corp_invite();

-- ---------------------------------------------------------------- player RPCs
create or replace function public.my_notifications(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = uid and read_at is null),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id, kind, title, body, params, link, created_at, read_at is not null as read
        from public.notifications where user_id = uid
        order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)
      ) x), '[]'::jsonb));
end $$;

create or replace function public.my_unread_notifications()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.notifications_mark_read(p_ids bigint[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update public.notifications set read_at = now()
   where user_id = uid and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.news_list(p_limit int default 20, p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.pinned desc, x.published_at desc) from (
      select n.id, n.title, n.body, n.image_path, n.pinned, n.published_at, p.game_name as author
      from public.news n left join public.profiles p on p.id = n.author_id
      where not n.hidden and (p_before is null or n.id < p_before)
      order by n.pinned desc, n.published_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- admin RPCs
create or replace function public.admin_broadcast(p_title text, p_body text, p_link text default null, p_target_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public._require_admin(array['owner','admin']);
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_link text := public._clean_link(p_link);
  v_id bigint; v_n int;
begin
  if char_length(v_title) not between 1 and 120 or char_length(v_body) not between 1 and 1000 then raise exception 'invalid_text'; end if;
  if p_target_user is not null and not exists (select 1 from public.profiles where id = p_target_user) then raise exception 'player_not_found'; end if;
  insert into public.broadcasts (actor_id, title, body, link, target_user) values (v_actor, v_title, v_body, v_link, p_target_user)
  returning id into v_id;
  insert into public.notifications (user_id, kind, title, body, link, broadcast_id)
  select p.id, 'broadcast', v_title, v_body, v_link, v_id from public.profiles p
  where (p_target_user is null and p.status <> 'blocked') or p.id = p_target_user;
  get diagnostics v_n = row_count;
  update public.broadcasts set recipients = v_n where id = v_id;
  perform public._audit(v_actor, 'broadcast', case when p_target_user is null then 'all' else 'profile' end,
    coalesce(p_target_user::text, 'all'), jsonb_build_object('broadcast_id', v_id, 'title', v_title, 'recipients', v_n));
  return jsonb_build_object('id', v_id, 'recipients', v_n);
end $$;

create or replace function public.admin_list_broadcasts(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin']);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select b.id, b.title, b.body, b.link, b.recipients, b.created_at, a.game_name as actor, t.game_name as target,
             (select count(*) from public.notifications n where n.broadcast_id = b.id and n.read_at is not null) as read_count
      from public.broadcasts b left join public.profiles a on a.id = b.actor_id left join public.profiles t on t.id = b.target_user
      order by b.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) x), '[]'::jsonb);
end $$;

create or replace function public.admin_publish_news(p_title text, p_body text, p_image_path text default null, p_pinned boolean default false, p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public._require_admin(array['owner','admin']);
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_img text := nullif(trim(coalesce(p_image_path, '')), '');
  v_id bigint; v_n int := 0;
begin
  if char_length(v_title) not between 3 and 120 or char_length(v_body) not between 1 and 4000 then raise exception 'invalid_text'; end if;
  if v_img is not null then
    if v_img !~ '^news/[0-9a-f-]{36}\.(webp|jpg|png)$' then raise exception 'invalid_image'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'news-media' and name = v_img) then raise exception 'upload_missing'; end if;
  end if;
  insert into public.news (title, body, image_path, author_id, pinned) values (v_title, v_body, v_img, v_actor, coalesce(p_pinned, false))
  returning id into v_id;
  if coalesce(p_notify, true) then
    insert into public.notifications (user_id, kind, title, params, link)
    select p.id, 'news', v_title, jsonb_build_object('news_id', v_id), '/news' from public.profiles p where p.status <> 'blocked';
    get diagnostics v_n = row_count;
  end if;
  perform public._audit(v_actor, 'news_publish', 'news', v_id::text, jsonb_build_object('title', v_title, 'notified', v_n));
  return jsonb_build_object('id', v_id, 'notified', v_n);
end $$;

create or replace function public.admin_update_news(p_id bigint, p_title text, p_body text, p_pinned boolean, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']);
begin
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 120 or char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then
    raise exception 'invalid_text';
  end if;
  update public.news set title = trim(p_title), body = trim(p_body), pinned = coalesce(p_pinned, pinned),
         hidden = coalesce(p_hidden, hidden), updated_at = now()
   where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public._audit(v_actor, 'news_update', 'news', p_id::text, jsonb_build_object('hidden', p_hidden, 'pinned', p_pinned));
  return jsonb_build_object('status', 'ok');
end $$;

-- Deletes the post; returns the image path so the panel removes the file through the Storage API.
create or replace function public.admin_delete_news(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin']); v_img text; v_title text;
begin
  delete from public.news where id = p_id returning image_path, title into v_img, v_title;
  if not found then raise exception 'not_found'; end if;
  delete from public.notifications where kind = 'news' and params->>'news_id' = p_id::text;
  perform public._audit(v_actor, 'news_delete', 'news', p_id::text, jsonb_build_object('title', v_title));
  return jsonb_build_object('status', 'ok', 'path', v_img);
end $$;

create or replace function public.admin_list_news(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin']);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.published_at desc) from (
      select n.id, n.title, n.body, n.image_path, n.pinned, n.hidden, n.published_at, p.game_name as author,
             (select count(*) from public.notifications q where q.kind = 'news' and q.params->>'news_id' = n.id::text and q.read_at is not null) as read_count
      from public.news n left join public.profiles p on p.id = n.author_id
      order by n.published_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.my_notifications(int), public.my_unread_notifications(), public.notifications_mark_read(bigint[]),
  public.news_list(int, bigint), public.admin_broadcast(text, text, text, uuid), public.admin_list_broadcasts(int),
  public.admin_publish_news(text, text, text, boolean, boolean), public.admin_update_news(bigint, text, text, boolean, boolean),
  public.admin_delete_news(bigint), public.admin_list_news(int), public._clean_link(text)
  from public, anon;
grant execute on function public.my_notifications(int), public.my_unread_notifications(), public.notifications_mark_read(bigint[]),
  public.news_list(int, bigint), public.admin_broadcast(text, text, text, uuid), public.admin_list_broadcasts(int),
  public.admin_publish_news(text, text, text, boolean, boolean), public.admin_update_news(bigint, text, text, boolean, boolean),
  public.admin_delete_news(bigint), public.admin_list_news(int)
  to authenticated;
revoke all on function public._notify_on_ledger(), public._notify_on_proposal(), public._notify_on_corp_invite() from public, anon, authenticated;
