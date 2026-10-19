-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0017: profile avatar, background and bio.
-- Images live in Supabase Storage, bucket 'profile-media' (public read, 4 MB,
-- images only). Each player may write only "<their uid>/avatar" and
-- "<their uid>/background". The database keeps a version number so updated
-- images bypass caches. Admins can clear inappropriate media (audited).
-- ============================================================================

alter table public.profiles add column bio text not null default '' check (char_length(bio) <= 200);
alter table public.profiles add column avatar_version bigint;          -- null = no avatar
alter table public.profiles add column background text not null default 'default';
alter table public.profiles add column background_version bigint;      -- set when background = 'custom'

alter table public.profiles add constraint profiles_background_check check (background in
  ('default','aurora','sunset','ocean','gold','neon','space','carbon','royal','custom'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 4194304, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Writes only to the caller's own folder, and only the two known file names.
create policy "profile media: own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text
              and storage.filename(name) in ('avatar', 'background'));
create policy "profile media: own files update" on storage.objects for update to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text
              and storage.filename(name) in ('avatar', 'background'));
create policy "profile media: own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile media: own files select" on storage.objects for select to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Bio + preset background. Bio is plain text (React renders it escaped).
create or replace function public.update_profile_appearance(p_bio text, p_background text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_bio text := regexp_replace(trim(coalesce(p_bio, '')), '\s+\n', E'\n', 'g');
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v_bio) > 200 then raise exception 'bio_too_long'; end if;
  if p_background not in ('default','aurora','sunset','ocean','gold','neon','space','carbon','royal','custom') then raise exception 'invalid_choice'; end if;
  if p_background = 'custom' and (select background_version from public.profiles where id = uid) is null then raise exception 'no_custom_background'; end if;
  update public.profiles set bio = v_bio, background = p_background where id = uid;
  return jsonb_build_object('status','ok');
end $$;

-- Called after the image was uploaded to Storage (or with p_present = false to remove it).
create or replace function public.set_profile_media(p_kind text, p_present boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_ver bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_kind = 'avatar' then
    if p_present and not exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = uid::text || '/avatar') then
      raise exception 'upload_missing';
    end if;
    update public.profiles set avatar_version = case when p_present then v_ver end where id = uid;
  elsif p_kind = 'background' then
    if p_present and not exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = uid::text || '/background') then
      raise exception 'upload_missing';
    end if;
    update public.profiles
       set background_version = case when p_present then v_ver end,
           background = case when p_present then 'custom' when background = 'custom' then 'default' else background end
     where id = uid;
  else
    raise exception 'invalid_choice';
  end if;
  return jsonb_build_object('status','ok','version', case when p_present then v_ver end);
end $$;

-- What other players may see.
create or replace function public.public_profile(p_game_name text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'game_name', p.game_name, 'public_id', p.public_id, 'level', p.level, 'created_at', p.created_at,
    'bio', p.bio, 'avatar_version', p.avatar_version, 'background', p.background, 'background_version', p.background_version,
    'status', p.status,
    'capital', public._capital(p.id),
    'loadout', public.loadout_of(p.id),
    'vip', (select level from public.user_vip v where v.user_id = p.id and v.ends_at > now()),
    'corporation', (select c.name from public.corp_members m join public.corporations c on c.id = m.corp_id where m.user_id = p.id),
    'partner', (select q.game_name from public.marriages m join public.profiles q on q.id = case when m.user1_id = p.id then m.user2_id else m.user1_id end
                 where m.ended_at is null and (m.user1_id = p.id or m.user2_id = p.id)),
    'stats', jsonb_build_object('games_played', public._stat(p.id, 'games_played'), 'games_won', public._stat(p.id, 'games_won'),
                                'achievements', (select count(*) from public.user_achievements a where a.user_id = p.id),
                                'cars', (select count(*) from public.user_cars c where c.user_id = p.id),
                                'luxury', (select count(*) from public.user_luxury l where l.user_id = p.id)))
  from public.profiles p
  where lower(p.game_name) = lower(trim(p_game_name)) and auth.uid() is not null;
$$;

-- Leaderboard with avatars.
drop function public.leaderboard_capital(integer);
create function public.leaderboard_capital(p_limit integer default 50)
returns table (rank bigint, game_name text, level integer, total_capital numeric, user_id uuid, avatar_version bigint)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by c desc), game_name, level, c, id, avatar_version
    from (select p.id, p.game_name, p.level, p.avatar_version, public._capital(p.id) c from public.profiles p where p.status = 'active') t
   order by c desc limit least(greatest(p_limit, 1), 100);
$$;

-- Own snapshot gains the appearance fields (otherwise identical to 0016).
create or replace function public.get_my_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; w public.wallets; a jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = uid;
  select * into w from public.wallets where user_id = uid;
  if not found then raise exception 'profile_not_found'; end if;
  a := public._assets(uid);
  return jsonb_build_object(
    'user_id', p.id, 'game_name', p.game_name, 'public_id', p.public_id, 'status', p.status,
    'xp', p.xp, 'level', p.level, 'xp_per_level', public._setting('xp_per_level'),
    'bio', p.bio, 'avatar_version', p.avatar_version, 'background', p.background, 'background_version', p.background_version,
    'cash', w.cash, 'bank', w.bank, 'btc', w.btc, 'btc_rate', public._setting('btc_rate'),
    'assets', a,
    'assets_value', (a->>'realty')::numeric + (a->>'cars')::numeric + (a->>'business')::numeric + (a->>'luxury')::numeric,
    'debts', 0,
    'total_capital', public._capital(uid),
    'income_today', (select coalesce(sum(amount), 0) from public.ledger_entries
                      where user_id = uid and direction = 'credit' and account <> 'btc' and created_at >= date_trunc('day', now())
                        and op_type not in ('bank_deposit','bank_withdraw','deposit_close','btc_sell')),
    'spent_today',  (select coalesce(sum(amount), 0) from public.ledger_entries
                      where user_id = uid and direction = 'debit' and account <> 'btc' and created_at >= date_trunc('day', now())
                        and op_type not in ('bank_deposit','bank_withdraw','deposit_open','btc_buy')),
    'games_played', (select count(*) from public.game_rounds where user_id = uid),
    'shifts_done',  (select count(*) from public.work_shifts where user_id = uid),
    'cars_owned',   (select count(*) from public.user_cars where user_id = uid));
end $$;

-- Moderation: clear avatar / background / bio of a player.
create or replace function public.admin_clear_profile_media(p_user uuid, p_what text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public._require_admin(array['owner','admin','moderator']);
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_what = 'avatar' then
    update public.profiles set avatar_version = null where id = p_user;
    delete from storage.objects where bucket_id = 'profile-media' and name = p_user::text || '/avatar';
  elsif p_what = 'background' then
    update public.profiles set background_version = null, background = 'default' where id = p_user;
    delete from storage.objects where bucket_id = 'profile-media' and name = p_user::text || '/background';
  elsif p_what = 'bio' then
    update public.profiles set bio = '' where id = p_user;
  else
    raise exception 'invalid_choice';
  end if;
  if not found then raise exception 'target_not_found'; end if;
  insert into public.audit_logs (actor_id, action, target_type, target_id, payload)
  values (v_actor, 'profile_media_clear', 'profile', p_user::text, jsonb_build_object('what', p_what, 'reason', trim(p_reason)));
  return jsonb_build_object('status','ok');
end $$;

revoke all on function public.update_profile_appearance(text, text), public.set_profile_media(text, boolean),
                       public.public_profile(text), public.leaderboard_capital(integer), public.get_my_snapshot(),
                       public.admin_clear_profile_media(uuid, text, text) from public, anon;
grant execute on function public.update_profile_appearance(text, text)      to authenticated;
grant execute on function public.set_profile_media(text, boolean)           to authenticated;
grant execute on function public.public_profile(text)                       to authenticated;
grant execute on function public.leaderboard_capital(integer)               to authenticated;
grant execute on function public.get_my_snapshot()                          to authenticated;
grant execute on function public.admin_clear_profile_media(uuid, text, text) to authenticated;
