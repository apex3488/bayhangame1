// deno test supabase/functions/_shared/moderation_test.ts — group moderation against a mocked Telegram API.
import { assert, assertEquals } from "jsr:@std/assert@1";
import * as M from "./moderation.ts";

type Call = { method: string; body: Record<string, any> };
/** A fake Telegram: members by id, per-method overrides, and a log of every call. */
function mockApi(members: Record<number, any> = {}, over: Record<string, (b: any) => M.TgResult> = {}) {
  const calls: Call[] = [];
  const api: M.Api = (method, body) => {
    calls.push({ method, body });
    if (over[method]) return Promise.resolve(over[method](body));
    if (method === "getChatMember") {
      const m = members[body.user_id as number];
      return Promise.resolve(m ? { ok: true, result: m } : { ok: false, description: "Bad Request: user not found", error_code: 400 });
    }
    return Promise.resolve({ ok: true, result: true });
  };
  return { api, calls, of: (m: string) => calls.filter((c) => c.method === m) };
}
const OWNER = 100, BOT = 200, USER = 300, ADMIN = 400, CREATOR = 500, CHAT = -1001;
const ADMIN_RIGHTS = { status: "administrator", can_restrict_members: true, can_delete_messages: true };

Deno.test("parse: Russian commands, durations, reasons, ids", () => {
  assertEquals(M.parseMod("бан"), { op: "ban", seconds: null });
  assertEquals(M.parseMod("Бан 7д Реклама"), { op: "ban", seconds: 7 * 86400, reason: "Реклама" });
  assertEquals(M.parseMod("  МУТ   30м  Оскорбления "), { op: "mute", seconds: 1800, reason: "Оскорбления" });
  assertEquals(M.parseMod("мут"), { op: "mute", seconds: undefined });
  assertEquals(M.parseMod("мут навсегда"), { op: "mute", seconds: null });
  assertEquals(M.parseMod("мут 2н"), { op: "mute", seconds: 2 * 604800 });
  assertEquals(M.parseMod("разбан 123456789"), { op: "unban", targetId: 123456789 });
  assertEquals(M.parseMod("варн Нарушение правил"), { op: "warn", reason: "Нарушение правил" });
  assertEquals(M.parseMod("снять варн")?.op, "unwarn");
  assertEquals(M.parseMod("снятьварн")?.op, "unwarn");
  assertEquals(M.parseMod("варны")?.op, "warns");
  assertEquals(M.parseMod("кик")?.op, "kick");
  assertEquals(M.parseMod("дел")?.op, "del");
  assertEquals(M.parseMod("закрыть   чат")?.op, "lock");
  assertEquals(M.parseMod("Открыть чат")?.op, "unlock");
  assertEquals(M.parseMod("очистить 50"), { op: "clean", count: 50 });
  assertEquals(M.parseMod("слоумод 10с"), { op: "slow", arg: "10с" });
  assertEquals(M.parseMod("/moderation@BayhanGame2_bot", "BayhanGame2_bot")?.op, "panel");
  assertEquals(M.parseMod("модерация")?.op, "panel");
  // Not commands.
  assertEquals(M.parseMod("бананы"), null);
  assertEquals(M.parseMod("привет всем"), null);
  assertEquals(M.parseMod("очистить кэш браузера"), null);
});

Deno.test("parse: Telegram duration limits are enforced, never silently made permanent", () => {
  assert(M.parseMod("мут 10с")?.error, "under 30 s would become permanent in Telegram");
  assert(M.parseMod("бан 400д")?.error, "over 366 days would become permanent");
  assertEquals(M.parseMod("мут 30с")?.seconds, 30);
  assertEquals(M.parseMod("бан 366д")?.seconds, 366 * 86400);
  assert(M.parseMod("бан 5х")?.error);
  assert(M.parseMod("бан 1")?.error);
  assert(M.parseMod("очистить 0")?.error);
  assert(M.parseMod("очистить 501")?.error);
  assertEquals(M.fmtDuration(3600), "1 ч");
  assertEquals(M.fmtDuration(90061), "1 д 1 ч 1 мин");
  assertEquals(M.fmtDuration(null), "навсегда");
});

Deno.test("authorize: owner and bot both need the Telegram right in this group", async () => {
  M.clearMemberCache();
  let t = mockApi({ [OWNER]: { status: "member" }, [BOT]: ADMIN_RIGHTS });
  assert((await M.authorize(t.api, CHAT, OWNER, BOT, "restrict"))?.includes("нет права"), "the game owner does not bypass Telegram");
  M.clearMemberCache();
  t = mockApi({ [OWNER]: { status: "creator" }, [BOT]: { status: "administrator", can_restrict_members: false, can_delete_messages: true } });
  assert((await M.authorize(t.api, CHAT, OWNER, BOT, "restrict"))?.includes("недостаточно прав"));
  assertEquals(await M.authorize(t.api, CHAT, OWNER, BOT, "delete"), null);
  M.clearMemberCache();
  t = mockApi({ [OWNER]: ADMIN_RIGHTS, [BOT]: { status: "member" } });
  assert((await M.authorize(t.api, CHAT, OWNER, BOT, "delete"))?.includes("не администратор"));
  M.clearMemberCache();
  t = mockApi({ [OWNER]: ADMIN_RIGHTS, [BOT]: ADMIN_RIGHTS });
  assertEquals(await M.authorize(t.api, CHAT, OWNER, BOT, "restrict"), null);
  assertEquals(await M.authorize(t.api, CHAT, OWNER, BOT, "admin"), null);
  M.clearMemberCache();
  t = mockApi({ [OWNER]: { status: "member" } });
  assert(await M.authorize(t.api, CHAT, OWNER, BOT, "admin"), "warnings need the owner to be a group admin");
});

Deno.test("target: reply author by id; channels, anonymous admins, service accounts, self and bot refused", () => {
  const msg = (from: any, extra: any = {}) => ({ message_id: 9, reply_to_message: { message_id: 5, from, ...extra } });
  assertEquals(M.replyTarget(msg({ id: USER, first_name: "Вася" }), OWNER, BOT), { id: USER, name: "Вася" });
  assertEquals(M.replyTarget({ message_id: 1 }, OWNER, BOT), null);
  assert("error" in (M.replyTarget(msg({ id: 1087968824 }, { sender_chat: { id: CHAT } }), OWNER, BOT) as any));
  assert("error" in (M.replyTarget(msg({ id: 136817688 }, { sender_chat: { id: -100777 } }), OWNER, BOT) as any));
  assert("error" in (M.replyTarget(msg({ id: 777000 }), OWNER, BOT) as any));
  assert("error" in (M.replyTarget(msg({ id: OWNER }), OWNER, BOT) as any));
  assert("error" in (M.replyTarget(msg({ id: BOT }), OWNER, BOT) as any));
  // A forum topic "reply" is not a target.
  assertEquals(M.replyTarget({ message_id: 9, is_topic_message: true, message_thread_id: 5, reply_to_message: { message_id: 5, from: { id: USER } } }, OWNER, BOT), null);
});

Deno.test("protected: creator and admins cannot be punished", async () => {
  const t = mockApi({ [CREATOR]: { status: "creator" }, [ADMIN]: { status: "administrator" }, [USER]: { status: "member" } });
  assert((await M.protectedTarget(t.api, CHAT, CREATOR)).error);
  assert((await M.protectedTarget(t.api, CHAT, ADMIN)).error);
  assertEquals((await M.protectedTarget(t.api, CHAT, USER)).error, undefined);
});

Deno.test("actions: ban, temp ban, mute, unmute restores given permissions, kick lets them rejoin", async () => {
  const t = mockApi();
  const now = Math.floor(Date.now() / 1000);
  await M.act(t.api, CHAT, "ban", USER, null);
  assertEquals(t.of("banChatMember")[0].body.until_date, 0);
  await M.act(t.api, CHAT, "ban", USER, 3600);
  assert(Math.abs(t.of("banChatMember")[1].body.until_date - (now + 3600)) <= 2);
  await M.act(t.api, CHAT, "mute", USER, 1800);
  const mute = t.of("restrictChatMember")[0].body;
  assertEquals(mute.permissions.can_send_messages, false);
  assertEquals(mute.permissions.can_send_photos, false);
  assert(mute.until_date > now);
  const restore = { ...M.DEFAULT_OPEN, can_send_photos: false };
  await M.act(t.api, CHAT, "unmute", USER, null, restore);
  assertEquals(t.of("restrictChatMember")[1].body.permissions, restore, "an unmute never grants what the group forbids");
  const before = t.calls.length;
  await M.act(t.api, CHAT, "kick", USER, null);
  const kick = t.calls.slice(before);
  assertEquals(kick.map((c) => c.method), ["banChatMember", "unbanChatMember"]);
  assert(kick[0].body.until_date - now >= 59, "a kick ban is longer than 30 s, so never permanent");
  assertEquals(kick[1].body.only_if_banned, true);
  await M.act(t.api, CHAT, "unban", USER, null);
  assertEquals(t.of("unbanChatMember").at(-1)!.body.only_if_banned, true);
});

Deno.test("actions: Telegram failures become Russian errors, success is never claimed", async () => {
  const t = mockApi({}, { banChatMember: () => ({ ok: false, error_code: 400, description: "Bad Request: not enough rights to restrict/unrestrict chat member" }) });
  const r = await M.act(t.api, CHAT, "ban", USER, null);
  assertEquals(r.ok, false);
  assert(M.tgError(r).includes("недостаточно прав"));
  assert(M.tgError({ ok: false, description: "Bad Request: user is an administrator of the chat" }).includes("администратор"));
  assert(M.tgError({ ok: false, description: "Bad Request: message can't be deleted" }).includes("48"));
  assert(M.tgError({ ok: false, error_code: 429, parameters: { retry_after: 7 } }).includes("7"));
  assert(M.tgError({ ok: false, description: "x", parameters: { migrate_to_chat_id: -100 } }).includes("супергрупп"));
  const k = mockApi({}, { unbanChatMember: () => ({ ok: false, description: "network error" }) });
  const kr = await M.act(k.api, CHAT, "kick", USER, null);
  assertEquals(kr.ok, false, "a kick whose unban failed is reported");
});

Deno.test("call: a short retry-after is waited out once", async () => {
  let n = 0;
  const api: M.Api = () => Promise.resolve(n++ === 0 ? { ok: false, error_code: 429, parameters: { retry_after: 0 } } : { ok: true, result: true });
  assertEquals((await M.call(api, "deleteMessage", {})).ok, true);
  assertEquals(n, 2);
  let m = 0;
  const slow: M.Api = () => (m++, Promise.resolve({ ok: false, error_code: 429, parameters: { retry_after: 60 } }));
  assertEquals((await M.call(slow, "deleteMessage", {})).ok, false);
  assertEquals(m, 1, "a long wait is not done inside the request");
});

Deno.test("cleanup: batches of 100, exact counts when Telegram refuses a batch", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const t = mockApi();
  const r = await M.deleteMany(t.api, CHAT, ids);
  assertEquals(t.of("deleteMessages").map((c) => c.body.message_ids.length), [100, 100, 50]);
  assertEquals(r, { deleted: 250, failed: 0, exact: false });
  const f = mockApi({}, {
    deleteMessages: () => ({ ok: false, description: "Bad Request: message can't be deleted" }),
    deleteMessage: (b) => (b.message_id % 2 ? { ok: true, result: true } : { ok: false, description: "message to delete not found" }),
  });
  const r2 = await M.deleteMany(f.api, CHAT, [1, 2, 3, 4, 5]);
  assertEquals(r2, { deleted: 3, failed: 2, exact: true });
  assertEquals((await M.deleteMany(t.api, CHAT, [])).deleted, 0);
});

Deno.test("mass ban: protected skipped, already-banned kept apart for undo, admins skipped", async () => {
  const members = { 1: { status: "member" }, 2: { status: "kicked" }, 3: { status: "administrator" }, 4: { status: "member" }, 5: { status: "creator" } };
  const t = mockApi(members);
  const { results, rateLimited } = await M.runBulk(t.api, CHAT, "ban", [1, 2, 3, 4, 5, OWNER, 777000].map((user_id) => ({ user_id })),
    { deadline: Date.now() + 5000, protect: new Set([OWNER, BOT]), concurrency: 3 });
  assertEquals(rateLimited, false);
  const by = Object.fromEntries(results.map((r) => [r.user_id, r.status]));
  assertEquals(by, { 1: "ok", 2: "already", 3: "skipped", 4: "ok", 5: "skipped", [OWNER]: "skipped", 777000: "skipped" });
  assertEquals(t.of("banChatMember").map((c) => c.body.user_id).sort(), [1, 4], "only ordinary members are banned");
});

Deno.test("mass action: a rate limit stops the batch and leaves the rest pending", async () => {
  let bans = 0;
  const t = mockApi({ 1: { status: "member" }, 2: { status: "member" }, 3: { status: "member" } }, {
    banChatMember: () => (++bans >= 2 ? { ok: false, error_code: 429, parameters: { retry_after: 30 } } : { ok: true, result: true }),
  });
  const { results, rateLimited } = await M.runBulk(t.api, CHAT, "ban", [1, 2, 3].map((user_id) => ({ user_id })), { deadline: Date.now() + 5000, protect: new Set(), concurrency: 1 });
  assertEquals(rateLimited, true);
  assertEquals(results, [{ user_id: 1, status: "ok" }], "rate-limited users are not counted as failed");
});

Deno.test("mass kick and unban: kick skips users not in the group; undo uses only_if_banned", async () => {
  const t = mockApi({ 1: { status: "member" }, 2: { status: "left" } });
  const k = await M.runBulk(t.api, CHAT, "kick", [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }], { deadline: Date.now() + 5000, protect: new Set() });
  assertEquals(Object.fromEntries(k.results.map((r) => [r.user_id, r.status])), { 1: "ok", 2: "skipped", 3: "skipped" });
  const u = mockApi();
  const un = await M.runBulk(u.api, CHAT, "unban", [{ user_id: 1 }, { user_id: 4 }], { deadline: Date.now() + 5000, protect: new Set() });
  assertEquals(un.results.every((r) => r.status === "ok"), true);
  assert(u.of("unbanChatMember").every((c) => c.body.only_if_banned === true));
  assertEquals(u.of("getChatMember").length, 0);
});

Deno.test("mass action: the deadline stops work instead of running forever", async () => {
  const t = mockApi({ 1: { status: "member" } });
  const r = await M.runBulk(t.api, CHAT, "ban", [{ user_id: 1 }], { deadline: Date.now() - 1, protect: new Set() });
  assertEquals(r.results.length, 0);
});

Deno.test("confirmation phrase and id lists", () => {
  assertEquals(M.bulkPhrase("ban", "all", -100123), "ВСЕМ БАН -100123");
  assertEquals(M.bulkPhrase("mute", "d1", -100123), "МУТ -100123");
  assert(M.samePhrase("  всем   бан -100123 ", "ВСЕМ БАН -100123"));
  assert(!M.samePhrase("всем бан", "ВСЕМ БАН -100123"), "the group id is required");
  assert(!M.samePhrase("ВСЕМ БАН -100124", "ВСЕМ БАН -100123"));
  assertEquals(M.parseIds("123456, 123456 9876543 abc 12"), [123456, 9876543]);
  assertEquals(M.parseIds(Array.from({ length: 600 }, (_, i) => 100000 + i).join(" ")).length, 500);
});

Deno.test("separation: the moderation core has no game or database calls", async () => {
  const core = await Deno.readTextFile(new URL("./moderation.ts", import.meta.url));
  for (const word of ["wallet", "ledger", "tg_rpc", "supabase", "profiles", "admin_roles"]) assert(!core.includes(word), `moderation.ts mentions ${word}`);
  // The bot side of moderation never calls game RPCs or touches game tables.
  const io = await Deno.readTextFile(new URL("../telegram-bot/mod.ts", import.meta.url));
  for (const word of ["wallet", "ledger", "tg_rpc", "\"profiles\"", "admin_set_status", "admin_adjust", "call(ctx"]) assert(!io.includes(word), `mod.ts mentions ${word}`);
});
