-- "Earn $X" progress must count income on both USD accounts: before migration 0006
-- salaries, daily rewards and game wins were credited to the bank account.
create or replace function public._stat(p_user uuid, p_kind text)
returns numeric language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'play_games'      then (select count(*)::numeric from public.game_rounds where user_id = p_user and status = 'settled')
    when 'games_played'    then (select count(*)::numeric from public.game_rounds where user_id = p_user and status = 'settled')
    when 'win_games'       then (select count(*)::numeric from public.game_rounds where user_id = p_user and payout > bet)
    when 'games_won'       then (select count(*)::numeric from public.game_rounds where user_id = p_user and payout > bet)
    when 'total_wagered'   then (select coalesce(sum(bet), 0) from public.game_rounds where user_id = p_user and status = 'settled')
    when 'total_won'       then (select coalesce(sum(payout), 0) from public.game_rounds where user_id = p_user)
    when 'mine_resources'  then (select coalesce(sum(total), 0)::numeric from public.mining_log where user_id = p_user)
    when 'invite_refs'     then (select count(*)::numeric from public.profiles where referrer_id = p_user and referral_rewarded)
    when 'referrals_count' then (select count(*)::numeric from public.profiles where referrer_id = p_user and referral_rewarded)
    when 'earn_usd'        then (select coalesce(sum(amount), 0) from public.ledger_entries where user_id = p_user and account in ('cash','bank')
                                   and direction = 'credit'
                                   and op_type in ('salary','daily_reward','game_win','realty_income','business_income','resource_sell','case_reward'))
    when 'capital'         then public._capital(p_user)
  end;
$$;
revoke all on function public._stat(uuid, text) from public, anon, authenticated;
