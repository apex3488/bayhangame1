-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0016: a long road to billions.
--  * real car brands (existing codes keep their place; names live in the UI)
--  * luxury collectibles (yachts, jets, watches, art, space) counted in capital
--  * billion-dollar real estate and businesses
--  * billion-dollar cosmetics and capital achievements
-- Prices are virtual game currency.
-- ============================================================================

-- ------------------------------------------------------------------ cars ----
insert into public.car_items (code, category, price, power, max_speed, active, sort_order) values
  ('amg_g63',            'suv',       180000,  585, 240, true, 7),
  ('porsche_911',        'sport',     230000,  640, 330, true, 8),
  ('bentley_continental','luxury',    310000,  650, 335, true, 9),
  ('mclaren_750s',       'super',     330000,  750, 332, true, 10),
  ('rolls_phantom',      'luxury',    460000,  563, 250, true, 11),
  ('ferrari_sf90',       'super',     520000, 1000, 340, true, 12),
  ('lambo_revuelto',     'super',     610000, 1015, 350, true, 13),
  ('koenigsegg_jesko',   'hyper',    3000000, 1600, 480, true, 14),
  ('pagani_utopia',      'hyper',    3300000,  864, 350, true, 15),
  ('bugatti_noire',      'hyper',   18700000, 1500, 420, true, 16),
  ('rolls_boat_tail',    'luxury',  28000000,  563, 250, true, 17)
on conflict (code) do nothing;
update public.car_items set sort_order = case code
  when 'sedan' then 1 when 'sport_coupe' then 2 when 'luxury_sedan' then 3 when 'amg_g63' then 4 when 'porsche_911' then 5
  when 'bentley_continental' then 6 when 'mclaren_750s' then 7 when 'rolls_phantom' then 8 when 'suv_lux' then 9
  when 'ferrari_sf90' then 10 when 'lambo_revuelto' then 11 when 'supercar' then 12 when 'hypercar' then 13
  when 'koenigsegg_jesko' then 14 when 'pagani_utopia' then 15 when 'bugatti_noire' then 16 when 'rolls_boat_tail' then 17 else sort_order end;

-- ----------------------------------------------------- realty / business ----
insert into public.realty_items (code, category, price, income_per_hour, max_level, upgrade_cost_base, active, sort_order) values
  ('skyscraper',    'tower',      500000000,   4000000, 5,  100000000, true, 8),
  ('resort_island', 'island',    2000000000,  14000000, 5,  400000000, true, 9),
  ('mega_tower',    'tower',     8000000000,  48000000, 5, 1600000000, true, 10)
on conflict (code) do nothing;

insert into public.business_items (code, category, price, income_per_hour, expense_per_hour, max_level, upgrade_cost_base, active, sort_order) values
  ('tech_company',  'tech',      1000000000,   9000000,   1500000, 5,  200000000, true, 7),
  ('bank',          'finance',   5000000000,  40000000,   8000000, 5, 1000000000, true, 8),
  ('oil_company',   'energy',   12000000000,  90000000,  18000000, 5, 2400000000, true, 9),
  ('space_company', 'space',    40000000000, 280000000,  60000000, 5, 8000000000, true, 10)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- luxury ----
create table public.luxury_items (
  code       text primary key,
  category   text not null check (category in ('watch','jewelry','art','jet','yacht','space')),
  price      numeric(18,2) not null check (price > 0),
  rarity     text not null check (rarity in ('common','rare','epic','legendary','mythic')),
  active     boolean not null default true,
  sort_order integer not null default 100
);
insert into public.luxury_items values
  ('rolex_daytona',       'watch',          50000, 'rare',       true, 1),
  ('ap_royal_oak',        'watch',         150000, 'epic',       true, 2),
  ('azimut_grande',       'yacht',        8000000, 'rare',       true, 3),
  ('banksy_balloon',      'art',         25000000, 'epic',       true, 4),
  ('patek_grandmaster',   'watch',       31000000, 'legendary',  true, 5),
  ('pink_star',           'jewelry',     71000000, 'legendary',  true, 6),
  ('gulfstream_g700',     'jet',         78000000, 'epic',       true, 7),
  ('basquiat_skull',      'art',        110000000, 'legendary',  true, 8),
  ('boeing_bbj',          'jet',        400000000, 'legendary',  true, 9),
  ('salvator_mundi',      'art',        450000000, 'mythic',     true, 10),
  ('lurssen_azzam',       'yacht',      600000000, 'legendary',  true, 11),
  ('history_supreme',     'yacht',     4800000000, 'mythic',     true, 12),
  ('space_station',       'space',    20000000000, 'mythic',     true, 13),
  ('moon_base',           'space',   100000000000, 'mythic',     true, 14);

create table public.user_luxury (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code       text not null references public.luxury_items(code),
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);
alter table public.luxury_items enable row level security;
alter table public.user_luxury enable row level security;
create policy read_all on public.luxury_items for select to authenticated using (active);
create policy read_own on public.user_luxury for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------- buy / sell + luxury ----
create or replace function public.asset_buy(p_kind text, p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'assetbuy:' || p_idempotency_key; v_price numeric;
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_kind = 'realty' then
    select price into v_price from public.realty_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_realty where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_realty (user_id, code) values (uid, p_code);
  elsif p_kind = 'car' then
    select price into v_price from public.car_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_cars where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_cars (user_id, code) values (uid, p_code);
  elsif p_kind = 'business' then
    select price into v_price from public.business_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_businesses where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_businesses (user_id, code) values (uid, p_code);
  elsif p_kind = 'luxury' then
    select price into v_price from public.luxury_items where code = p_code and active;
    if v_price is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.user_luxury where user_id = uid and code = p_code) then raise exception 'already_owned'; end if;
    insert into public.user_luxury (user_id, code) values (uid, p_code);
  else
    raise exception 'invalid_choice';
  end if;
  perform public._apply_wallet_change(uid, 'cash', -v_price, p_kind || '_buy', 'Покупка: ' || p_code, v_key, null, p_kind, p_code);
  insert into public.purchases (user_id, item_code, kind, quantity, total) values (uid, p_code, p_kind, 1, v_price);
  return jsonb_build_object('status','ok','price',v_price);
end $$;

create or replace function public.asset_sell(p_kind text, p_code text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_key text := 'assetsell:' || p_idempotency_key; v_value numeric; v_proceeds numeric(18,2);
begin
  if public._begin_action(uid, v_key, p_idempotency_key) then return jsonb_build_object('status','duplicate'); end if;
  if p_kind in ('realty','business') then perform public._collect_one(uid, p_kind, p_code); end if;
  if p_kind = 'realty' then
    select public._market_value(i.price, u.level) into v_value from public.user_realty u join public.realty_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_realty where user_id = uid and code = p_code;
  elsif p_kind = 'car' then
    select public._market_value(i.price, u.level) into v_value from public.user_cars u join public.car_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_cars where user_id = uid and code = p_code;
  elsif p_kind = 'business' then
    select public._market_value(i.price, u.level) into v_value from public.user_businesses u join public.business_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_businesses where user_id = uid and code = p_code;
  elsif p_kind = 'luxury' then
    select i.price into v_value from public.user_luxury u join public.luxury_items i using (code) where u.user_id = uid and u.code = p_code;
    delete from public.user_luxury where user_id = uid and code = p_code;
  else
    raise exception 'invalid_choice';
  end if;
  if v_value is null then raise exception 'not_owned'; end if;
  v_proceeds := round(v_value * public._setting('asset_sell_ratio'), 2);
  perform public._apply_wallet_change(uid, 'cash', v_proceeds, p_kind || '_sell', 'Продажа: ' || p_code, v_key, null, p_kind, p_code);
  return jsonb_build_object('status','ok','proceeds',v_proceeds);
end $$;

-- ------------------------------------------------- capital with luxury ----
create or replace function public._assets(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'realty',   coalesce((select sum(public._market_value(i.price, u.level)) from public.user_realty u join public.realty_items i using (code) where u.user_id = p_user), 0),
    'cars',     coalesce((select sum(public._market_value(i.price, u.level)) from public.user_cars u join public.car_items i using (code) where u.user_id = p_user), 0),
    'business', coalesce((select sum(public._market_value(i.price, u.level)) from public.user_businesses u join public.business_items i using (code) where u.user_id = p_user), 0),
    'luxury',   coalesce((select sum(i.price) from public.user_luxury u join public.luxury_items i using (code) where u.user_id = p_user), 0),
    'deposits', coalesce((select sum(amount) from public.bank_deposits where user_id = p_user and not claimed), 0),
    'btc_usd',  coalesce((select round(btc * public._setting('btc_rate'), 2) from public.wallets where user_id = p_user), 0));
$$;

create or replace function public._capital(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select cash + bank from public.wallets where user_id = p_user), 0)
       + (a ->> 'realty')::numeric + (a ->> 'cars')::numeric + (a ->> 'business')::numeric + (a ->> 'luxury')::numeric
       + (a ->> 'deposits')::numeric + (a ->> 'btc_usd')::numeric
    from (select public._assets(p_user) a) t;
$$;

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
    'game_name', p.game_name, 'public_id', p.public_id, 'status', p.status,
    'xp', p.xp, 'level', p.level, 'xp_per_level', public._setting('xp_per_level'),
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

-- -------------------------------------------------- billion cosmetics ----
insert into public.cosmetic_items (code, category, icon, rarity, price, purchasable, featured, limited_qty, style, sort_order) values
  ('frame_billionaire',  'frame',      '💰', 'mythic',     1000000000, true, true, null, '{"from":"#ffd700","to":"#fff6c2","animated":true}', 130),
  ('frame_cosmos',       'frame',      '🌠', 'mythic',     5000000000, true, true, null, '{"from":"#7a3cff","to":"#00e5ff","animated":true}', 140),
  ('frame_sovereign',    'frame',      '💠', 'limited',   25000000000, true, true, 10,   '{"from":"#ffffff","to":"#2f7bff","animated":true}', 150),
  ('badge_crown',        'badge',      '👑', 'mythic',     3000000000, true, true, null, '{}', 130),
  ('theme_platinum',     'theme',      '🤍', 'mythic',     1500000000, true, true, null, '{"accent":"#c9d6e3","accent2":"#b9f2ff"}', 90),
  ('ns_imperial',        'name_style', '♛',  'mythic',     1200000000, true, true, null, '{"wrap":"♛ {name} ♛"}', 40),
  ('title_oligarch',     'title',      '👑', 'mythic',     2000000000, true, true, null, '{}', 120),
  ('title_emperor',      'title',      '👑', 'mythic',    10000000000, true, true, null, '{}', 130),
  ('fx_aurora',          'effect',     '🌌', 'mythic',     2500000000, true, true, null, '{"glow":"#7dffb2"}', 70)
on conflict (code) do nothing;

insert into public.achievements (code, condition_type, condition_value, reward_usd, sort_order) values
  ('billionaire',      'capital',   1000000000,  10000000, 9),
  ('centibillionaire', 'capital', 100000000000, 500000000, 10)
on conflict (code) do nothing;

revoke all on function public.asset_buy(text, text, text), public.asset_sell(text, text, text), public.get_my_snapshot() from public, anon;
revoke all on function public._assets(uuid), public._capital(uuid) from public, anon, authenticated;
grant execute on function public.asset_buy(text, text, text)  to authenticated;
grant execute on function public.asset_sell(text, text, text) to authenticated;
grant execute on function public.get_my_snapshot()            to authenticated;
