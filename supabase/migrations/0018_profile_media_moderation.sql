-- Supabase forbids deleting storage rows from SQL ("Use the Storage API instead"),
-- so admin_clear_profile_media from 0017 failed for images. Now:
--  * the function only hides the image (version → null) and audits it;
--  * the admin UI then deletes the file through the Storage API, allowed by the
--    policy below for moderators and above.

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid() and role in ('owner','admin','moderator'));
$$;
revoke all on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

create policy "profile media: moderators delete" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and public.is_moderator());

create or replace function public.admin_clear_profile_media(p_user uuid, p_what text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin','moderator']);
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_what = 'avatar' then
    update public.profiles set avatar_version = null where id = p_user;
  elsif p_what = 'background' then
    update public.profiles set background_version = null, background = 'default' where id = p_user;
  elsif p_what = 'bio' then
    update public.profiles set bio = '' where id = p_user;
  else
    raise exception 'invalid_choice';
  end if;
  if not found then raise exception 'target_not_found'; end if;
  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (v_actor, 'profile_media_clear', 'profile', p_user::text, jsonb_build_object('what', p_what, 'reason', trim(p_reason)));
  return jsonb_build_object('status','ok','path', case when p_what in ('avatar','background') then p_user::text || '/' || p_what end);
end $$;
revoke all on function public.admin_clear_profile_media(uuid, text, text) from public, anon;
grant execute on function public.admin_clear_profile_media(uuid, text, text) to authenticated;
