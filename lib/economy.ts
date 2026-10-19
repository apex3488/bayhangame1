// Data layer for the bot's economy, progression, cosmetics and social systems (migrations 0006–0009).
// Every write goes through a server RPC; tables are read only where RLS allows it.
import { getSupabase } from "./supabase";
import type { LedgerRow } from "./game";

async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function select<T>(table: string, columns = "*", order?: string, ascending = true): Promise<T[]> {
  let q = getSupabase().from(table).select(columns);
  if (order) q = q.order(order, { ascending });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

// ---------------------------------------------------------------- bank & BTC
export interface BankDeposit {
  id: number;
  amount: number;
  rate_percent: number;
  days: number;
  starts_at: string;
  ends_at: string;
  claimed: boolean;
  interest_paid: number;
}

export const fetchBankTerms = () => select<{ days: number; rate_percent: number }>("bank_terms", "*", "days");
export const fetchDeposits = () => select<BankDeposit>("bank_deposits", "*", "id", false);
export const bankDeposit = (amount: number, key: string) => rpc("bank_deposit", { p_amount: amount, p_idempotency_key: key });
export const bankWithdraw = (amount: number, key: string) => rpc("bank_withdraw", { p_amount: amount, p_idempotency_key: key });
export const depositOpen = (amount: number, days: number, key: string) =>
  rpc("deposit_open", { p_amount: amount, p_days: days, p_idempotency_key: key });
export const depositClaim = (id: number) => rpc<{ payout: number; interest: number }>("deposit_claim", { p_deposit: id });
export const btcBuy = (usd: number, key: string) => rpc<{ btc: number }>("btc_buy", { p_usd: usd, p_idempotency_key: key });
export const btcSell = (btc: number, key: string) => rpc<{ usd: number }>("btc_sell", { p_btc: btc, p_idempotency_key: key });

export const fetchSettings = async (): Promise<Record<string, number>> => {
  const rows = await select<{ key: string; value: number }>("economy_settings", "key, value");
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
};

// --------------------------------------------------------------- assets
export type AssetKind = "realty" | "car" | "business" | "luxury";

export interface CatalogItem {
  code: string;
  category: string;
  price: number;
  income_per_hour?: number;
  expense_per_hour?: number;
  max_level?: number;
  upgrade_cost_base?: number;
  power?: number;
  max_speed?: number;
}

export interface OwnedAsset {
  code: string;
  level: number;
  employees?: number;
  last_collected_at?: string;
}

const ASSET_TABLES: Record<AssetKind, { catalog: string; owned: string }> = {
  luxury: { catalog: "luxury_items", owned: "user_luxury" },
  realty: { catalog: "realty_items", owned: "user_realty" },
  car: { catalog: "car_items", owned: "user_cars" },
  business: { catalog: "business_items", owned: "user_businesses" },
};

export const fetchCatalog = (kind: AssetKind) => select<CatalogItem>(ASSET_TABLES[kind].catalog, "*", "sort_order");
export const fetchOwned = (kind: AssetKind) => select<OwnedAsset>(ASSET_TABLES[kind].owned);
export const assetBuy = (kind: AssetKind, code: string, key: string) =>
  rpc<{ price: number }>("asset_buy", { p_kind: kind, p_code: code, p_idempotency_key: key });
export const assetSell = (kind: AssetKind, code: string, key: string) =>
  rpc<{ proceeds: number }>("asset_sell", { p_kind: kind, p_code: code, p_idempotency_key: key });
export const assetUpgrade = (kind: AssetKind, code: string, key: string) =>
  rpc<{ cost: number; level: number }>("asset_upgrade", { p_kind: kind, p_code: code, p_idempotency_key: key });
export const businessHire = (code: string, key: string) => rpc<{ cost: number; employees: number }>("business_hire", { p_code: code, p_idempotency_key: key });
export const collectIncome = (kind?: "realty" | "business") => rpc<{ total: number }>("collect_income", { p_kind: kind ?? null });

// ----------------------------------------------------------- resources, shop, cases, promo
export interface Resource {
  code: string;
  buy_price: number;
  sell_price: number;
  mine_chance: number;
  mine_min: number;
  mine_max: number;
}

export const fetchResources = () => select<Resource>("resources", "*", "sort_order");
export const fetchMyResources = () => select<{ code: string; amount: number }>("user_resources", "code, amount");
export const fetchLastMining = async (): Promise<string | null> => {
  const rows = await getSupabase().from("mining_log").select("created_at").order("created_at", { ascending: false }).limit(1);
  if (rows.error) throw new Error(rows.error.message);
  return (rows.data?.[0]?.created_at as string | undefined) ?? null;
};
export const mineResources = () => rpc<{ rewards: Record<string, number>; total: number; next_at: string }>("mine_resources");
export const sellResource = (code: string, amount: number, key: string) =>
  rpc<{ usd: number }>("sell_resource", { p_code: code, p_amount: amount, p_idempotency_key: key });
export const shopBuy = (code: string, qty: number, key: string) => rpc<{ total: number }>("shop_buy", { p_code: code, p_qty: qty, p_idempotency_key: key });

export interface CaseRow {
  code: string;
  rarity: string;
  price: number;
}

export interface CaseReward {
  id: number;
  case_code: string;
  reward_type: "usd" | "btc" | "resource";
  amount: number;
  resource_code: string | null;
  weight: number;
  rarity: string;
}

export const fetchCases = () => select<CaseRow>("cases", "code, rarity, price", "sort_order");
export const fetchCaseRewards = () => select<CaseReward>("case_rewards", "*", "id");
export const openCase = (code: string, key: string) => rpc<{ status: string; reward: CaseReward }>("open_case", { p_code: code, p_idempotency_key: key });
export const redeemPromo = (code: string) => rpc<{ usd: number; btc: number }>("redeem_promo", { p_code: code });

// ------------------------------------------------------------- progression
export interface QuestRow {
  code: string;
  quest_type: string;
  target: number;
  reward_usd: number;
  progress: number;
  claimed: boolean;
}

export interface AchievementRow {
  code: string;
  condition_type: string;
  condition_value: number;
  reward_usd: number;
  progress: number;
  claimed: boolean;
}

export interface EventRow {
  code: string;
  title: string;
  description: string;
  event_type: string;
  multiplier: number;
  starts_at: string;
  ends_at: string;
}

export const fetchQuests = () => rpc<QuestRow[]>("my_quests");
export const claimQuest = (code: string) => rpc<{ reward: number }>("claim_quest", { p_code: code });
export const fetchAchievements = () => rpc<AchievementRow[]>("my_achievements");
export const claimAchievement = (code: string) => rpc<{ reward: number }>("claim_achievement", { p_code: code });
export const fetchVip = () => rpc<{ level: number; active: boolean; multiplier: number; ends_at?: string }>("my_vip");
export const fetchEvents = () => select<EventRow>("events", "*", "starts_at");
export const fetchReferrals = () =>
  rpc<{ code: string; reward: number; invited: number; qualified: number; earned: number; list: { game_name: string; qualified: boolean; joined: string }[] }>("my_referrals");
export const renameGameName = (name: string) => rpc("rename_game_name", { p_name: name });
export const fetchProfile = () =>
  rpc<{
    game_name: string;
    login: string;
    public_id: number;
    level: number;
    xp: number;
    created_at: string;
    referral_code: string;
    stats: { games_played: number; games_won: number; total_wagered: number; total_won: number; shifts: number; mined: number };
  }>("my_profile");

// --------------------------------------------------------------- cosmetics
export type Slot = "frame" | "badge" | "theme" | "name_style" | "title" | "effect";

export interface CosmeticItem {
  code: string;
  category: Slot | "box";
  icon: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic" | "limited";
  price: number;
  purchasable: boolean;
  limited_qty: number | null;
  sold_count: number;
  featured: boolean;
  style: Record<string, string | boolean>;
}

export type Loadout = Partial<Record<Slot, { code: string; icon: string; rarity: string; style: Record<string, string | boolean> }>>;

export const fetchCosmetics = () => select<CosmeticItem>("cosmetic_items", "*", "sort_order");
export const fetchMyCosmetics = () => select<{ code: string; source: string; acquired_at: string }>("user_cosmetics", "code, source, acquired_at");
export const fetchBoxRewards = () => select<{ box_code: string; reward_code: string; weight: number }>("box_rewards");
export const fetchCollections = async () => {
  const [cols, items, mine] = await Promise.all([
    select<{ code: string; reward_code: string }>("cosmetic_collections", "code, reward_code", "sort_order"),
    select<{ collection_code: string; item_code: string }>("cosmetic_collection_items"),
    select<{ collection_code: string }>("user_collections", "collection_code"),
  ]);
  return cols.map((c) => ({
    ...c,
    items: items.filter((i) => i.collection_code === c.code).map((i) => i.item_code),
    completed: mine.some((m) => m.collection_code === c.code),
  }));
};
export const cosmeticBuy = (code: string, key: string) => rpc("cosmetic_buy", { p_code: code, p_idempotency_key: key });
export const openBox = (code: string, key: string) => rpc<{ status: string; reward: CosmeticItem }>("open_box", { p_code: code, p_idempotency_key: key });
export const cosmeticEquip = (code: string) => rpc("cosmetic_equip", { p_code: code });
export const cosmeticUnequip = (slot: Slot) => rpc("cosmetic_unequip", { p_slot: slot });
export const fetchLoadout = () => rpc<Loadout>("loadout_of", { p_user: null });

// ---------------------------------------------------------------- social
export type CorpRole = "president" | "vp" | "financier" | "manager" | "member";

export interface MyCorporation {
  member: boolean;
  create_cost?: number;
  invites?: { id: number; corp: string; from: string; created_at: string }[];
  role?: CorpRole;
  corp?: { id: number; name: string; description: string; treasury: number; prestige: number; level: number; created_at: string };
  members?: { user_id: string; game_name: string; role: CorpRole; level: number; joined_at: string }[];
  buildings?: { code: string; price: number; prestige: number; owned: boolean }[];
  tasks?: { code: string; target: number; reward: number; prestige: number; progress: number; claimed: boolean }[];
  log?: { kind: string; amount: number; balance_after: number; note: string | null; created_at: string; game_name: string | null }[];
}

export const fetchCorporation = () => rpc<MyCorporation>("my_corporation");
export const corpCreate = (name: string, description: string, key: string) =>
  rpc("corp_create", { p_name: name, p_description: description, p_idempotency_key: key });
export const corpInvite = (name: string) => rpc("corp_invite", { p_game_name: name });
export const corpRespond = (id: number, accept: boolean) => rpc("corp_respond", { p_invite: id, p_accept: accept });
export const corpLeave = () => rpc("corp_leave");
export const corpManage = (user: string, action: "promote" | "demote" | "kick") => rpc("corp_manage", { p_target: user, p_action: action });
export const corpDeposit = (amount: number, key: string) => rpc("corp_deposit", { p_amount: amount, p_idempotency_key: key });
export const corpWithdraw = (amount: number, key: string) => rpc("corp_withdraw", { p_amount: amount, p_idempotency_key: key });
export const corpBuyBuilding = (code: string) => rpc("corp_buy_building", { p_code: code });
export const corpClaimTask = (code: string) => rpc("corp_claim_task", { p_code: code });
export const fetchCorpLeaderboard = () =>
  rpc<{ rank: number; name: string; level: number; prestige: number; members: number; score: number }[]>("leaderboard_corporations", { p_limit: 50 });

export const fetchMarriage = () =>
  rpc<{
    partner: { game_name: string; level: number; since: string } | null;
    incoming: { id: number; from: string; expires_at: string }[];
    outgoing: { id: number; to: string; expires_at: string }[];
  }>("my_marriage");
export const marriagePropose = (name: string) => rpc("marriage_propose", { p_game_name: name });
export const marriageRespond = (id: number, accept: boolean) => rpc("marriage_respond", { p_proposal: id, p_accept: accept });
export const marriageDivorce = () => rpc("marriage_divorce");

export async function fetchLedgerPage(page: number, size = 25): Promise<LedgerRow[]> {
  const { data, error } = await getSupabase()
    .from("ledger_entries")
    .select("id, op_type, direction, account, amount, balance_after, reason, created_at")
    .order("id", { ascending: false })
    .range(page * size, page * size + size - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as LedgerRow[];
}

export interface LuxuryItem {
  code: string;
  category: "watch" | "jewelry" | "art" | "jet" | "yacht" | "space";
  price: number;
  rarity: string;
}
export const fetchLuxury = () => select<LuxuryItem>("luxury_items", "code, category, price, rarity", "sort_order");
export const fetchMyLuxury = () => select<{ code: string }>("user_luxury", "code");
