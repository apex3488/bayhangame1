-- ============================================================================
-- BAYHAN GAME 2.0 — migration 0022: live feed of big wins + linter fix.
--
-- big_wins(): recent settled rounds that paid at least 3× the bet. Rounds where a
-- secret reveal code was used are left out — the feed shows honest wins only.
-- ============================================================================

create index if not exists game_rounds_settled_big on public.game_rounds (settled_at desc)
  where status = 'settled' and multiplier >= 3;

create or replace function public.big_wins(p_limit int default 15)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.settled_at desc) from (
      select r.id, r.game, r.bet, r.multiplier, r.payout, r.settled_at,
             p.game_name, p.id as user_id, p.avatar_version
      from public.game_rounds r join public.profiles p on p.id = r.user_id
      where r.status = 'settled' and r.multiplier >= 3 and r.payout > r.bet
        and r.settled_at > now() - interval '7 days'
        and p.status = 'active'
        and not exists (select 1 from public.audit_logs a
                        where a.action in ('mines_secret_reveal', 'crash_secret_reveal') and a.target_id = r.id::text)
      order by r.settled_at desc
      limit least(greatest(coalesce(p_limit, 15), 1), 30)
    ) x), '[]'::jsonb);
end $$;
revoke all on function public.big_wins(int) from public, anon;
grant execute on function public.big_wins(int) to authenticated;

-- Linter: pin search_path of the link validator (it touches no tables).
alter function public._clean_link(text) set search_path = '';
