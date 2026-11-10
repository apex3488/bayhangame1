-- 0026: tg_duel_accept / tg_party_reward passed NULL as the ledger group id, which the ledger
-- rejects (group_id is NOT NULL; the helper's default generates one). Both legs of a duel now
-- share one generated group id; party rewards use the default.

create or replace function public.tg_duel_accept(p_id uuid, p_tg bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.tg_duels; b uuid := public.tg_user(p_tg); w uuid; l uuid; v_name_a text; v_name_b text; v_group uuid := gen_random_uuid();
begin
  if b is null then raise exception 'telegram_not_linked'; end if;
  select * into d from public.tg_duels where id = p_id for update;
  if not found or d.status <> 'open' then raise exception 'duel_closed'; end if;
  if d.created_at < now() - interval '10 minutes' then
    update public.tg_duels set status = 'cancelled', settled_at = now() where id = p_id;
    raise exception 'duel_closed';
  end if;
  if b = d.a_user then raise exception 'duel_self'; end if;
  if d.b_user is not null and d.b_user <> b then raise exception 'duel_not_for_you'; end if;
  -- Lock both players in a fixed order so two duels between the same pair cannot deadlock.
  perform 1 from public.profiles where id in (d.a_user, b) order by id for update;
  if exists (select 1 from public.profiles where id in (d.a_user, b) and status <> 'active') then raise exception 'account_restricted'; end if;
  if (select cash from public.wallets where user_id = d.a_user) < d.amount then raise exception 'opponent_insufficient_funds'; end if;
  if (select cash from public.wallets where user_id = b) < d.amount then raise exception 'insufficient_funds'; end if;
  if public._rand() < 0.5 then w := d.a_user; l := b; else w := b; l := d.a_user; end if;
  select game_name into v_name_a from public.profiles where id = w;
  select game_name into v_name_b from public.profiles where id = l;
  perform public._apply_wallet_change(l, 'cash', -d.amount, 'duel_loss', 'Дуэль: проигрыш ' || v_name_a,
    'duel:' || p_id || ':loss', w, 'duel', p_id::text, v_group);
  perform public._apply_wallet_change(w, 'cash', d.amount, 'duel_win', 'Дуэль: победа над ' || v_name_b,
    'duel:' || p_id || ':win', l, 'duel', p_id::text, v_group);
  update public.tg_duels set status = 'done', b_user = b, winner = w, settled_at = now() where id = p_id;
  return jsonb_build_object('status', 'ok', 'amount', d.amount, 'winner', v_name_a, 'loser', v_name_b);
end $$;

create or replace function public.tg_party_reward(p_game uuid, p_tgs bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tg bigint; uid uuid; v_amt numeric := public._setting('party_reward'); v_paid jsonb := '[]'::jsonb; g public.tg_party_games;
begin
  select * into g from public.tg_party_games where id = p_game;
  if not found or g.finished_at is null then raise exception 'not_found'; end if;
  if v_amt <= 0 then return v_paid; end if;
  foreach v_tg in array coalesce(p_tgs, '{}') loop
    uid := public.tg_user(v_tg);
    continue when uid is null;
    perform 1 from public.profiles where id = uid and status = 'active' for update;
    continue when not found;
    continue when (select count(*) from public.ledger_entries where user_id = uid and op_type = 'party_reward'
                     and created_at > now() - interval '24 hours') >= public._setting('party_rewards_per_day');
    continue when exists (select 1 from public.ledger_entries where idempotency_key = 'party:' || p_game || ':' || uid);
    perform public._apply_wallet_change(uid, 'cash', v_amt, 'party_reward', 'Победа в мини-игре: ' || g.kind,
      'party:' || p_game || ':' || uid, null, 'party', p_game::text);
    v_paid := v_paid || to_jsonb(v_tg);
  end loop;
  return jsonb_build_object('amount', v_amt, 'paid', v_paid);
end $$;
