-- Expose the cell that ended a lost mines round, so the UI can highlight the explosion.
create or replace function public.mines_state(p_round uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.game_rounds;
  v_mines integer;
  v_opened integer;
  v_table jsonb;
  v_next numeric;
  v_curr numeric;
begin
  select * into r from public.game_rounds where id = p_round and user_id = auth.uid() and game = 'mines';
  if not found then raise exception 'round_not_found'; end if;
  v_mines := (r.choice ->> 'mines')::integer;
  v_opened := jsonb_array_length(r.result -> 'opened');
  select config -> 'multipliers' -> v_mines::text into v_table from public.game_settings where game = 'mines';
  v_curr := case when v_opened = 0 then 0 else (v_table ->> (v_opened - 1))::numeric end;
  v_next := (v_table ->> v_opened)::numeric;
  return jsonb_build_object(
    'round_id', r.id, 'status', r.status, 'bet', r.bet, 'mines', v_mines,
    'opened', r.result -> 'opened', 'current_multiplier', v_curr, 'next_multiplier', v_next,
    'cashout_value', round(r.bet * v_curr, 2), 'payout', r.payout, 'outcome', r.result ->> 'outcome',
    'hit', (r.result ->> 'hit')::integer,
    'mine_positions', case when r.status = 'settled'
                           then (select secret -> 'mines' from public.game_round_secrets where round_id = r.id)
                           else null end);
end;
$$;

revoke all on function public.mines_state(uuid) from public, anon;
grant execute on function public.mines_state(uuid) to authenticated;
