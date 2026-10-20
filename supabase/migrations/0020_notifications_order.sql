-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0020: strict "newest first" order for notifications,
-- broadcasts and news (rows created in the same transaction share a timestamp).
-- ============================================================================

create or replace function public.my_notifications(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = uid and read_at is null),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc) from (
        select id, kind, title, body, params, link, created_at, read_at is not null as read
        from public.notifications where user_id = uid
        order by created_at desc, id desc limit least(greatest(coalesce(p_limit, 30), 1), 100)
      ) x), '[]'::jsonb));
end $$;

create or replace function public.admin_list_broadcasts(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin']);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc) from (
      select b.id, b.title, b.body, b.link, b.recipients, b.created_at, a.game_name as actor, t.game_name as target,
             (select count(*) from public.notifications n where n.broadcast_id = b.id and n.read_at is not null) as read_count
      from public.broadcasts b left join public.profiles a on a.id = b.actor_id left join public.profiles t on t.id = b.target_user
      order by b.created_at desc, b.id desc limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) x), '[]'::jsonb);
end $$;

create or replace function public.news_list(p_limit int default 20, p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.pinned desc, x.published_at desc, x.id desc) from (
      select n.id, n.title, n.body, n.image_path, n.pinned, n.published_at, p.game_name as author
      from public.news n left join public.profiles p on p.id = n.author_id
      where not n.hidden and (p_before is null or n.id < p_before)
      order by n.pinned desc, n.published_at desc, n.id desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x), '[]'::jsonb);
end $$;

create or replace function public.admin_list_news(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin(array['owner','admin']);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.published_at desc, x.id desc) from (
      select n.id, n.title, n.body, n.image_path, n.pinned, n.hidden, n.published_at, p.game_name as author,
             (select count(*) from public.notifications q where q.kind = 'news' and q.params->>'news_id' = n.id::text and q.read_at is not null) as read_count
      from public.news n left join public.profiles p on p.id = n.author_id
      order by n.published_at desc, n.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) x), '[]'::jsonb);
end $$;
