// Group moderation for the BAYHAN GAME owner: reply commands in groups («бан 7д Реклама», «мут 1ч»),
// the panel in the private chat («модерация»), mass actions run by the pg_cron timer, and auto-deleted
// notices. Only Telegram group rights change here: game accounts, balances and game bans are never
// touched (game administration lives in admin.ts). Every entry checks the owner on the server side.
import * as M from "../_shared/moderation.ts";
import { admin, BOT_USERNAME, config, rpc, tg } from "../_shared/telegram.ts";
import { type Buttons, type Ctx, edit, esc, send } from "./ctx.ts";
import { waitUntil } from "./games.ts";

const api: M.Api = (method, body) => tg(method, body);
const db = () => admin();
const b = (text: string, data: string) => ({ text, callback_data: data });
const date = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

let botIdCache = 0;
async function botId() {
  if (!botIdCache) botIdCache = Number(String((await config()).bot_token).split(":")[0]);
  return botIdCache;
}
export const isOwner = (tgId: number) => rpc<boolean>("tg_mod_is_owner", { p_tg: tgId });

type Settings = { silent: boolean; delete_target: boolean; default_mute: number; notice_seconds: number };
const DEFAULTS: Settings = { silent: true, delete_target: true, default_mute: 3600, notice_seconds: 10 };
async function settings(chatId: number): Promise<Settings> {
  const { data } = await db().from("tg_mod_settings").select("silent, delete_target, default_mute, notice_seconds").eq("chat_id", chatId).maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) };
}

/** A short message in the group that the timer deletes after `seconds`. */
async function notice(chatId: number, text: string, seconds: number, buttons?: Buttons) {
  const r = await send(chatId, text, buttons);
  const id = r?.result?.message_id;
  if (id) await db().from("tg_mod_autodelete").upsert({ chat_id: chatId, message_id: id, delete_at: new Date(Date.now() + seconds * 1000).toISOString() });
}
const delMsg = (chatId: number, id?: number) => (id ? M.call(api, "deleteMessage", { chat_id: chatId, message_id: id }) : Promise.resolve({ ok: false }));

type LogRow = { chat_id: number; target_id?: number | null; moderator_id: number; action: string; status: "ok" | "failed";
  duration_seconds?: number | null; count?: number; reason?: string | null; error?: string | null; expires_at?: string | null; op_key?: string };
async function log(row: LogRow) {
  const { error } = await db().from("tg_mod_actions").upsert(row, { onConflict: "op_key", ignoreDuplicates: true });
  if (error) console.warn("mod log:", error.message);
}
async function setStatus(chatId: number, userId: number, status: string) {
  await db().from("tg_chat_members").update({ status, status_at: new Date().toISOString() }).eq("chat_id", chatId).eq("telegram_id", userId);
}
async function knownName(chatId: number, userId: number) {
  const { data } = await db().from("tg_chat_members").select("first_name, username").eq("chat_id", chatId).eq("telegram_id", userId).maybeSingle();
  return data?.first_name || (data?.username ? `@${data.username}` : `ID ${userId}`);
}
const who = (t: M.Target) => `<a href="tg://user?id=${t.id}">${esc(t.name)}</a>`;

/** Permissions an unmuted user gets back: saved ones while the chat is closed, else the group's own. */
async function restorePerms(chatId: number): Promise<Record<string, boolean>> {
  const { data: lock } = await db().from("tg_mod_locks").select("locked, saved_permissions").eq("chat_id", chatId).maybeSingle();
  if (lock?.locked && lock.saved_permissions) return lock.saved_permissions;
  const chat = await M.call(api, "getChat", { chat_id: chatId });
  return chat.ok && chat.result?.permissions ? chat.result.permissions : M.DEFAULT_OPEN;
}

// --------------------------------------------------------- group commands ----
/**
 * A message in a group. Returns true when it was a moderation command of the owner. Other people's
 * «бан», «мут» … are not commands for them: the bot stays silent.
 */
// deno-lint-ignore no-explicit-any
export async function onGroupMessage(ctx: Ctx, msg: any, owner: boolean): Promise<boolean> {
  const cmd = M.parseMod(msg.text ?? "", BOT_USERNAME);
  if (!cmd || !owner) return false;
  const chatId = ctx.chat.id, me = ctx.from.id, bot = await botId();
  const s = await settings(chatId);
  const fail = async (text: string) => {
    await notice(chatId, `⚠️ ${text}`, Math.max(s.notice_seconds, 8));
    await delMsg(chatId, msg.message_id);
    return true;
  };

  if (cmd.op === "panel") {
    await notice(chatId, "🛡 Панель модерации открывается в личке бота.", 15, [[{ text: "🛡 Открыть панель", url: `https://t.me/${BOT_USERNAME}?start=mod` }]]);
    await delMsg(chatId, msg.message_id);
    return true;
  }
  if (cmd.error) return fail(cmd.error);
  const denied = await M.authorize(api, chatId, me, bot, M.NEED[cmd.op]);
  if (denied) return fail(denied);

  switch (cmd.op) {
    case "lock": case "unlock": {
      const r = await setLock(chatId, me, cmd.op === "lock");
      await delMsg(chatId, msg.message_id);
      if (!r.ok) await notice(chatId, `⚠️ ${r.text}`, 15);
      else await send(chatId, r.text);
      return true;
    }
    case "slow": {
      await notice(chatId, await slowText(chatId, cmd.arg), 30);
      await delMsg(chatId, msg.message_id);
      return true;
    }
    case "clean": {
      if (cmd.all) {
        const known = await knownCount(chatId);
        await delMsg(chatId, msg.message_id);
        if (!known) return await notice(chatId, "🧹 Бот не знает ни одного сообщения младше 48 часов — удалять нечего.", 10), true;
        const sid = await session(me, chatId, "clean", { n: "all" });
        await notice(chatId, `⚠️ <b>Удалить все сообщения?</b>\nБот удалит все ${known} сообщений, которые видел за последние 48 часов. Отменить это нельзя.\nКнопки действуют 2 минуты и только для владельца.`, 120,
          [[b("✅ Удалить все", `md:cy:${sid}`), b("✖️ Отмена", `md:cx:${sid}`)]]);
        return true;
      }
      const n = cmd.count!;
      if (n > M.CONFIRM_CLEAN_OVER) {
        const sid = await session(me, chatId, "clean", { n });
        await notice(chatId, `⚠️ Вы собираетесь удалить до ${n} сообщений. Продолжить?\nКнопки действуют 2 минуты и только для владельца.`, 120,
          [[b("✅ Подтвердить", `md:cy:${sid}`), b("✖️ Отмена", `md:cx:${sid}`)]]);
        await delMsg(chatId, msg.message_id);
        return true;
      }
      const text = await runCleanup(chatId, n, me);
      await notice(chatId, text, Math.max(s.notice_seconds, 10));
      return true;
    }
  }

  // Commands about one user: a reply, or an explicit Telegram id.
  let target: M.Target | null = null;
  if (cmd.targetId) {
    const bad = M.checkTargetId(cmd.targetId, me, bot);
    if (bad) return fail(bad.error);
    target = { id: cmd.targetId, name: await knownName(chatId, cmd.targetId) };
  } else {
    const t = M.replyTarget(msg, me, bot);
    if (t && "error" in t) return fail(t.error);
    target = t;
  }
  if (!target) {
    // "кик это было смешно" without a reply is just chat; a bare command gets a hint.
    if ((msg.text ?? "").trim().split(/\s+/).length > 3) return false;
    return fail(cmd.op === "del" ? "Ответьте «дел» на сообщение, которое нужно удалить." : "Ответьте этой командой на сообщение нарушителя (или укажите ID: «разбан 123456789»).");
  }
  if (cmd.op !== "del" && await isOwner(target.id)) return fail("Владельца BAYHAN GAME наказывать нельзя.");
  if (["ban", "mute", "kick", "warn"].includes(cmd.op)) {
    const p = await M.protectedTarget(api, chatId, target.id);
    if (p.error) return fail(p.error);
  }
  const opKey = `mod-${chatId}-${ctx.updateId}`;
  const replyId: number | undefined = msg.reply_to_message?.message_id;

  switch (cmd.op) {
    case "del": {
      const r = await delMsg(chatId, replyId);
      await log({ chat_id: chatId, target_id: target.id, moderator_id: me, action: "delete", count: r.ok ? 1 : 0, status: r.ok ? "ok" : "failed", error: r.ok ? null : (r as M.TgResult).description ?? null, op_key: opKey });
      if (!r.ok) return fail(M.tgError(r as M.TgResult));
      await delMsg(chatId, msg.message_id);
      return true;
    }
    case "warn": {
      await db().from("tg_mod_warnings").insert({ chat_id: chatId, user_id: target.id, moderator_id: me, reason: cmd.reason ?? null });
      const { count } = await db().from("tg_mod_warnings").select("id", { count: "exact", head: true }).eq("chat_id", chatId).eq("user_id", target.id).eq("active", true);
      await log({ chat_id: chatId, target_id: target.id, moderator_id: me, action: "warn", status: "ok", reason: cmd.reason ?? null, op_key: opKey });
      await delMsg(chatId, msg.message_id);
      if (!s.silent) await notice(chatId, `⚠️ ${who(target)}: предупреждение ${count}/3${cmd.reason ? `. Причина: ${esc(cmd.reason)}` : ""}`, Math.max(s.notice_seconds, 10));
      if ((count ?? 0) >= 3) await warnAlert(me, chatId, ctx.chat.title ?? "", target, count ?? 3);
      return true;
    }
    case "warns": {
      const { data } = await db().from("tg_mod_warnings").select("reason, created_at").eq("chat_id", chatId).eq("user_id", target.id).eq("active", true).order("created_at", { ascending: false }).limit(10);
      await delMsg(chatId, msg.message_id);
      const list = (data ?? []).map((w, i) => `${i + 1}. ${date(w.created_at)} — ${esc(w.reason ?? "без причины")}`).join("\n");
      await notice(chatId, `⚠️ ${who(target)}: предупреждений ${data?.length ?? 0}${list ? `\n${list}` : ""}`, 30);
      return true;
    }
    case "unwarn": {
      const { data } = await db().from("tg_mod_warnings").select("id").eq("chat_id", chatId).eq("user_id", target.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      await delMsg(chatId, msg.message_id);
      if (!data) return await notice(chatId, `У ${who(target)} нет предупреждений.`, 10), true;
      await db().from("tg_mod_warnings").update({ active: false }).eq("id", data.id);
      await log({ chat_id: chatId, target_id: target.id, moderator_id: me, action: "unwarn", status: "ok", op_key: opKey });
      if (!s.silent) await notice(chatId, `✅ ${who(target)}: одно предупреждение снято.`, s.notice_seconds);
      return true;
    }
  }

  // ban / unban / mute / unmute / kick
  const op = cmd.op as "ban" | "unban" | "mute" | "unmute" | "kick";
  const seconds = op === "mute" ? (cmd.seconds === undefined ? s.default_mute : cmd.seconds) : op === "ban" ? cmd.seconds ?? null : null;
  const r = await M.act(api, chatId, op, target.id, seconds, op === "unmute" ? await restorePerms(chatId) : undefined);
  await log({
    chat_id: chatId, target_id: target.id, moderator_id: me, action: op, status: r.ok ? "ok" : "failed", duration_seconds: seconds,
    reason: cmd.reason ?? null, error: r.ok ? null : r.description ?? null, op_key: opKey,
    expires_at: (op === "ban" || op === "mute") && seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null,
  });
  if (!r.ok) return fail(M.tgError(r));
  await setStatus(chatId, target.id, { ban: "kicked", unban: "left", mute: "restricted", unmute: "member", kick: "left" }[op]);
  if (s.delete_target && replyId && (op === "ban" || op === "mute" || op === "kick")) await delMsg(chatId, replyId);
  await delMsg(chatId, msg.message_id);
  if (!s.silent) {
    const text = {
      ban: `🚫 ${who(target)} заблокирован(а) ${seconds ? `на ${M.fmtDuration(seconds)}` : "навсегда"}`,
      unban: `✅ ${who(target)} разблокирован(а)`,
      mute: `🔇 ${who(target)} без права писать ${seconds ? `на ${M.fmtDuration(seconds)}` : "навсегда"}`,
      unmute: `🔊 ${who(target)} снова может писать`,
      kick: `👢 ${who(target)} удалён(а) из группы`,
    }[op];
    await notice(chatId, `${text}${cmd.reason ? `. Причина: ${esc(cmd.reason)}` : ""}`, s.notice_seconds);
  }
  return true;
}

/** Third warning: tell the owner privately; nothing is punished automatically. */
async function warnAlert(ownerId: number, chatId: number, title: string, t: M.Target, count: number) {
  await send(ownerId, `⚠️ <b>${count} предупреждения</b> у ${who(t)} в группе «${esc(title)}».\nАвтоматических наказаний нет — решите сами:`, [
    [b("🚫 Бан", `md:q:${chatId}:${t.id}:b`), b("🔇 Мут 1 д", `md:q:${chatId}:${t.id}:m`)],
    [b("♻️ Сбросить предупреждения", `md:q:${chatId}:${t.id}:r`)],
  ]);
}

async function session(owner: number, chatId: number, kind: string, data: Record<string, unknown>, minutes = 2) {
  const { data: row, error } = await db().from("tg_mod_sessions")
    .insert({ owner_tg: owner, chat_id: chatId, kind, data, expires_at: new Date(Date.now() + minutes * 60_000).toISOString() }).select("id").single();
  if (error) throw new Error(error.message);
  return row.id as string;
}
async function takeSession(id: string, owner: number, kind: string) {
  const { data } = await db().from("tg_mod_sessions").delete().eq("id", id).eq("owner_tg", owner).eq("kind", kind).gt("expires_at", new Date().toISOString()).select("chat_id, data").maybeSingle();
  return data as { chat_id: number; data: any } | null;
}

// ------------------------------------------------------------ chat controls ----
async function setLock(chatId: number, me: number, on: boolean): Promise<{ ok: boolean; text: string }> {
  const { data: cur } = await db().from("tg_mod_locks").select("locked, saved_permissions").eq("chat_id", chatId).maybeSingle();
  if (on) {
    if (cur?.locked) return { ok: false, text: "Чат уже закрыт. Открыть: «открыть чат»." };
    const chat = await M.call(api, "getChat", { chat_id: chatId });
    if (!chat.ok) return { ok: false, text: M.tgError(chat) };
    const saved = chat.result?.permissions ?? M.DEFAULT_OPEN;
    const r = await M.call(api, "setChatPermissions", { chat_id: chatId, permissions: M.NO_PERMS, use_independent_chat_permissions: true });
    await log({ chat_id: chatId, moderator_id: me, action: "lock", status: r.ok ? "ok" : "failed", error: r.ok ? null : r.description ?? null });
    if (!r.ok) return { ok: false, text: M.tgError(r) };
    await db().from("tg_mod_locks").upsert({ chat_id: chatId, locked: true, saved_permissions: saved, changed_by: me, changed_at: new Date().toISOString() });
    return { ok: true, text: "🔒 <b>Чат закрыт.</b> Писать могут только администраторы." };
  }
  if (!cur?.locked) return { ok: false, text: "Чат не был закрыт ботом. Закрыть: «закрыть чат»." };
  const perms = cur.saved_permissions ?? M.DEFAULT_OPEN;
  const r = await M.call(api, "setChatPermissions", { chat_id: chatId, permissions: perms, use_independent_chat_permissions: true });
  await log({ chat_id: chatId, moderator_id: me, action: "unlock", status: r.ok ? "ok" : "failed", error: r.ok ? null : r.description ?? null });
  if (!r.ok) return { ok: false, text: M.tgError(r) };
  await db().from("tg_mod_locks").upsert({ chat_id: chatId, locked: false, saved_permissions: null, changed_by: me, changed_at: new Date().toISOString() });
  return { ok: true, text: "🔓 <b>Чат открыт.</b> Права участников восстановлены как были." };
}

async function slowText(chatId: number, arg?: string) {
  const chat = await M.call(api, "getChat", { chat_id: chatId });
  const cur = chat.ok ? Number(chat.result?.slow_mode_delay ?? 0) : null;
  const values = M.SLOW_VALUES.slice(1).map((v) => M.fmtDuration(v)).join(", ");
  return `⏱ <b>Медленный режим</b>: ${cur === null ? "не удалось узнать" : cur ? M.fmtDuration(cur) : "выключен"}.\n\n` +
    `Telegram не даёт ботам включать медленный режим — только читать его. Включите его в группе: ` +
    `Управление группой → Разрешения → Медленный режим. Доступные значения: ${values}.` +
    (arg ? `\n\nКоманда «слоумод ${esc(arg)}» поэтому ничего не меняет.` : "");
}

const cleanSince = () => new Date(Date.now() - 47.5 * 3600e3).toISOString();
async function knownCount(chatId: number) {
  const { count } = await db().from("tg_mod_messages").select("message_id", { count: "exact", head: true }).eq("chat_id", chatId).gte("observed_at", cleanSince());
  return count ?? 0;
}

/** Deletes up to n (or "all") of the newest messages the bot has seen in the last 48 hours. */
async function runCleanup(chatId: number, n: number | "all", me: number) {
  const limit = n === "all" ? M.MAX_CLEAN_ALL : n;
  const ids: number[] = [];
  // The API returns at most 1000 rows per request, so read in pages.
  for (let from = 0; from < limit; from += 1000) {
    const { data } = await db().from("tg_mod_messages").select("message_id").eq("chat_id", chatId).gte("observed_at", cleanSince())
      .order("message_id", { ascending: false }).range(from, Math.min(limit, from + 1000) - 1);
    ids.push(...(data ?? []).map((r) => Number(r.message_id)));
    if ((data?.length ?? 0) < 1000) break;
  }
  const r = await M.deleteMany(api, chatId, ids);
  for (let i = 0; i < ids.length; i += 200) await db().from("tg_mod_messages").delete().eq("chat_id", chatId).in("message_id", ids.slice(i, i + 200));
  await log({ chat_id: chatId, moderator_id: me, action: "cleanup", count: r.deleted, status: r.failed && !r.deleted ? "failed" : "ok" });
  const more = n === "all" && ids.length >= M.MAX_CLEAN_ALL ? await knownCount(chatId) : 0;
  return `🧹 <b>Очистка</b>: ${n === "all" ? "все сообщения" : `запрошено ${n}`}, известно боту ${ids.length}. ` +
    `${r.exact ? `Удалено ${r.deleted}` : `Удалено до ${r.deleted}`}${r.failed ? `, не удалось ${r.failed}` : ""}.` +
    (more ? `\nОсталось ещё ${more} — повторите команду.` : "") +
    (n === "all" || ids.length < n ? `\nБот удаляет только сообщения, которые сам видел за последние 48 часов: более старые Telegram удалять не даёт, а историю до добавления бота он не видит.` : "") +
    (!r.exact && ids.length ? `\nTelegram удаляет пачками и не сообщает, какие сообщения уже были удалены.` : "");
}

// --------------------------------------------------------------- the panel ----
type Screen = { text: string; kb: Buttons };
async function show(ctx: Ctx, s: Screen, messageId?: number) {
  if (messageId) {
    const r = await edit(ctx.chat.id, messageId, s.text, s.kb);
    if (r?.ok || String(r?.description ?? "").includes("not modified")) return;
  }
  await send(ctx.chat.id, s.text, s.kb);
}
const HEAD = "🛡 <b>BAYHAN GAME | Модерация</b>";
const toGroup = (c: number) => [b("⬅️ К группе", `md:g:${c}`), b("🏠 Группы", "md:home")];

/** «модерация» in the private chat. False when the sender is not the owner (the command does not exist). */
export async function panel(ctx: Ctx, messageId?: number): Promise<boolean> {
  if (!ctx.isPrivate || !(await isOwner(ctx.from.id))) return false;
  await show(ctx, await groupsScreen(), messageId);
  return true;
}

async function groupsScreen(): Promise<Screen> {
  const { data } = await db().from("tg_chats").select("chat_id, title").eq("active", true).in("type", ["group", "supergroup"])
    .order("last_seen_at", { ascending: false }).limit(30);
  const kb: Buttons = (data ?? []).map((c) => [b(`👥 ${String(c.title || c.chat_id).slice(0, 40)}`, `md:g:${c.chat_id}`)]);
  return {
    text: `${HEAD}\n\n${data?.length ? "Выберите группу:" : "Бот пока не состоит ни в одной группе. Добавьте его в группу и сделайте администратором."}`,
    kb: kb.length ? kb : [[{ text: "➕ Добавить бота в группу", url: `https://t.me/${BOT_USERNAME}?startgroup=mod` } as never]],
  };
}

const mark = (v: boolean) => (v ? "✅" : "❌");
async function groupScreen(chatId: number, me: number): Promise<Screen> {
  const bot = await botId();
  const [chat, o, bm, lock, st] = await Promise.all([
    M.call(api, "getChat", { chat_id: chatId }),
    M.member(api, chatId, me, false), M.member(api, chatId, bot, false),
    db().from("tg_mod_locks").select("locked").eq("chat_id", chatId).maybeSingle(),
    rpc<any>("tg_mod_stats", { p_chat: chatId }),
  ]);
  const title = chat.ok ? chat.result.title : String(chatId);
  const locked = Boolean(lock.data?.locked);
  const text = `${HEAD}\n<b>${esc(title)}</b>\n\n` +
    `🤖 Бот: ${mark(M.hasRight(bm, "restrict"))} блокировка · ${mark(M.hasRight(bm, "delete"))} удаление сообщений\n` +
    `👤 Вы: ${M.hasRight(o, "admin") ? "администратор группы" : "не администратор группы — это не нужно, работает по правам бота"}\n` +
    `💬 Чат: ${locked ? "🔒 закрыт" : "открыт"} · известно участников: ${st?.members ?? 0} · наказаний действует: ${st?.active ?? 0}\n\n` +
    `В группе: ответьте на сообщение «бан», «бан 7д Реклама», «мут 1ч», «кик», «дел», «варн».`;
  return {
    text,
    kb: [
      [b("🔨 Наказания", `md:pn:${chatId}`), b("👥 Участники", `md:mb:${chatId}`)],
      [b("🧹 Очистка сообщений", `md:cm:${chatId}`), locked ? b("🔓 Открыть чат", `md:lk:${chatId}:0`) : b("🔒 Закрыть чат", `md:lk:${chatId}:1`)],
      [b("⏱ Медленный режим", `md:sl:${chatId}`), b("⚠️ Предупреждения", `md:wn:${chatId}`)],
      [b("📊 Статистика", `md:st:${chatId}`), b("📜 История действий", `md:hs:${chatId}`)],
      [b("👥 Массовые действия", `md:ms:${chatId}`), b("🚫 Всем бан", `md:bx:${chatId}:ban:all`)],
      [b("⚙️ Настройки", `md:se:${chatId}`), b("🏠 Группы", "md:home")],
    ],
  };
}

async function punishmentsScreen(chatId: number): Promise<Screen> {
  const a = await rpc<any>("tg_mod_active", { p_chat: chatId });
  const items: any[] = a?.items ?? [];
  const text = `🔨 <b>Действующие наказания</b> (${a?.total ?? 0})\n\n` + (items.length
    ? items.slice(0, 15).map((x) => `• ${esc(x.name)} — ${x.action === "ban" ? "бан" : "мут"} ${x.expires_at ? `до ${date(x.expires_at)}` : "навсегда"}${x.reason ? ` (${esc(x.reason)})` : ""}`).join("\n")
    : "Сейчас никого.") + (Number(a?.total) > 15 ? `\n… и ещё ${Number(a.total) - 15}` : "");
  const kb: Buttons = items.slice(0, 8).map((x) => [b(`✅ Снять: ${String(x.name).slice(0, 24)}`, `md:un:${chatId}:${x.user_id}:${x.action === "ban" ? "b" : "m"}`)]);
  kb.push(toGroup(chatId));
  return { text, kb };
}

async function membersScreen(chatId: number): Promise<Screen> {
  const now = Date.now();
  const q = () => db().from("tg_chat_members").select("telegram_id", { count: "exact", head: true }).eq("chat_id", chatId).not("status", "in", "(left,kicked)");
  const [all, d1, d7, recent] = await Promise.all([
    q(), q().gte("last_seen_at", new Date(now - 86400e3).toISOString()), q().gte("last_seen_at", new Date(now - 7 * 86400e3).toISOString()),
    db().from("tg_chat_members").select("telegram_id, first_name, username, status, last_seen_at").eq("chat_id", chatId).order("last_seen_at", { ascending: false }).limit(12),
  ]);
  const ST: Record<string, string> = { member: "", restricted: " 🔇", kicked: " 🚫", left: " (вышел)", administrator: " 🛡", creator: " 👑" };
  return {
    text: `👥 <b>Участники, известные боту</b>\n\nВсего: ${all.count ?? 0} · активны за 24 ч: ${d1.count ?? 0} · за 7 дней: ${d7.count ?? 0}\n\n` +
      (recent.data ?? []).map((m) => `• ${esc(m.first_name || (m.username ? "@" + m.username : m.telegram_id))} <code>${m.telegram_id}</code>${ST[m.status] ?? ""} — ${date(m.last_seen_at)}`).join("\n") +
      `\n\nTelegram не даёт ботам полный список участников: бот знает тех, кто писал, входил или выходил при нём.`,
    kb: [toGroup(chatId)],
  };
}

async function statsScreen(chatId: number): Promise<Screen> {
  const s = await rpc<any>("tg_mod_stats", { p_chat: chatId });
  const { data: bulks } = await db().from("tg_mod_bulk").select("action, scope, ok, failed, skipped, total, status, created_at").eq("chat_id", chatId)
    .in("status", ["done", "stopped", "running"]).order("created_at", { ascending: false }).limit(5);
  return {
    text: `📊 <b>Статистика модерации</b>\n\n🚫 Баны навсегда: ${s.bans} · временные: ${s.tempbans}\n🔇 Муты: ${s.mutes} · 👢 Кики: ${s.kicks}\n` +
      `🗑 Удалено сообщений: ${s.deleted} · ⚠️ Предупреждений: ${s.warns}\n⛔ Неудачных действий: ${s.failed}\n` +
      `🔨 Действует наказаний: ${s.active} · 👥 известно участников: ${s.members}\n\n<b>Массовые операции</b> (${s.bulk}):\n` +
      ((bulks ?? []).map((x) => `• ${date(x.created_at)} ${BULK_NAME[x.action]} — ✅ ${x.ok} · ⛔ ${x.failed} · ⏭ ${x.skipped} из ${x.total} (${BULK_STATUS[x.status]})`).join("\n") || "нет"),
    kb: [toGroup(chatId)],
  };
}

const ACTION_NAME: Record<string, string> = {
  ban: "🚫 бан", unban: "✅ разбан", mute: "🔇 мут", unmute: "🔊 размут", kick: "👢 кик", delete: "🗑 удаление", warn: "⚠️ варн",
  unwarn: "♻️ снят варн", warnreset: "♻️ сброс варнов", lock: "🔒 закрыт чат", unlock: "🔓 открыт чат", cleanup: "🧹 очистка",
};
async function historyScreen(chatId: number, page: number): Promise<Screen> {
  const { data } = await db().from("tg_mod_actions").select("target_id, action, status, duration_seconds, count, reason, created_at, bulk_id")
    .eq("chat_id", chatId).order("id", { ascending: false }).range(page * 15, page * 15 + 15);
  const rows = (data ?? []).slice(0, 15);
  const ids = [...new Set(rows.map((r) => r.target_id).filter(Boolean))];
  const { data: names } = ids.length ? await db().from("tg_chat_members").select("telegram_id, first_name, username").eq("chat_id", chatId).in("telegram_id", ids) : { data: [] };
  const nm = new Map((names ?? []).map((n: any) => [Number(n.telegram_id), n.first_name || (n.username ? "@" + n.username : null)]));
  const kb: Buttons = [];
  const nav = [];
  if (page > 0) nav.push(b("⬅️", `md:hs:${chatId}:${page - 1}`));
  if ((data ?? []).length > 15) nav.push(b("➡️", `md:hs:${chatId}:${page + 1}`));
  if (nav.length) kb.push(nav);
  kb.push(toGroup(chatId));
  return {
    text: `📜 <b>История действий</b>\n\n` + (rows.map((r) =>
      `${date(r.created_at)} ${ACTION_NAME[r.action] ?? r.action}${r.target_id ? ` ${esc(nm.get(Number(r.target_id)) ?? r.target_id)}` : ""}` +
      `${r.duration_seconds ? ` ${M.fmtDuration(r.duration_seconds)}` : ""}${r.count != null && r.action === "cleanup" ? ` (${r.count})` : ""}` +
      `${r.bulk_id ? " · массово" : ""}${r.status === "failed" ? " ⛔ ошибка" : ""}${r.reason && !r.bulk_id ? ` — ${esc(r.reason)}` : ""}`).join("\n") || "Пока пусто."),
    kb,
  };
}

async function warnsScreen(chatId: number): Promise<Screen> {
  const list: any[] = await rpc("tg_mod_warn_list", { p_chat: chatId });
  const kb: Buttons = list.slice(0, 8).map((w) => [b(`♻️ Сбросить: ${String(w.name).slice(0, 24)} (${w.count})`, `md:wr:${chatId}:${w.user_id}`)]);
  kb.push(toGroup(chatId));
  return {
    text: `⚠️ <b>Предупреждения</b>\n\n` + (list.map((w) => `• ${esc(w.name)} — ${w.count}`).join("\n") || "Ни у кого нет.") +
      `\n\nВ группе: «варн причина», «варны», «снятьварн» (ответом). После третьего предупреждения бот напишет вам; сам он никого не наказывает.`,
    kb,
  };
}

async function settingsScreen(chatId: number): Promise<Screen> {
  const s = await settings(chatId);
  return {
    text: `⚙️ <b>Настройки модерации</b>\n\n🤫 Тихий режим: ${s.silent ? "вкл — после успешного действия в чате ничего не пишется" : "выкл — короткое уведомление, которое само удаляется"}\n` +
      `🗑 Удалять сообщение нарушителя при бане, муте и кике: ${s.delete_target ? "да" : "нет"}\n🔇 Мут по умолчанию: ${M.fmtDuration(s.default_mute)}\n` +
      `⏳ Уведомления удаляются через: ${s.notice_seconds} с`,
    kb: [
      [b(`🤫 Тихий режим: ${s.silent ? "выкл." : "вкл."}`, `md:sx:${chatId}:silent`)],
      [b(`🗑 Удалять сообщение: ${s.delete_target ? "нет" : "да"}`, `md:sx:${chatId}:del`)],
      [b("🔇 Мут по умолчанию: сменить", `md:sx:${chatId}:mute`), b("⏳ Время уведомлений", `md:sx:${chatId}:notice`)],
      toGroup(chatId),
    ],
  };
}

const MUTE_STEPS = [300, 1800, 3600, 86400, 604800];
const NOTICE_STEPS = [5, 10, 30, 60];
async function toggleSetting(chatId: number, key: string) {
  const s = await settings(chatId);
  const next = (list: number[], v: number) => list[(list.indexOf(v) + 1) % list.length];
  const patch: Partial<Settings> = key === "silent" ? { silent: !s.silent } : key === "del" ? { delete_target: !s.delete_target }
    : key === "mute" ? { default_mute: next(MUTE_STEPS, s.default_mute) } : { notice_seconds: next(NOTICE_STEPS, s.notice_seconds) };
  const { error } = await db().from("tg_mod_settings").upsert({ chat_id: chatId, ...s, ...patch, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------- mass actions ----
const BULK_NAME: Record<string, string> = { ban: "🚫 бан", mute: "🔇 мут", kick: "👢 кик", unban: "↩️ разбан" };
const BULK_STATUS: Record<string, string> = { draft: "черновик", confirm: "ждёт подтверждения", running: "идёт", stopped: "остановлена", done: "завершена", cancelled: "отменена" };
const SCOPE_NAME: Record<string, string> = { all: "все известные участники", d1: "активные за 24 часа", d7: "активные за 7 дней", list: "список ID", undo: "отмена операции" };

function massScreen(chatId: number): Screen {
  return {
    text: `👥 <b>Массовые действия</b>\n\nВыберите действие. Цели — только участники, которых бот видел; админы, владелец группы, владелец BAYHAN GAME и сам бот исключаются всегда. Перед запуском — предпросмотр и двойное подтверждение.`,
    kb: [
      [b("🚫 Массовый бан", `md:ma:${chatId}:ban`)], [b("🔇 Массовый мут", `md:ma:${chatId}:mute`)], [b("👢 Массовый кик", `md:ma:${chatId}:kick`)],
      toGroup(chatId),
    ],
  };
}
function scopeScreen(chatId: number, action: string): Screen {
  return {
    text: `${BULK_NAME[action]} — <b>кого?</b>`,
    kb: [
      [b("Активные за 24 часа", `md:bx:${chatId}:${action}:d1`), b("Активные за 7 дней", `md:bx:${chatId}:${action}:d7`)],
      [b("Все известные участники", `md:bx:${chatId}:${action}:all`)],
      [b("✍️ Список Telegram ID", `md:bi:${chatId}:${action}`)],
      [b("⬅️ Назад", `md:ms:${chatId}`)],
    ],
  };
}

/** Ids that a mass action must never touch in this chat: its admins and creator, and the bot. */
async function protectedIds(chatId: number): Promise<Set<number>> {
  const r = await M.call(api, "getChatAdministrators", { chat_id: chatId });
  const ids = new Set<number>([await botId()]);
  for (const a of (r.ok ? r.result : []) as any[]) if (a?.user?.id) ids.add(Number(a.user.id));
  if (!r.ok) throw new Error("admins_unknown");
  for (const id of await rpc<number[]>("tg_mod_owner_ids", {})) ids.add(Number(id));
  return ids;
}

async function draftScreen(me: number, chatId: number, action: string, scope: string, ids: number[] | null): Promise<Screen> {
  const exclude = [...await protectedIds(chatId)];
  const s = await settings(chatId);
  const d = await rpc<any>("tg_mod_bulk_create", {
    p_owner: me, p_chat: chatId, p_action: action, p_scope: scope, p_ids: ids, p_exclude: exclude, p_seconds: action === "mute" ? s.default_mute : null,
  });
  const title = scope === "all" && action === "ban" ? "🚫 <b>Всем бан</b>" : `${BULK_NAME[action]} — <b>массово</b>`;
  if (!d.total) {
    return { text: `${title}\nГруппа: <b>${esc(d.title)}</b>\n\nПодходящих участников нет (${SCOPE_NAME[scope]}, без админов и защищённых).`, kb: [toGroup(chatId)] };
  }
  const verb = { ban: "заблокировано навсегда", mute: `лишено права писать на ${M.fmtDuration(s.default_mute)}`, kick: "удалено из группы" }[action as "ban"];
  return {
    text: `${title}\nГруппа: <b>${esc(d.title)}</b>\nКто: ${SCOPE_NAME[scope]}\n\n<b>Будет ${verb}: ${d.total}</b>\n` +
      `Первые: ${(d.preview as string[]).map(esc).join(", ")}${d.total > 10 ? " …" : ""}\n\n` +
      `Не затронуты: администраторы, владелец группы, владелец BAYHAN GAME, бот. Игровые аккаунты не меняются.\n` +
      `⚠️ Бот знает только участников, которых видел (писали, входили, выходили) — остальных Telegram ботам не показывает.\n\nШаг 1 из 2.`,
    kb: [[b("✅ Продолжить", `md:b1:${d.id}`), b("✖️ Отмена", `md:b0:${d.id}`)]],
  };
}

async function loadBulk(id: string, me: number) {
  const { data } = await db().from("tg_mod_bulk").select("*").eq("id", id).maybeSingle();
  if (!data || Number(data.initiated_by) !== me) throw new Error("forbidden");
  return data;
}

function progressScreen(x: any): Screen {
  const done = x.ok + x.failed + x.skipped;
  const kb: Buttons = [];
  if (x.status === "running") kb.push([b("⏹ Остановить", `md:bs:${x.id}`)]);
  if (x.action === "ban" && !x.undo_of && x.ok > 0 && (x.status === "done" || x.status === "stopped")) kb.push([b(`↩️ Отменить: разбанить ${x.ok}`, `md:bu:${x.id}`)]);
  kb.push(toGroup(Number(x.chat_id)));
  return {
    text: `${BULK_NAME[x.action]} · <b>${esc(x.chat_title ?? x.chat_id)}</b>\nСтатус: <b>${BULK_STATUS[x.status]}</b>\n\n` +
      `Обработано ${done} из ${x.total}\n✅ Успешно: ${x.ok}\n⏭ Пропущено: ${x.skipped} (админы, уже наказаны, не в группе)\n⛔ Ошибки: ${x.failed}` +
      (x.status === "running" ? "\n\nИдёт с учётом лимитов Telegram (около 20 человек в секунду). Можно закрыть — продолжится само." : "") +
      (x.undo_of ? "\n\nРазбанены только те, кого заблокировала исходная операция." : ""),
    kb,
  };
}

/** Processes a running mass action for up to `budgetMs`, then updates its progress message. */
export async function processBulk(id: string, budgetMs = 8000) {
  let { data: x } = await db().from("tg_mod_bulk").select("*").eq("id", id).maybeSingle();
  if (!x || x.status !== "running") return;
  const deadline = Date.now() + budgetMs;
  let protect: Set<number>;
  try {
    protect = await protectedIds(Number(x.chat_id));
  } catch {
    return; // admins unknown (bot lost rights?): do nothing rather than risk an admin
  }
  const restore = x.action === "unban" ? undefined : await restorePerms(Number(x.chat_id));
  while (Date.now() < deadline) {
    const { data: targets } = await db().from("tg_mod_bulk_targets").select("user_id").eq("bulk_id", id).eq("status", "pending").limit(40);
    if (!targets?.length) break;
    const r = await M.runBulk(api, Number(x.chat_id), x.action, targets, { deadline, protect, seconds: x.seconds, concurrency: 4, restore });
    if (r.results.length) x = await rpc<any>("tg_mod_bulk_report", { p_bulk: id, p_results: r.results });
    else if (!r.rateLimited) {
      ({ data: x } = await db().from("tg_mod_bulk").select("*").eq("id", id).maybeSingle());
    }
    if (!x || x.status !== "running" || r.rateLimited) break;
  }
  if (!x) return;
  if (x.status === "running") {
    const { count } = await db().from("tg_mod_bulk_targets").select("user_id", { count: "exact", head: true }).eq("bulk_id", id).eq("status", "pending");
    if (!count) ({ data: x } = await db().from("tg_mod_bulk").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id).eq("status", "running").select("*").single());
  }
  if (x?.panel_chat && x.panel_message) {
    const s = progressScreen(x);
    await edit(Number(x.panel_chat), Number(x.panel_message), s.text, s.kb);
  }
}

/** Typed input in the private chat for a moderation wizard (tg_admin_state kind mod_*). */
export async function onInput(ctx: Ctx, text: string, st: { kind: string; data: any }): Promise<boolean> {
  if (!st.kind.startsWith("mod_")) return false;
  await db().from("tg_admin_state").delete().eq("telegram_id", ctx.from.id);
  if (!(await isOwner(ctx.from.id))) return true;
  if (/^(отмена|cancel)$/i.test(text.trim())) {
    if (st.kind === "mod_phrase") await db().from("tg_mod_bulk").update({ status: "cancelled" }).eq("id", st.data.bulk).in("status", ["draft", "confirm"]);
    await send(ctx.chat.id, "Отменено.");
    return true;
  }
  if (st.kind === "mod_ids") {
    const ids = M.parseIds(text);
    if (!ids.length) return await send(ctx.chat.id, "Не нашёл ни одного Telegram ID. Откройте «модерация» и попробуйте снова."), true;
    const s = await draftScreen(ctx.from.id, Number(st.data.chat), st.data.action, "list", ids);
    await send(ctx.chat.id, s.text, s.kb);
    return true;
  }
  if (st.kind === "mod_phrase") {
    const x = await loadBulk(st.data.bulk, ctx.from.id);
    const expected = M.bulkPhrase(x.action, x.scope, Number(x.chat_id));
    if (x.status !== "confirm" || new Date(x.expires_at).getTime() < Date.now()) return await send(ctx.chat.id, "Подтверждение устарело. Начните заново."), true;
    if (!M.samePhrase(text, expected)) {
      await db().from("tg_mod_bulk").update({ status: "cancelled" }).eq("id", x.id);
      await send(ctx.chat.id, "Фраза не совпала — операция отменена, никто не наказан.");
      return true;
    }
    const denied = await M.authorize(api, Number(x.chat_id), ctx.from.id, await botId(), "restrict");
    if (denied) return await send(ctx.chat.id, `⚠️ ${denied}`), true;
    const r = await send(ctx.chat.id, "⏳ Запускаю…");
    const { data: started } = await db().from("tg_mod_bulk").update({ status: "running", started_at: new Date().toISOString(), panel_chat: ctx.chat.id, panel_message: r?.result?.message_id ?? null })
      .eq("id", x.id).eq("status", "confirm").select("*").single();
    if (started && r?.result?.message_id) {
      const s = progressScreen(started);
      await edit(ctx.chat.id, r.result.message_id, s.text, s.kb);
    }
    waitUntil(processBulk(x.id, 25_000).catch((e) => console.error("bulk:", e instanceof Error ? e.message : "unknown")));
    return true;
  }
  return true;
}

// ---------------------------------------------------------------- buttons ----
/** md:* buttons. Every press re-checks the caller is the owner; ids in the data are re-validated. */
export async function button(ctx: Ctx, data: string, messageId: number): Promise<string | null> {
  const me = ctx.from.id;
  if (!(await isOwner(me))) return "Только для владельца BAYHAN GAME.";
  const [, op, a1, a2, a3] = data.split(":");
  const chatId = Number(a1);
  const needChat = async (need: M.Need | null = "admin") => {
    if (!Number.isSafeInteger(chatId)) throw new Error("invalid_value");
    const { data: c } = await db().from("tg_chats").select("chat_id").eq("chat_id", chatId).eq("active", true).maybeSingle();
    if (!c) throw new Error("target_not_found");
    const denied = await M.authorize(api, chatId, me, await botId(), need);
    if (denied) throw new Error(`denied:${denied}`);
  };
  try {
    switch (op) {
      case "home": await show(ctx, await groupsScreen(), messageId); return null;
      case "g": await needChat(null); await show(ctx, await groupScreen(chatId, me), messageId); return null;
      case "pn": await needChat(); await show(ctx, await punishmentsScreen(chatId), messageId); return null;
      case "mb": await needChat(); await show(ctx, await membersScreen(chatId), messageId); return null;
      case "st": await needChat(); await show(ctx, await statsScreen(chatId), messageId); return null;
      case "hs": await needChat(); await show(ctx, await historyScreen(chatId, Math.max(0, Number(a2) || 0)), messageId); return null;
      case "wn": await needChat(); await show(ctx, await warnsScreen(chatId), messageId); return null;
      case "se": await needChat(); await show(ctx, await settingsScreen(chatId), messageId); return null;
      case "sx": await needChat(); await toggleSetting(chatId, a2); await show(ctx, await settingsScreen(chatId), messageId); return "Сохранено";
      case "sl": await needChat(); await show(ctx, { text: await slowText(chatId), kb: [toGroup(chatId)] }, messageId); return null;
      case "ms": await needChat("restrict"); await show(ctx, massScreen(chatId), messageId); return null;
      case "ma": await needChat("restrict"); if (!["ban", "mute", "kick"].includes(a2)) throw new Error("invalid_value"); await show(ctx, scopeScreen(chatId, a2), messageId); return null;
      case "lk": {
        await needChat("restrict");
        const r = await setLock(chatId, me, a2 === "1");
        if (r.ok) await send(chatId, r.text);
        await show(ctx, await groupScreen(chatId, me), messageId);
        return r.ok ? (a2 === "1" ? "Чат закрыт" : "Чат открыт") : r.text;
      }
      case "un": {
        await needChat("restrict");
        const uid = Number(a2);
        const opName = a3 === "b" ? "unban" : "unmute";
        const r = await M.act(api, chatId, opName, uid, null, opName === "unmute" ? await restorePerms(chatId) : undefined);
        await log({ chat_id: chatId, target_id: uid, moderator_id: me, action: opName, status: r.ok ? "ok" : "failed", error: r.ok ? null : r.description ?? null });
        if (r.ok) await setStatus(chatId, uid, opName === "unban" ? "left" : "member");
        await show(ctx, await punishmentsScreen(chatId), messageId);
        return r.ok ? "Снято" : M.tgError(r);
      }
      case "wr": {
        await needChat();
        await db().from("tg_mod_warnings").update({ active: false }).eq("chat_id", chatId).eq("user_id", Number(a2)).eq("active", true);
        await log({ chat_id: chatId, target_id: Number(a2), moderator_id: me, action: "warnreset", status: "ok" });
        await show(ctx, await warnsScreen(chatId), messageId);
        return "Предупреждения сброшены";
      }
      case "q": {
        // From the third-warning message: ban, mute for a day, or reset.
        const uid = Number(a2);
        if (a3 === "r") {
          await needChat();
          await db().from("tg_mod_warnings").update({ active: false }).eq("chat_id", chatId).eq("user_id", uid).eq("active", true);
          await log({ chat_id: chatId, target_id: uid, moderator_id: me, action: "warnreset", status: "ok" });
          await edit(ctx.chat.id, messageId, "♻️ Предупреждения сброшены.");
          return null;
        }
        await needChat("restrict");
        if (await isOwner(uid)) return "Владельца BAYHAN GAME наказывать нельзя.";
        const p = await M.protectedTarget(api, chatId, uid);
        if (p.error) return p.error;
        const opName = a3 === "b" ? "ban" : "mute";
        const secs = opName === "mute" ? 86400 : null;
        const r = await M.act(api, chatId, opName, uid, secs);
        await log({ chat_id: chatId, target_id: uid, moderator_id: me, action: opName, status: r.ok ? "ok" : "failed", duration_seconds: secs, reason: "3 предупреждения",
          error: r.ok ? null : r.description ?? null, expires_at: secs ? new Date(Date.now() + secs * 1000).toISOString() : null });
        if (!r.ok) return M.tgError(r);
        await setStatus(chatId, uid, opName === "ban" ? "kicked" : "restricted");
        await edit(ctx.chat.id, messageId, opName === "ban" ? "🚫 Заблокирован(а) навсегда." : "🔇 Мут на 1 день.");
        return null;
      }
      case "cm": {
        await needChat("delete");
        await show(ctx, {
          text: `🧹 <b>Очистка сообщений</b>\n\nБот удаляет самые новые сообщения, которые сам видел за последние 48 часов (старше Telegram удалять не даёт). В группе: «очистить 50».`,
          kb: [[b("10", `md:cn:${chatId}:10`), b("50", `md:cn:${chatId}:50`), b("100", `md:cn:${chatId}:100`), b("500", `md:cn:${chatId}:500`)],
            [b("🗑 Удалить все сообщения", `md:cn:${chatId}:all`)], toGroup(chatId)],
        }, messageId);
        return null;
      }
      case "cn": {
        await needChat("delete");
        if (a2 === "all") {
          const known = await knownCount(chatId);
          if (!known) return "Бот не знает ни одного сообщения младше 48 часов.";
          const sid = await session(me, chatId, "clean", { n: "all" });
          await show(ctx, { text: `⚠️ <b>Удалить все сообщения?</b>\nБот удалит все ${known} сообщений группы, которые видел за последние 48 часов. Отменить это нельзя.\nПодтверждение действует 2 минуты.`, kb: [[b("✅ Удалить все", `md:cy:${sid}`), b("✖️ Отмена", `md:cx:${sid}`)]] }, messageId);
          return null;
        }
        const n = Math.min(M.MAX_CLEAN, Math.max(1, Number(a2) || 0));
        if (n <= M.CONFIRM_CLEAN_OVER) {
          await show(ctx, { text: await runCleanup(chatId, n, me), kb: [toGroup(chatId)] }, messageId);
          return null;
        }
        const sid = await session(me, chatId, "clean", { n });
        await show(ctx, { text: `⚠️ Вы собираетесь удалить до ${n} сообщений. Продолжить?\nПодтверждение действует 2 минуты.`, kb: [[b("✅ Подтвердить", `md:cy:${sid}`), b("✖️ Отмена", `md:cx:${sid}`)]] }, messageId);
        return null;
      }
      case "cy": case "cx": {
        const sess = await takeSession(a1, me, "clean");
        if (!sess) return "Подтверждение устарело или уже использовано.";
        const cid = Number(sess.chat_id);
        if (op === "cx") {
          if (ctx.isPrivate) await show(ctx, await groupScreen(cid, me), messageId);
          else await delMsg(ctx.chat.id, messageId);
          return "Отменено";
        }
        const denied = await M.authorize(api, cid, me, await botId(), "delete");
        if (denied) return denied;
        const n: number | "all" = sess.data.n === "all" ? "all" : Number(sess.data.n);
        const finish = async () => {
          const text = await runCleanup(cid, n, me);
          if (ctx.isPrivate) await show(ctx, { text, kb: [toGroup(cid)] }, messageId);
          else await notice(cid, text, 20);
        };
        if (!ctx.isPrivate) await delMsg(ctx.chat.id, messageId);
        if (n === "all") {
          // Thousands of messages take longer than a button answer may wait: run in the background.
          if (ctx.isPrivate) await show(ctx, { text: "⏳ Удаляю сообщения…", kb: [] }, messageId);
          waitUntil(finish().catch((e) => console.error("cleanup:", e instanceof Error ? e.message : "unknown")));
          return "Удаляю…";
        }
        await finish();
        return null;
      }
      case "bx": {
        await needChat("restrict");
        if (!["ban", "mute", "kick"].includes(a2) || !["all", "d1", "d7"].includes(a3)) throw new Error("invalid_value");
        await show(ctx, await draftScreen(me, chatId, a2, a3, null), messageId);
        return null;
      }
      case "bi": {
        await needChat("restrict");
        if (!["ban", "mute", "kick"].includes(a2)) throw new Error("invalid_value");
        await db().from("tg_admin_state").upsert({ telegram_id: me, kind: "mod_ids", data: { chat: chatId, action: a2 }, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
        await show(ctx, { text: `✍️ Отправьте Telegram ID через пробел или запятую (до 500).\nДальше — предпросмотр и подтверждение. «отмена» — выйти.`, kb: [[b("✖️ Отмена", `md:ms:${chatId}`)]] }, messageId);
        return null;
      }
      case "b1": {
        const x = await loadBulk(a1, me);
        if (x.status !== "draft" || new Date(x.expires_at).getTime() < Date.now()) return "Черновик устарел. Начните заново.";
        await db().from("tg_mod_bulk").update({ status: "confirm", expires_at: new Date(Date.now() + 5 * 60_000).toISOString() }).eq("id", x.id).eq("status", "draft");
        await db().from("tg_admin_state").upsert({ telegram_id: me, kind: "mod_phrase", data: { bulk: x.id }, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
        await show(ctx, {
          text: `⚠️ <b>Шаг 2 из 2.</b> Вы собираетесь применить «${BULK_NAME[x.action]}» к <b>${x.total}</b> пользователям группы «${esc(x.chat_title)}».\n\n` +
            `Для запуска отправьте сообщением точную фразу:\n<code>${M.bulkPhrase(x.action, x.scope, Number(x.chat_id))}</code>\n\nЛюбой другой ответ отменит операцию. Действует 5 минут.`,
          kb: [[b("✖️ Отмена", `md:b0:${x.id}`)]],
        }, messageId);
        return null;
      }
      case "b0": {
        const x = await loadBulk(a1, me);
        await db().from("tg_mod_bulk").update({ status: "cancelled" }).eq("id", x.id).in("status", ["draft", "confirm"]);
        await db().from("tg_admin_state").delete().eq("telegram_id", me).eq("kind", "mod_phrase");
        await show(ctx, { text: "Отменено — никто не наказан.", kb: [toGroup(Number(x.chat_id))] }, messageId);
        return null;
      }
      case "bs": {
        const x = await loadBulk(a1, me);
        const { data: y } = await db().from("tg_mod_bulk").update({ status: "stopped", completed_at: new Date().toISOString() }).eq("id", x.id).eq("status", "running").select("*").maybeSingle();
        await show(ctx, progressScreen(y ?? x), messageId);
        return y ? "Остановлено" : "Операция уже не идёт";
      }
      case "bu": {
        const u = await rpc<any>("tg_mod_bulk_undo", { p_owner: me, p_bulk: a1 });
        const x = await loadBulk(a1, me);
        await show(ctx, {
          text: `↩️ <b>Отмена массового бана</b>\nГруппа: <b>${esc(x.chat_title)}</b>\n\nБудут разбанены <b>${u.total}</b> пользователей — только те, кого заблокировала эта операция. Заблокированные раньше останутся в бане.`,
          kb: [[b("✅ Разбанить", `md:bg:${u.id}`), b("✖️ Нет", `md:b0:${u.id}`)]],
        }, messageId);
        return null;
      }
      case "bg": {
        const x = await loadBulk(a1, me);
        if (x.action !== "unban" || x.status !== "confirm") return "Уже запущено или устарело.";
        const denied = await M.authorize(api, Number(x.chat_id), me, await botId(), "restrict");
        if (denied) return denied;
        const { data: y } = await db().from("tg_mod_bulk").update({ status: "running", started_at: new Date().toISOString(), panel_chat: ctx.chat.id, panel_message: messageId })
          .eq("id", x.id).eq("status", "confirm").select("*").single();
        if (y) await show(ctx, progressScreen(y), messageId);
        waitUntil(processBulk(x.id, 25_000).catch((e) => console.error("bulk:", e instanceof Error ? e.message : "unknown")));
        return "Запущено";
      }
    }
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.startsWith("denied:")) return m.slice(7);
    if (m.includes("admins_unknown")) return "Не удалось получить список админов группы — проверьте права бота.";
    throw e;
  }
}

// ------------------------------------------------------------ membership ----
// deno-lint-ignore no-explicit-any
const person = (u: any) => ({ id: u.id, username: u.username ?? null, first_name: u.first_name ?? null });

/** Join and leave service messages: the joiners become known members. */
// deno-lint-ignore no-explicit-any
export async function onService(msg: any) {
  const chat = msg.chat;
  if (msg.new_chat_members?.length) {
    await rpc("tg_mod_seen", { p_chat: chat.id, p_title: chat.title ?? "", p_type: chat.type, p_users: msg.new_chat_members.map(person), p_status: "member" });
  }
  if (msg.left_chat_member) {
    await rpc("tg_mod_seen", { p_chat: chat.id, p_title: chat.title ?? "", p_type: chat.type, p_users: [person(msg.left_chat_member)], p_status: "left" });
  }
}

/** chat_member updates (the bot must be an admin to get them): status of any member. */
// deno-lint-ignore no-explicit-any
export async function onChatMember(u: any) {
  const user = u.new_chat_member?.user;
  if (!user || user.id === (await botId())) return;
  await rpc("tg_mod_seen", { p_chat: u.chat.id, p_title: u.chat.title ?? "", p_type: u.chat.type, p_users: [person(user)], p_status: u.new_chat_member.status });
}

// ------------------------------------------------------------------ timer ----
export async function tick() {
  const due = await rpc<{ chat_id: number; message_id: number }[]>("tg_mod_autodelete_due", {});
  const byChat = new Map<number, number[]>();
  for (const d of due ?? []) byChat.set(Number(d.chat_id), [...(byChat.get(Number(d.chat_id)) ?? []), Number(d.message_id)]);
  for (const [chatId, ids] of byChat) await M.deleteMany(api, chatId, ids);
  const { data: running } = await db().from("tg_mod_bulk").select("id").eq("status", "running").order("started_at").limit(3);
  for (const r of running ?? []) await processBulk(r.id, 7000);
}
