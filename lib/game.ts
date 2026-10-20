import { getSupabase } from "./supabase";

export interface Snapshot {
  user_id: string;
  bio: string;
  avatar_version: number | null;
  background: string;
  background_version: number | null;
  game_name: string;
  public_id: number;
  status: "active" | "restricted" | "blocked";
  xp: number;
  level: number;
  xp_per_level: number;
  cash: number;
  bank: number;
  btc: number;
  btc_rate: number;
  assets: { realty: number; cars: number; business: number; deposits: number; btc_usd: number };
  cars_owned: number;
  assets_value: number;
  debts: number;
  total_capital: number;
  income_today: number;
  spent_today: number;
  games_played: number;
  shifts_done: number;
}

export interface MyJob {
  key: string;
  income_min: number;
  income_max: number;
  cooldown_seconds: number;
  xp_reward: number;
  require_car: boolean;
  min_capital: number;
  next_available_at: string | null;
  eligible: boolean;
  blocker: "need_car" | "need_capital" | null;
}

export interface LedgerRow {
  id: number;
  op_type: string;
  direction: "credit" | "debit";
  account: "cash" | "bank" | "btc";
  amount: number;
  balance_after: number;
  reason: string;
  created_at: string;
}

export interface LeaderRow {
  rank: number;
  game_name: string;
  level: number;
  total_capital: number;
  user_id: string;
  avatar_version: number | null;
}

export interface DailyStatus {
  can_claim: boolean;
  streak: number;
  reward: number;
  next_at: string;
}

export type GameId =
  | "casino"
  | "spin"
  | "slots"
  | "dice"
  | "updown"
  | "trade"
  | "basketball"
  | "darts"
  | "bowling"
  | "mines"
  | "crash";

export interface GameSettings {
  game: GameId;
  enabled: boolean;
  min_bet: number;
  max_bet: number;
  config: Record<string, unknown>;
}

export interface RoundResult<R = Record<string, unknown>> {
  status: "ok" | "duplicate";
  round_id: string;
  game: GameId;
  bet: number;
  multiplier: number;
  payout: number;
  result: R;
}

export interface MinesState {
  round_id: string;
  status: "active" | "settled";
  bet: number;
  mines: number;
  opened: number[];
  current_multiplier: number;
  next_multiplier: number | null;
  cashout_value: number;
  payout: number;
  outcome: "lost" | "cashed_out" | null;
  /** Cell that exploded, for lost rounds. */
  hit: number | null;
  mine_positions: number[] | null;
}

export interface GameRoundRow {
  id: string;
  game: GameId;
  bet: number;
  multiplier: number;
  payout: number;
  created_at: string;
}

/** Each user action gets a fresh key; a retry of the same attempt reuses it. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchSnapshot = () => rpc<Snapshot>("get_my_snapshot");
export const fetchMyJobs = () => rpc<MyJob[]>("my_jobs");
export const fetchLeaderboard = (limit = 50) => rpc<LeaderRow[]>("leaderboard_capital", { p_limit: limit });
export const fetchDailyStatus = () => rpc<DailyStatus>("daily_status");
export const fetchBalanceHistory = (limit = 40) =>
  rpc<{ at: string; balance: number }[]>("my_balance_history", { p_limit: limit });

export const claimDaily = (key: string) =>
  rpc<{ status: string; reward?: number; streak?: number }>("claim_daily", { p_idempotency_key: key });

export const workShift = (job: string, key: string) =>
  rpc<{ status: string; salary: number; xp: number; next_at?: string }>("work_shift", {
    p_job: job,
    p_idempotency_key: key,
  });

export const transferFunds = (toGameName: string, amount: number, key: string) =>
  rpc<{ status: string; fee?: number }>("transfer_funds", {
    p_to_game_name: toGameName,
    p_amount: amount,
    p_idempotency_key: key,
  });

export const playGame = <R>(game: GameId, bet: number, choice: Record<string, unknown>, key: string) =>
  rpc<RoundResult<R>>("play_game", { p_game: game, p_bet: bet, p_choice: choice, p_idempotency_key: key });

export const minesStart = (bet: number, mines: number, key: string) =>
  rpc<MinesState>("mines_start", { p_bet: bet, p_mines: mines, p_idempotency_key: key });
export const minesOpen = (round: string, cell: number) => rpc<MinesState>("mines_open", { p_round: round, p_cell: cell });
export const minesCashout = (round: string) => rpc<MinesState>("mines_cashout", { p_round: round });
export const minesActive = () => rpc<MinesState | null>("mines_active");
export interface CrashState {
  round_id: string;
  status: "active" | "settled";
  bet: number;
  auto: number | null;
  started_at: string;
  server_now: string;
  k: number;
  multiplier: number;
  payout: number;
  outcome: "cashed_out" | "auto_cashout" | "crashed" | null;
  crash: number | null;
}
export const crashStart = (bet: number, auto: number | null, key: string) =>
  rpc<CrashState>("crash_start", { p_bet: bet, p_auto: auto, p_idempotency_key: key });
export const crashState = (round: string) => rpc<CrashState>("crash_state", { p_round: round });
export const crashCashout = (round: string) => rpc<CrashState>("crash_cashout", { p_round: round });
export const crashActive = () => rpc<CrashState | null>("crash_active");
export const crashHistory = () => rpc<{ crash: number; outcome: string; created_at: string }[]>("crash_history", { p_limit: 20 });
export const crashReveal = (round: string, code: string) =>
  rpc<{ status: "ok" | "wrong_code"; crash?: number; attempts_left?: number }>("crash_reveal", { p_round: round, p_code: code });

/** Secret code: reveals mine positions of the active round (checked and rate-limited on the server). */
export const minesReveal = (round: string, code: string) =>
  rpc<{ status: "ok" | "wrong_code"; mine_positions?: number[]; attempts_left?: number }>("mines_reveal", { p_round: round, p_code: code });

export const registrationCheck = (login: string, gameName: string) =>
  rpc<{ login_taken: boolean; name_taken: boolean }>("registration_check", { p_login: login, p_game_name: gameName });

export async function fetchRecentLedger(limit = 10): Promise<LedgerRow[]> {
  const { data, error } = await getSupabase()
    .from("ledger_entries")
    .select("id, op_type, direction, account, amount, balance_after, reason, created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LedgerRow[];
}

export async function fetchGameSettings(game: GameId): Promise<GameSettings> {
  const { data, error } = await getSupabase().from("game_settings").select("*").eq("game", game).single();
  if (error) throw new Error(error.message);
  return data as GameSettings;
}

export async function fetchGameHistory(game: GameId, limit = 12): Promise<GameRoundRow[]> {
  const { data, error } = await getSupabase()
    .from("game_rounds")
    .select("id, game, bet, multiplier, payout, created_at")
    .eq("game", game)
    .eq("status", "settled")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as GameRoundRow[];
}

const KNOWN_ERRORS = [
  "player_not_found", // before "not_found": codes are matched as substrings
  "insufficient_funds",
  "cooldown_active",
  "level_too_low",
  "need_capital",
  "need_car",
  "job_not_found",
  "recipient_not_found",
  "self_transfer",
  "transfer_limit_exceeded",
  "invalid_amount",
  "invalid_bet",
  "invalid_choice",
  "game_disabled",
  "round_already_active",
  "nothing_to_cashout",
  "daily_already_claimed",
  "account_restricted",
  "not_authenticated",
  "invalid_idempotency_key",
  "insufficient_resources",
  "insufficient_treasury",
  "not_matured",
  "already_claimed",
  "already_owned",
  "not_owned",
  "max_level",
  "max_employees",
  "out_of_stock",
  "not_purchasable",
  "box_all_owned",
  "not_completed",
  "promo_not_found",
  "promo_inactive",
  "promo_expired",
  "promo_limit_reached",
  "promo_already_used",
  "name_taken",
  "invalid_game_name",
  "corp_not_member",
  "corp_no_permission",
  "corp_already_member",
  "corp_invalid_name",
  "corp_invite_self",
  "corp_target_in_corp",
  "corp_invite_pending",
  "corp_president_cannot_leave",
  "corp_cannot_change_president",
  "corp_max_role",
  "corp_min_role",
  "already_married",
  "marriage_self",
  "proposal_pending",
  "proposal_closed",
  "not_married",
  "invite_closed",
  "forbidden",
  "reason_required",
  "cannot_target_self",
  "target_not_found",
  "admin_adjust_limit_exceeded",
  "invalid_value",
  "invalid_code",
  "already_exists",
  "unknown_setting",
  "not_found",
  "too_many_attempts",
  "round_not_active",
  "upload_missing",
  "bio_too_long",
  "no_custom_background",
  "image_invalid",
  "image_too_big",
  "invalid_link",
  "invalid_text",
  "invalid_image",
] as const;

/** Maps database errors raised by RAISE EXCEPTION to message keys. */
export function errorKey(message: string): string {
  return KNOWN_ERRORS.find((k) => message.includes(k)) ?? "unknown";
}
