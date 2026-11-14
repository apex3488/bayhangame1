// Group moderation core: Russian command parsing, Telegram permission checks and the moderation
// calls themselves. No database and no Deno APIs: the Telegram call is passed in as `api`, so the
// tests run all of this against a mock. Only Telegram group rights change here, never game data.

export type TgResult = {
  ok: boolean;
  // deno-lint-ignore no-explicit-any
  result?: any;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};
export type Api = (method: string, body: Record<string, unknown>) => Promise<TgResult>;

/** Telegram treats restrictions shorter than 30 s or longer than 366 days as permanent. */
export const MIN_SECONDS = 30;
export const MAX_SECONDS = 366 * 86400;
export const MAX_CLEAN = 500;
export const CONFIRM_CLEAN_OVER = 50;
/** Values Telegram offers for slow mode (set in the group's settings; the Bot API cannot change it). */
export const SLOW_VALUES = [0, 10, 30, 60, 300, 900, 3600];
/** Telegram's own accounts: service notifications, anonymous admins, channel posts. */
export const SERVICE_IDS = new Set([777000, 1087968824, 136817688]);

export type Op =
  | "ban" | "unban" | "mute" | "unmute" | "kick" | "del" | "warn" | "warns" | "unwarn"
  | "lock" | "unlock" | "slow" | "clean" | "panel";
export interface ModCmd {
  op: Op;
  /** Restriction length; null = permanent; undefined = the chat's default (mute). */
  seconds?: number | null;
  reason?: string;
  /** "разбан 123456789": a target given by Telegram id instead of a reply. */
  targetId?: number;
  count?: number;
  arg?: string;
  error?: string;
}

const UNIT: Record<string, number> = { с: 1, м: 60, ч: 3600, д: 86400, н: 604800 };
const WORD_OPS: Record<string, Op> = {
  бан: "ban", разбан: "unban", мут: "mute", размут: "unmute", кик: "kick", дел: "del",
  варн: "warn", варны: "warns", снятьварн: "unwarn",
};

export const normText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** "30м", "1ч", "7д", "2н", "навсегда" → seconds, null = forever, undefined = not a duration. */
export function parseDuration(tok: string): number | null | undefined {
  const t = normText(tok);
  if (t === "навсегда") return null;
  const m = t.match(/^(\d{1,6})(с|сек|м|мин|ч|час|часа|часов|д|дн|день|дня|дней|н|нед)$/);
  if (!m) return undefined;
  return Number(m[1]) * UNIT[m[2][0]];
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return "навсегда";
  const parts: string[] = [];
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) parts.push(`${d} д`);
  if (h) parts.push(`${h} ч`);
  if (m) parts.push(`${m} мин`);
  if (s && !d && !h) parts.push(`${s} с`);
  return parts.join(" ") || "0 с";
}

const DURATION_HELP = "Срок: 30с, 5м, 30м, 1ч, 1д, 7д, 2н (от 30 секунд до 366 дней) или «навсегда».";

/**
 * Parses a moderation command; null when the text is not one. Only the owner's messages are
 * parsed, and user-targeted commands still need a reply or an explicit id.
 */
export function parseMod(raw: string, botUsername = ""): ModCmd | null {
  if (!raw || raw.length > 300) return null;
  let text = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (botUsername) text = text.replace(new RegExp(`^(/\\S+)@${botUsername}\\b`, "i"), "$1");
  const t = normText(text);
  if (["/moderation", "модерация", "/модерация"].includes(t)) return { op: "panel" };
  if (t === "закрыть чат") return { op: "lock" };
  if (t === "открыть чат") return { op: "unlock" };

  let orig = text.split(" ");
  let low = t.split(" ");
  if (low[0] === "снять" && low[1] === "варн") {
    orig = ["снятьварн", ...orig.slice(2)];
    low = ["снятьварн", ...low.slice(2)];
  }
  if (low[0] === "слоумод" || (low[0] === "медленный" && low[1] === "режим")) {
    return { op: "slow", arg: low[0] === "слоумод" ? low[1] ?? "" : low[2] ?? "" };
  }
  if (low[0] === "очистить") {
    if (low.length > 2) return null;
    const n = Number(low[1]);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CLEAN) return { op: "clean", error: `Сколько удалить: «очистить 50» (от 1 до ${MAX_CLEAN}).` };
    return { op: "clean", count: n };
  }
  const op = WORD_OPS[low[0]];
  if (!op) return null;
  const cmd: ModCmd = { op };
  let i = 1;
  if (op !== "del" && low[i] && /^\d{5,15}$/.test(low[i])) cmd.targetId = Number(low[i++]);
  if (op === "ban" || op === "mute") {
    const d = low[i] !== undefined ? parseDuration(low[i]) : undefined;
    if (d !== undefined) {
      i++;
      if (d !== null && (d < MIN_SECONDS || d > MAX_SECONDS)) return { op, error: `Такой срок Telegram не поддерживает. ${DURATION_HELP}` };
      cmd.seconds = d;
    } else if (low[i] && /^\d+[a-zа-я]*$/.test(low[i])) {
      return { op, error: `Неверный срок «${low[i]}». ${DURATION_HELP}` };
    } else cmd.seconds = op === "ban" ? null : undefined;
  }
  const reason = orig.slice(i).join(" ").slice(0, 200);
  if (reason) cmd.reason = reason;
  return cmd;
}

// ----------------------------------------------------------------- rights ----
export type Need = "restrict" | "delete" | "admin";
/** What each command needs from the owner and the bot in the group (null: nothing). */
export const NEED: Record<Op, Need | null> = {
  ban: "restrict", unban: "restrict", mute: "restrict", unmute: "restrict", kick: "restrict", lock: "restrict", unlock: "restrict",
  del: "delete", clean: "delete", warn: "admin", warns: "admin", unwarn: "admin", slow: "admin", panel: null,
};
const RIGHT_NAME: Record<Exclude<Need, "admin">, string> = { restrict: "Блокировка пользователей", delete: "Удаление сообщений" };

// deno-lint-ignore no-explicit-any
export function hasRight(m: any, need: Need): boolean {
  if (!m) return false;
  if (m.status === "creator") return true;
  if (m.status !== "administrator") return false;
  if (need === "restrict") return m.can_restrict_members === true;
  if (need === "delete") return m.can_delete_messages === true;
  return true;
}

const memberCache = new Map<string, { at: number; m: unknown }>();
export const clearMemberCache = () => memberCache.clear();
/** getChatMember, cached for 30 s for the owner and the bot (rights rarely change mid-minute). */
export async function member(api: Api, chatId: number, userId: number, cache = true) {
  const k = `${chatId}:${userId}`;
  const hit = memberCache.get(k);
  if (cache && hit && Date.now() - hit.at < 30_000) return hit.m;
  const r = await call(api, "getChatMember", { chat_id: chatId, user_id: userId });
  const m = r.ok ? r.result : null;
  if (cache && r.ok) memberCache.set(k, { at: Date.now(), m });
  if (memberCache.size > 500) memberCache.clear();
  return m;
}

/**
 * Being the game owner does not bypass Telegram: the owner must be the group's creator or an admin
 * with the needed right, and so must the bot. Returns the Russian refusal, or null when allowed.
 */
export async function authorize(api: Api, chatId: number, ownerId: number, botId: number, need: Need | null): Promise<string | null> {
  if (!need) return null;
  const [o, b] = await Promise.all([member(api, chatId, ownerId), need === "admin" ? Promise.resolve(null) : member(api, chatId, botId)]);
  if (need === "admin") return hasRight(o, "admin") ? null : "Вы не администратор этой группы.";
  if (!hasRight(o, need)) return `У вас в этой группе нет права «${RIGHT_NAME[need]}».`;
  if (!hasRight(b, need)) {
    // deno-lint-ignore no-explicit-any
    return (b as any)?.status === "administrator"
      ? `BAYHAN GAME: у бота недостаточно прав — нужно право «${RIGHT_NAME[need]}».`
      : "BAYHAN GAME: бот не администратор группы. Назначьте его администратором с правами блокировки и удаления сообщений.";
  }
  return null;
}

// ----------------------------------------------------------------- target ----
export interface Target { id: number; name: string }

/** The author of the replied-to message, or why it cannot be verified. null: no reply at all. */
// deno-lint-ignore no-explicit-any
export function replyTarget(msg: any, actorId: number, botId: number): Target | { error: string } | null {
  const r = msg?.reply_to_message;
  // In forum groups every message "replies" to its topic's first message.
  if (!r || r.forum_topic_created || (msg.is_topic_message && r.message_id === msg.message_thread_id)) return null;
  if (r.sender_chat) return { error: "Сообщение отправлено от имени канала или анонимного администратора — автора не проверить." };
  const u = r.from;
  if (!u?.id) return { error: "Не удалось определить автора сообщения." };
  return checkTargetId(u.id, actorId, botId) ?? { id: u.id, name: u.first_name || (u.username ? `@${u.username}` : String(u.id)) };
}

export function checkTargetId(id: number, actorId: number, botId: number): { error: string } | null {
  if (SERVICE_IDS.has(id)) return { error: "Это служебный аккаунт Telegram." };
  if (id === botId) return { error: "К самому боту это не применить." };
  if (id === actorId) return { error: "Нельзя применить к самому себе." };
  return null;
}

/** The group's creator and admins are protected from bans, mutes, kicks and warnings. */
export async function protectedTarget(api: Api, chatId: number, targetId: number): Promise<{ error?: string; status?: string }> {
  // deno-lint-ignore no-explicit-any
  const m: any = await member(api, chatId, targetId, false);
  const status = m?.status;
  if (status === "creator") return { error: "Владельца группы наказывать нельзя.", status };
  if (status === "administrator") return { error: "Это администратор группы — сначала снимите с него права администратора.", status };
  return { status };
}

// ---------------------------------------------------------------- actions ----
const PERM_KEYS = [
  "can_send_messages", "can_send_audios", "can_send_documents", "can_send_photos", "can_send_videos", "can_send_video_notes",
  "can_send_voice_notes", "can_send_polls", "can_send_other_messages", "can_add_web_page_previews", "can_change_info",
  "can_invite_users", "can_pin_messages", "can_manage_topics",
] as const;
export const NO_PERMS: Record<string, boolean> = Object.fromEntries(PERM_KEYS.map((k) => [k, false]));
/** Used to reopen a chat only when its earlier permissions are unknown. */
export const DEFAULT_OPEN: Record<string, boolean> = {
  ...Object.fromEntries(PERM_KEYS.map((k) => [k, true])),
  can_change_info: false, can_pin_messages: false, can_manage_topics: false,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Telegram call; a short "retry after" is waited out once, longer ones are returned. */
export async function call(api: Api, method: string, body: Record<string, unknown>, maxWaitS = 3): Promise<TgResult> {
  const once = () => api(method, body).catch(() => ({ ok: false, description: "network error" } as TgResult));
  let r = await once();
  const wait = r.parameters?.retry_after;
  if (!r.ok && r.error_code === 429 && wait !== undefined && wait <= maxWaitS) {
    await sleep(wait * 1000);
    r = await once();
  }
  return r;
}

export const until = (seconds: number | null | undefined, now = Date.now()) => (seconds ? Math.floor(now / 1000) + seconds : 0);

/**
 * Executes one action. `restore` are the permissions an unmuted user gets back (the group's own
 * defaults, or the saved ones while the chat is closed), so an unmute never grants more.
 */
export async function act(api: Api, chatId: number, op: "ban" | "unban" | "mute" | "unmute" | "kick", userId: number,
  seconds: number | null | undefined, restore?: Record<string, boolean>): Promise<TgResult> {
  switch (op) {
    case "ban": return call(api, "banChatMember", { chat_id: chatId, user_id: userId, until_date: until(seconds), revoke_messages: false });
    case "unban": return call(api, "unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
    case "mute":
      return call(api, "restrictChatMember", { chat_id: chatId, user_id: userId, permissions: NO_PERMS, use_independent_chat_permissions: true, until_date: until(seconds) });
    case "unmute":
      return call(api, "restrictChatMember", { chat_id: chatId, user_id: userId, permissions: restore ?? DEFAULT_OPEN, use_independent_chat_permissions: true });
    case "kick": {
      // A kick is a short ban (60 s, so Telegram does not read it as permanent) lifted at once.
      const r = await call(api, "banChatMember", { chat_id: chatId, user_id: userId, until_date: until(60), revoke_messages: false });
      if (!r.ok) return r;
      const u = await call(api, "unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
      return u.ok ? r : { ok: false, description: "kicked but unban failed: " + (u.description ?? ""), error_code: u.error_code };
    }
  }
}

/** Telegram's error → a short Russian explanation (never internals). */
export function tgError(r: TgResult): string {
  const d = (r.description ?? "").toLowerCase();
  if (r.error_code === 429) return `Telegram ограничил частоту запросов — повторите через ${r.parameters?.retry_after ?? 5} с.`;
  if (r.parameters?.migrate_to_chat_id || d.includes("upgraded to a supergroup")) return "Группа стала супергруппой — повторите команду в ней.";
  if (d.includes("kicked but unban failed")) return "Пользователь удалён, но снять временный бан не удалось — он сможет вернуться через минуту.";
  if (d.includes("can't remove chat owner") || d.includes("chat owner")) return "Владельца группы наказывать нельзя.";
  if (d.includes("user is an administrator") || d.includes("user_admin_invalid") || d.includes("can't restrict self")) return "Нельзя применить к администратору группы.";
  if (d.includes("not enough rights") || d.includes("chat_admin_required") || d.includes("have no rights") || d.includes("need administrator rights")) {
    return "BAYHAN GAME: у бота недостаточно прав для выполнения этого действия.";
  }
  if (d.includes("message to delete not found") || d.includes("message can't be deleted") || d.includes("message_delete_forbidden")) {
    return "Сообщение уже удалено или его нельзя удалить (Telegram даёт удалять только сообщения младше 48 часов).";
  }
  if (d.includes("user not found") || d.includes("participant_id_invalid") || d.includes("user_id_invalid") || d.includes("user_not_participant")) {
    return "Пользователь не найден в группе.";
  }
  if (d.includes("only for supergroups") || d.includes("supergroup")) return "Это действие Telegram разрешает только в супергруппах.";
  if (d.includes("network")) return "Нет связи с Telegram — попробуйте ещё раз.";
  return "Telegram отклонил действие.";
}

/**
 * Deletes known message ids in batches of 100. deleteMessages skips ids that are already gone
 * without saying which, so a successful batch counts as "up to" its size; a failed batch is retried
 * one by one to get exact counts.
 */
export async function deleteMany(api: Api, chatId: number, ids: number[]): Promise<{ deleted: number; failed: number; exact: boolean }> {
  let deleted = 0, failed = 0, exact = true;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await call(api, "deleteMessages", { chat_id: chatId, message_ids: chunk }, 10);
    if (r.ok) {
      deleted += chunk.length;
      exact = false;
      continue;
    }
    for (const id of chunk) {
      const one = await call(api, "deleteMessage", { chat_id: chatId, message_id: id }, 5);
      if (one.ok) deleted++;
      else failed++;
    }
  }
  return { deleted, failed, exact: exact && ids.length > 0 };
}

// ------------------------------------------------------------- mass action ----
export type BulkAction = "ban" | "mute" | "kick" | "unban";
export interface BulkResult { user_id: number; status: "ok" | "failed" | "skipped" | "already"; error?: string }

/**
 * Runs one batch of a mass action with bounded concurrency. Protected ids are skipped, users banned
 * before the operation are "already" (an undo never unbans them). On a long rate limit the batch
 * stops and the remaining users stay pending for the next timer run.
 */
export async function runBulk(api: Api, chatId: number, action: BulkAction, targets: { user_id: number }[],
  opts: { deadline: number; protect: Set<number>; seconds?: number | null; concurrency?: number; restore?: Record<string, boolean> }):
  Promise<{ results: BulkResult[]; rateLimited: boolean }> {
  const results: BulkResult[] = [];
  let rateLimited = false;
  let next = 0;
  const worker = async () => {
    while (next < targets.length && !rateLimited && Date.now() < opts.deadline) {
      const id = Number(targets[next++].user_id);
      if (opts.protect.has(id) || SERVICE_IDS.has(id)) {
        results.push({ user_id: id, status: "skipped", error: "protected" });
        continue;
      }
      if (action !== "unban") {
        const m = await call(api, "getChatMember", { chat_id: chatId, user_id: id }, 0);
        if (!m.ok && m.error_code === 429) { rateLimited = true; break; }
        const st = m.ok ? m.result?.status : null;
        if (st === "creator" || st === "administrator") { results.push({ user_id: id, status: "skipped", error: "admin" }); continue; }
        if (action === "ban" && st === "kicked") { results.push({ user_id: id, status: "already" }); continue; }
        if (action === "kick" && (st === "left" || st === "kicked" || !st)) { results.push({ user_id: id, status: "skipped", error: "not in group" }); continue; }
        if (action === "mute" && (st === "left" || st === "kicked")) { results.push({ user_id: id, status: "skipped", error: "not in group" }); continue; }
      }
      const r = await act(api, chatId, action, id, action === "mute" ? opts.seconds : null, opts.restore);
      if (!r.ok && r.error_code === 429) { rateLimited = true; break; }
      results.push(r.ok ? { user_id: id, status: "ok" } : { user_id: id, status: "failed", error: (r.description ?? "failed").slice(0, 150) });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, 8)) }, worker));
  return { results, rateLimited };
}

/** The exact phrase the owner types to start a mass action. */
export const bulkPhrase = (action: BulkAction, scope: string, chatId: number) =>
  `${scope === "all" && action === "ban" ? "ВСЕМ БАН" : { ban: "БАН", mute: "МУТ", kick: "КИК", unban: "РАЗБАН" }[action]} ${chatId}`;
export const samePhrase = (typed: string, expected: string) => typed.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase() === expected;

/** Telegram ids from typed text ("123, 456 789"), deduplicated, at most `max`. */
export function parseIds(text: string, max = 500): number[] {
  const ids = [...new Set((text.match(/\d{5,15}/g) ?? []).map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0);
  return ids.slice(0, max);
}
