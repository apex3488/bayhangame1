-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0008: cosmetics (BAYHAN STORE).
-- Catalog, prices, rarities, mystery boxes and collections copied from
-- bot/services/cosmetics_catalog.py; rules from bot/services/cosmetics.py.
-- Name colors are left out: the bot itself disabled them.
-- ============================================================================

create table public.cosmetic_items (
  code         text primary key,
  category     text not null check (category in ('frame','badge','theme','name_style','title','effect','box')),
  icon         text not null,
  rarity       text not null check (rarity in ('common','rare','epic','legendary','mythic','limited')),
  price        numeric(18,2) not null check (price >= 0),
  purchasable  boolean not null default true,
  enabled      boolean not null default true,
  limited_qty  integer check (limited_qty is null or limited_qty > 0),
  sold_count   integer not null default 0 check (sold_count >= 0),
  featured     boolean not null default false,
  style        jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 100,
  check (limited_qty is null or sold_count <= limited_qty)
);

insert into public.cosmetic_items (code, category, icon, rarity, price, purchasable, featured, limited_qty, style, sort_order) values
  -- frames
  ('frame_cyber','frame','🖼','common',5000,true,false,null,'{"from":"#00e5ff","to":"#2f7bff"}',10),
  ('frame_neon','frame','🖼','rare',25000,true,true,null,'{"from":"#39ff14","to":"#00e5ff"}',20),
  ('frame_diamond','frame','💎','epic',50000,true,true,null,'{"from":"#b9f2ff","to":"#5aa2ff"}',30),
  ('frame_fire','frame','🔥','epic',45000,true,false,null,'{"from":"#ff4d00","to":"#ffc94d"}',40),
  ('frame_ice','frame','❄️','rare',20000,true,false,null,'{"from":"#e0f7ff","to":"#7dd3fc"}',50),
  ('frame_gold','frame','🥇','legendary',150000,true,true,null,'{"from":"#ffe08a","to":"#d4a017"}',60),
  ('frame_galaxy','frame','🌌','legendary',175000,true,false,null,'{"from":"#7a3cff","to":"#ff3d71"}',70),
  ('frame_matrix','frame','🟩','epic',60000,true,false,null,'{"from":"#00ff41","to":"#003b00"}',80),
  ('frame_bayhan_elite','frame','👑','mythic',500000,true,true,null,'{"from":"#2f7bff","to":"#ffffff"}',90),
  ('frame_black','frame','⬛','legendary',200000,true,false,null,'{"from":"#111111","to":"#4b5563"}',100),
  ('frame_animated','frame','✨','mythic',750000,true,false,null,'{"from":"#ff3d71","to":"#2f7bff","animated":true}',110),
  ('frame_limited','frame','🔒','limited',1000000,true,true,100,'{"from":"#ffc94d","to":"#ff3d71","animated":true}',120),
  -- badges
  ('badge_og','badge','🏅','mythic',0,false,false,null,'{}',10),
  ('badge_millionaire','badge','💰','epic',100000,true,true,null,'{}',20),
  ('badge_high_roller','badge','🎰','rare',40000,true,false,null,'{}',30),
  ('badge_founder','badge','🏛','mythic',0,false,false,null,'{}',40),
  ('badge_collector','badge','🎒','epic',80000,true,false,null,'{}',50),
  ('badge_legend','badge','🌟','legendary',250000,true,false,null,'{}',60),
  ('badge_top10','badge','🔟','legendary',0,false,false,null,'{}',70),
  ('badge_top100','badge','💯','epic',0,false,false,null,'{}',80),
  ('badge_event_winner','badge','🏆','limited',0,false,false,null,'{}',90),
  ('badge_season','badge','📅','mythic',0,false,false,null,'{}',100),
  ('badge_cyber_master','badge','⚡','legendary',0,false,false,null,'{}',110),
  ('badge_space_explorer','badge','🚀','legendary',0,false,false,null,'{}',120),
  -- themes (accent colours of the interface)
  ('theme_cyberpunk','theme','🎨','rare',30000,true,false,null,'{"accent":"#ff2bd6","accent2":"#00e5ff"}',10),
  ('theme_space','theme','🪐','epic',55000,true,false,null,'{"accent":"#7a3cff","accent2":"#a78bfa"}',20),
  ('theme_luxury','theme','🥂','legendary',120000,true,true,null,'{"accent":"#d4a017","accent2":"#ffe08a"}',30),
  ('theme_dark','theme','🌑','common',8000,true,false,null,'{"accent":"#64748b","accent2":"#94a3b8"}',40),
  ('theme_neon','theme','💚','rare',28000,true,false,null,'{"accent":"#22c55e","accent2":"#86efac"}',50),
  ('theme_matrix','theme','💻','epic',50000,true,false,null,'{"accent":"#00c853","accent2":"#69f0ae"}',60),
  ('theme_gold','theme','🟨','legendary',140000,true,false,null,'{"accent":"#f59e0b","accent2":"#fcd34d"}',70),
  ('theme_bayhan_black','theme','🖤','mythic',400000,true,true,null,'{"accent":"#e5e7eb","accent2":"#ffffff"}',80),
  -- name styles
  ('ns_diamond','name_style','◆','rare',15000,true,false,null,'{"wrap":"◆ {name} ◆"}',10),
  ('ns_brackets','name_style','『','common',5000,true,false,null,'{"wrap":"『{name}』"}',20),
  ('ns_bayhan','name_style','🔷','epic',35000,true,false,null,'{"wrap":"BAYHAN · {name}"}',30),
  -- titles
  ('title_newbie','title','👑','common',1000,true,false,null,'{}',10),
  ('title_trader','title','👑','common',5000,true,false,null,'{}',20),
  ('title_high_roller','title','👑','rare',25000,true,false,null,'{}',30),
  ('title_investor','title','👑','rare',30000,true,false,null,'{}',40),
  ('title_champion','title','👑','epic',70000,true,false,null,'{}',50),
  ('title_legend','title','👑','legendary',200000,true,false,null,'{}',60),
  ('title_billionaire','title','👑','mythic',1000000,true,true,null,'{}',70),
  ('title_bayhan_elite','title','👑','mythic',800000,true,false,null,'{}',80),
  ('title_millionaire','title','👑','epic',100000,true,false,null,'{}',90),
  ('title_cyber_master','title','👑','legendary',0,false,false,null,'{}',100),
  ('title_luxury_king','title','👑','legendary',0,false,false,null,'{}',110),
  -- effects
  ('fx_electric','effect','⚡','rare',22000,true,false,null,'{"glow":"#00e5ff"}',10),
  ('fx_fire','effect','🔥','rare',22000,true,false,null,'{"glow":"#ff4d00"}',20),
  ('fx_ice','effect','❄️','rare',22000,true,false,null,'{"glow":"#7dd3fc"}',30),
  ('fx_spark','effect','✨','common',8000,true,false,null,'{"glow":"#ffc94d"}',40),
  ('fx_galaxy','effect','🌌','epic',55000,true,false,null,'{"glow":"#a78bfa"}',50),
  ('fx_diamond','effect','💎','legendary',120000,true,true,null,'{"glow":"#b9f2ff"}',60),
  -- mystery boxes
  ('box_common','box','🎁','common',10000,true,true,null,'{}',10),
  ('box_epic','box','🎁','epic',25000,true,true,null,'{}',20),
  ('box_legendary','box','🎁','legendary',100000,true,true,null,'{}',30);

create table public.box_rewards (
  box_code    text not null references public.cosmetic_items(code),
  reward_code text not null references public.cosmetic_items(code),
  weight      integer not null check (weight > 0),
  primary key (box_code, reward_code)
);
insert into public.box_rewards values
  ('box_common','frame_cyber',40), ('box_common','theme_dark',30), ('box_common','ns_brackets',15),
  ('box_common','frame_neon',10), ('box_common','fx_spark',5),
  ('box_epic','frame_ice',25), ('box_epic','badge_high_roller',20), ('box_epic','frame_diamond',20),
  ('box_epic','theme_matrix',15), ('box_epic','fx_galaxy',10), ('box_epic','frame_gold',10),
  ('box_legendary','frame_matrix',25), ('box_legendary','title_champion',20), ('box_legendary','frame_galaxy',20),
  ('box_legendary','fx_diamond',15), ('box_legendary','frame_bayhan_elite',12), ('box_legendary','theme_bayhan_black',8);

create table public.cosmetic_collections (
  code        text primary key,
  reward_code text not null references public.cosmetic_items(code),
  sort_order  integer not null default 100
);
create table public.cosmetic_collection_items (
  collection_code text not null references public.cosmetic_collections(code),
  item_code       text not null references public.cosmetic_items(code),
  primary key (collection_code, item_code)
);
insert into public.cosmetic_collections values ('col_cyber','title_cyber_master',10), ('col_space','badge_space_explorer',20), ('col_luxury','title_luxury_king',30);
insert into public.cosmetic_collection_items values
  ('col_cyber','frame_cyber'), ('col_cyber','theme_cyberpunk'), ('col_cyber','ns_bayhan'), ('col_cyber','fx_electric'),
  ('col_space','frame_galaxy'), ('col_space','theme_space'), ('col_space','ns_diamond'), ('col_space','fx_galaxy'),
  ('col_luxury','frame_gold'), ('col_luxury','theme_luxury'), ('col_luxury','ns_brackets'), ('col_luxury','title_billionaire');

create table public.user_cosmetics (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  code        text not null references public.cosmetic_items(code),
  source      text not null check (source in ('purchase','box','collection','admin')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table public.user_loadout (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot    text not null check (slot in ('frame','badge','theme','name_style','title','effect')),
  code    text not null references public.cosmetic_items(code),
  primary key (user_id, slot)
);

create table public.user_collections (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  collection_code text not null references public.cosmetic_collections(code),
  completed_at    timestamptz not null default now(),
  primary key (user_id, collection_code)
);

-- Grants an item and awards any collection it completes (collection rewards can chain).
create or replace function public._grant_cosmetic(p_user uuid, p_code text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  insert into public.user_cosmetics (user_id, code, source) values (p_user, p_code, p_source) on conflict do nothing;
  for c in
    select col.code, col.reward_code from public.cosmetic_collections col
     where not exists (select 1 from public.user_collections uc where uc.user_id = p_user and uc.collection_code = col.code)
       and not exists (select 1 from public.cosmetic_collection_items ci
                        where ci.collection_code = col.code
                          and not exists (select 1 from public.user_cosmetics uc2 where uc2.user_id = p_user and uc2.code = ci.item_code))
  loop
    insert into public.user_collections (user_id, collection_code) values (p_user, c.code);
    perform public._grant_cosmetic(p_user, c.reward_code, 'collection');
  end loop;
end $$;

create or replace function public.cosmetic_buy(p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'cosmetic:' || p_idempotency_key; it public.cosmetic_items;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  select * into it from public.cosmetic_items where code = p_code and enabled for update;
  if not found or it.category = 'box' then raise exception 'not_found'; end if;
  if not it.purchasable then raise exception 'not_purchasable'; end if;
  if exists (select 1 from public.user_cosmetics where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
  if it.limited_qty is not null and it.sold_count >= it.limited_qty then raise exception 'out_of_stock'; end if;
  if it.price > 0 then
    perform public._apply_wallet_change(uid, 'cash', -it.price, 'cosmetic_buy', 'BAYHAN STORE: ' || p_code, v_key, null, 'cosmetic', p_code);
  end if;
  update public.cosmetic_items set sold_count = sold_count + 1 where code = p_code;
  perform public._grant_cosmetic(uid, p_code, 'purchase');
  insert into public.purchases (user_id, item_code, kind, quantity, total) values (uid, p_code, 'cosmetic', 1, it.price);
  return jsonb_build_object('status','ok','price',it.price);
end $$;

-- Opens a box: weighted pick among rewards the player does not own yet. No charge when all are owned (as in the bot).
create or replace function public.open_box(p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'box:' || p_idempotency_key; it public.cosmetic_items; v_reward text;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  select * into it from public.cosmetic_items where code = p_code and category = 'box' and enabled;
  if not found then raise exception 'not_found'; end if;
  select public._weighted_pick(jsonb_agg(jsonb_build_object('v', b.reward_code, 'w', b.weight))) #>> '{}' into v_reward
    from public.box_rewards b
   where b.box_code = p_code and not exists (select 1 from public.user_cosmetics u where u.user_id = uid and u.code = b.reward_code);
  if v_reward is null then raise exception 'box_all_owned'; end if;
  perform public._apply_wallet_change(uid, 'cash', -it.price, 'cosmetic_box', 'Бокс: ' || p_code, v_key, null, 'cosmetic', p_code);
  perform public._grant_cosmetic(uid, v_reward, 'box');
  insert into public.purchases (user_id, item_code, kind, quantity, total) values (uid, p_code, 'box', 1, it.price);
  return jsonb_build_object('status','ok','reward', (select to_jsonb(c) from public.cosmetic_items c where c.code = v_reward));
end $$;

create or replace function public.cosmetic_equip(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_cat text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select i.category into v_cat from public.user_cosmetics u join public.cosmetic_items i using (code) where u.user_id = uid and u.code = p_code;
  if v_cat is null then raise exception 'not_owned'; end if;
  if v_cat = 'box' then raise exception 'invalid_choice'; end if;
  insert into public.user_loadout (user_id, slot, code) values (uid, v_cat, p_code)
  on conflict (user_id, slot) do update set code = excluded.code;
  return jsonb_build_object('status','ok','slot',v_cat);
end $$;

create or replace function public.cosmetic_unequip(p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.user_loadout where user_id = auth.uid() and slot = p_slot;
  return jsonb_build_object('status','ok');
end $$;

-- Equipped items of any player (public profile decoration).
create or replace function public.loadout_of(p_user uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(l.slot, jsonb_build_object('code', i.code, 'icon', i.icon, 'rarity', i.rarity, 'style', i.style)), '{}'::jsonb)
    from public.user_loadout l join public.cosmetic_items i using (code)
   where l.user_id = coalesce(p_user, auth.uid());
$$;

alter table public.cosmetic_items            enable row level security;
alter table public.box_rewards               enable row level security;
alter table public.cosmetic_collections      enable row level security;
alter table public.cosmetic_collection_items enable row level security;
alter table public.user_cosmetics            enable row level security;
alter table public.user_loadout              enable row level security;
alter table public.user_collections          enable row level security;
create policy read_all on public.cosmetic_items            for select to authenticated using (enabled);
create policy read_all on public.box_rewards               for select to authenticated using (true);
create policy read_all on public.cosmetic_collections      for select to authenticated using (true);
create policy read_all on public.cosmetic_collection_items for select to authenticated using (true);
create policy read_own on public.user_cosmetics   for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_loadout     for select to authenticated using (user_id = auth.uid());
create policy read_own on public.user_collections for select to authenticated using (user_id = auth.uid());

revoke all on function public._grant_cosmetic(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cosmetic_buy(text, text)   to authenticated;
grant execute on function public.open_box(text, text)       to authenticated;
grant execute on function public.cosmetic_equip(text)       to authenticated;
grant execute on function public.cosmetic_unequip(text)     to authenticated;
grant execute on function public.loadout_of(uuid)           to authenticated;
revoke all on function public.cosmetic_buy(text, text), public.open_box(text, text), public.cosmetic_equip(text),
              public.cosmetic_unequip(text), public.loadout_of(uuid) from public, anon;
