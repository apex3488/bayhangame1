// Admin panel data layer (migration 0012). Every call is re-checked on the server by role.
import { getSupabase } from "./supabase";

async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type AdminRole = "owner" | "admin" | "moderator" | "operator";

export const can = {
  moderate: (r: AdminRole | null) => r === "owner" || r === "admin" || r === "moderator",
  manage: (r: AdminRole | null) => r === "owner" || r === "admin",
  roles: (r: AdminRole | null) => r === "owner",
};

export interface Dashboard {
  players_total: number;
  players_new_24h: number;
  players_new_7d: number;
  players_active_24h: number;
  players_blocked: number;
  money_cash: number;
  money_bank: number;
  money_btc: number;
  money_deposits: number;
  ops_24h: number;
  transfers_24h: number;
  transfers_count_24h: number;
  rounds_24h: number;
  bets_24h: number;
  payouts_24h: number;
  shifts_24h: number;
  income_issued_24h: number;
  admin_actions_24h: number;
  games: { game: string; rounds: number; bets: number; payouts: number }[];
}

export interface PlayerRow {
  id: string;
  login: string;
  game_name: string;
  public_id: number;
  status: "active" | "restricted" | "blocked";
  level: number;
  cash: number;
  bank: number;
  btc: number;
  capital: number;
  created_at: string;
  last_activity: string | null;
  role: AdminRole | null;
  total: number;
}

export interface PlayerDetail {
  profile: {
    id: string;
    login: string;
    game_name: string;
    public_id: number;
    status: PlayerRow["status"];
    level: number;
    xp: number;
    created_at: string;
    referral_code: string;
    referrer: string | null;
    daily_streak: number;
    last_daily_at: string | null;
  };
  role: AdminRole | null;
  wallet: { cash: number; bank: number; btc: number };
  assets: { realty: number; cars: number; business: number; deposits: number; btc_usd: number };
  capital: number;
  vip: { level: number; ends_at: string; active: boolean } | null;
  corporation: { name: string; role: string } | null;
  stats: { games_played: number; games_won: number; total_wagered: number; total_won: number; shifts: number; cosmetics: number };
  owned: { realty: { code: string; level: number }[]; cars: { code: string; level: number }[]; business: { code: string; level: number; employees: number }[] };
  ledger: { id: number; op_type: string; direction: string; account: string; amount: number; balance_before: number; balance_after: number; reason: string; created_at: string }[];
  rounds: { game: string; bet: number; multiplier: number; payout: number; status: string; created_at: string }[];
  audit: { action: string; payload: Record<string, unknown>; created_at: string; actor: string | null }[];
}

export interface AuditRow {
  id: number;
  action: string;
  actor: string | null;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  total: number;
}

export interface PromoRow {
  code: string;
  reward_usd: number;
  reward_btc: number;
  max_uses: number;
  used_count: number;
  starts_at: string;
  expires_at: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface EventRow {
  code: string;
  title: string;
  description: string;
  event_type: "daily" | "mining";
  multiplier: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
}

export interface JobRow {
  key: string;
  income_min: number;
  income_max: number;
  cooldown_seconds: number;
  xp_reward: number;
  min_capital: number;
  require_car: boolean;
  is_active: boolean;
}

export interface GameRow {
  game: string;
  enabled: boolean;
  min_bet: number;
  max_bet: number;
}

export const adminMe = () => rpc<{ role: AdminRole | null; game_name: string | null }>("admin_me");
export const adminSessionStart = () => rpc("admin_session_start");
export const adminDashboard = () => rpc<Dashboard>("admin_dashboard");
export const adminDailyStats = (days = 14) =>
  rpc<{ day: string; registrations: number; rounds: number; bets: number; payouts: number; ops: number }[]>("admin_daily_stats", { p_days: days });
export const adminSearchPlayers = (q: string, limit: number, offset: number) =>
  rpc<PlayerRow[]>("admin_search_players", { p_query: q, p_limit: limit, p_offset: offset });
export const adminPlayer = (id: string) => rpc<PlayerDetail>("admin_player", { p_user: id });
export const adminSetStatus = (id: string, status: string, reason: string) => rpc("admin_set_status", { p_user: id, p_status: status, p_reason: reason });
export const adminAdjustBalance = (id: string, account: string, amount: number, reason: string, key: string) =>
  rpc<{ status: string; before: number; after: number }>("admin_adjust_balance", {
    p_target_user: id,
    p_account: account,
    p_amount: amount,
    p_reason: reason,
    p_idempotency_key: key,
  });
export const adminSetRole = (id: string, role: string | null) => rpc("admin_set_role", { p_user: id, p_role: role });
export const adminGrantVip = (id: string, level: number, days: number, reason: string) =>
  rpc("admin_grant_vip", { p_target: id, p_level: level, p_days: days, p_reason: reason });
export const adminRevokeVip = (id: string, reason: string) => rpc("admin_revoke_vip", { p_user: id, p_reason: reason });
export const adminListVip = () => rpc<{ user_id: string; game_name: string; level: number; ends_at: string; active: boolean }[]>("admin_list_vip");
export const adminListSettings = () => rpc<{ key: string; value: number; description: string; updated_at: string }[]>("admin_list_settings");
export const adminSetSetting = (key: string, value: number) => rpc<{ old: number; new: number }>("admin_set_economy_setting", { p_key: key, p_value: value });
export const adminListGames = async (): Promise<GameRow[]> => {
  const { data, error } = await getSupabase().from("game_settings").select("game, enabled, min_bet, max_bet").order("game");
  if (error) throw new Error(error.message);
  return (data ?? []) as GameRow[];
};
export const adminSetGame = (game: string, enabled: boolean, min: number, max: number) =>
  rpc("admin_set_game", { p_game: game, p_enabled: enabled, p_min: min, p_max: max });
export const adminListJobs = () => rpc<JobRow[]>("admin_list_jobs");
export const adminSetJob = (j: JobRow) =>
  rpc("admin_set_job", {
    p_key: j.key,
    p_income_min: j.income_min,
    p_income_max: j.income_max,
    p_cooldown: j.cooldown_seconds,
    p_min_capital: j.min_capital,
    p_xp: j.xp_reward,
    p_active: j.is_active,
  });
export const adminListPromos = () => rpc<PromoRow[]>("admin_list_promos");
export const adminCreatePromo = (code: string, usd: number, btc: number, maxUses: number, starts: string | null, expires: string | null) =>
  rpc("admin_create_promo", { p_code: code, p_usd: usd, p_btc: btc, p_max_uses: maxUses, p_starts: starts, p_expires: expires });
export const adminSetPromoActive = (code: string, active: boolean) => rpc("admin_set_promo_active", { p_code: code, p_active: active });
export const adminPromoRedemptions = (code: string) => rpc<{ game_name: string; created_at: string }[]>("admin_promo_redemptions", { p_code: code });
export const adminListEvents = () => rpc<EventRow[]>("admin_list_events");
export const adminCreateEvent = (e: Omit<EventRow, "active">) =>
  rpc("admin_create_event", {
    p_code: e.code,
    p_title: e.title,
    p_description: e.description,
    p_type: e.event_type,
    p_multiplier: e.multiplier,
    p_starts: e.starts_at,
    p_ends: e.ends_at,
  });
export const adminSetEventActive = (code: string, active: boolean) => rpc("admin_set_event_active", { p_code: code, p_active: active });
export const adminAudit = (action: string | null, limit: number, offset: number) =>
  rpc<AuditRow[]>("admin_audit", { p_action: action, p_limit: limit, p_offset: offset });
export const adminLargeTransfers = (min: number) =>
  rpc<{ created_at: string; sender: string | null; receiver: string; amount: number; group_id: string }[]>("admin_large_transfers", { p_min: min, p_limit: 100 });
