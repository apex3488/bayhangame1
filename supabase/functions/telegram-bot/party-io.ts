// Runs the party games from _shared/party.ts against Telegram and the database. State lives in
// tg_party_games; concurrent button presses are serialised with a version check (optimistic lock).
import * as P from "../_shared/party.ts";
import { admin, rpc, tg, type TgUser } from "../_shared/telegram.ts";
import { type Ctx, edit, money, reply, send } from "./ctx.ts";

type Row = { id: string; chat_id: number; kind: P.Kind; phase: string; state: any; deadline: string | null; message_id: number | null; version: number; created_at: string };
const player = (u: TgUser): P.Player => ({ id: u.id, name: (u.first_name || u.username || "Игрок").slice(0, 32) });
const toGame = (r: Row): P.Game => ({ id: r.id, kind: r.kind, phase: r.phase, state: r.state, creator: r.state.creator ?? r.state.players?.[0]?.id });

async function active(chatId: number): Promise<Row | null> {
  const { data } = await admin().from("tg_party_games").select("*").eq("chat_id", chatId).is("finished_at", null).maybeSingle();
  return data as Row | null;
}

/** Applies a transition if nobody changed the game meanwhile; returns false to retry. */
async function save(row: Row, step: P.Step): Promise<boolean> {
  const patch: Record<string, unknown> = { phase: step.phase, state: { ...step.state, creator: row.state.creator ?? step.state.creator }, version: row.version + 1 };
  if (step.deadlineSec !== undefined) patch.deadline = step.deadlineSec === null ? null : new Date(Date.now() + step.deadlineSec * 1000).toISOString();
  if (step.finished) patch.finished_at = new Date().toISOString();
  const { data } = await admin().from("tg_party_games").update(patch).eq("id", row.id).eq("version", row.version).select("id");
  return (data?.length ?? 0) > 0;
}

/** Sends the step's group messages and pays rewards. Returns the private alert, if any. */
async function perform(row: Row, step: P.Step): Promise<string | null> {
  let alert: string | null = null;
  for (const e of step.effects) {
    if (e.t === "alert") alert = e.text;
    else if (e.t === "say") await send(row.chat_id, e.text, e.buttons?.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))));
    else if (e.t === "lobby") {
      const kb = e.buttons.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data })));
      if (row.message_id) await edit(row.chat_id, row.message_id, e.text, kb);
      else {
        const m = await send(row.chat_id, e.text, kb);
        if (m?.result?.message_id) await admin().from("tg_party_games").update({ message_id: m.result.message_id }).eq("id", row.id);
      }
    } else if (e.t === "reward" && e.ids.length) {
      try {
        const r = await rpc<any>("tg_party_reward", { p_game: row.id, p_tgs: e.ids });
        if (r?.paid?.length) await send(row.chat_id, `🏅 Награда победителям с аккаунтом BAYHAN GAME: <b>${money(r.amount)}</b> каждому (${r.paid.length} чел.).`);
      } catch (err) {
        console.warn("party reward failed:", err instanceof Error ? err.message : "unknown");
      }
    }
  }
  return alert;
}

async function transition(chatId: number, gameIdPrefix: string | null, fn: (g: P.Game) => P.Step | null): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await active(chatId);
    if (!row || (gameIdPrefix && !row.id.startsWith(gameIdPrefix))) return gameIdPrefix ? "Эта игра уже закончилась." : null;
    const step = fn(toGame(row));
    if (!step) return null;
    // Alert-only answers change nothing: no write needed.
    if (step.effects.every((e) => e.t === "alert") && step.state === row.state && step.phase === row.phase) {
      return (step.effects[0] as { text: string } | undefined)?.text ?? null;
    }
    if (await save(row, step)) return await perform(row, step);
  }
  return "Слишком много нажатий одновременно, попробуйте ещё раз.";
}

export async function start(ctx: Ctx, kind: P.Kind) {
  if (ctx.isPrivate) return reply(ctx, "Мафия, Шпион и Крокодил играются в группах. Добавьте бота в чат и напишите там «мафия».");
  if (ctx.settings.party === false) return reply(ctx, "Мини-игры в этом чате выключены администратором.");
  const running = await active(ctx.chat.id);
  if (running) return reply(ctx, `В чате уже идёт игра (${running.kind === "mafia" ? "Мафия" : running.kind === "spy" ? "Шпион" : "Крокодил"}). Закончить: «стоп игра».`);
  const id = crypto.randomUUID();
  const { game, step } = P.create(id, kind, player(ctx.from));
  const row: Row = { id, chat_id: ctx.chat.id, kind, phase: game.phase, state: { ...game.state, creator: ctx.from.id }, deadline: null, message_id: null, version: 0, created_at: "" };
  const { error } = await admin().from("tg_party_games").insert({
    id, chat_id: ctx.chat.id, kind, phase: step.phase, state: { ...step.state, creator: ctx.from.id },
    deadline: step.deadlineSec ? new Date(Date.now() + step.deadlineSec * 1000).toISOString() : null,
  });
  if (error) return reply(ctx, "В чате уже идёт игра.");
  await perform({ ...row, phase: step.phase, state: step.state }, step);
}

async function isChatAdmin(chatId: number, userId: number) {
  const r = await tg("getChatMember", { chat_id: chatId, user_id: userId });
  return ["creator", "administrator"].includes(r?.result?.status);
}

export async function stop(ctx: Ctx) {
  const row = await active(ctx.chat.id);
  if (!row) return reply(ctx, "Сейчас нет игры.");
  const allowed = ctx.from.id === (row.state.creator ?? row.state.players?.[0]?.id) || (await isChatAdmin(ctx.chat.id, ctx.from.id));
  if (!allowed) return reply(ctx, "Остановить игру может её создатель или админ чата.");
  const msg = await transition(ctx.chat.id, row.id.slice(0, 8), (g) => P.onAction(g, player(ctx.from), "cancel", "", Math.random, true));
  if (msg) await reply(ctx, msg);
}

/** Button press: callback data p:<id8>:<action>[:<arg>]. Returns the private alert text. */
export async function button(ctx: Ctx, data: string): Promise<string | null> {
  const [, id8, action, arg = ""] = data.split(":");
  const adminCheck = action === "cancel" || action === "skip" || action === "start";
  const chatAdmin = adminCheck ? await isChatAdmin(ctx.chat.id, ctx.from.id) : false;
  return await transition(ctx.chat.id, id8, (g) => P.onAction(g, player(ctx.from), action, arg, Math.random, chatAdmin));
}

/** Ordinary group messages: crocodile guesses and the spy's location guess. */
export async function text(ctx: Ctx, body: string): Promise<boolean> {
  const row = await active(ctx.chat.id);
  if (!row) return false;
  let used = false;
  await transition(ctx.chat.id, row.id.slice(0, 8), (g) => {
    const s = P.onText(g, player(ctx.from), body);
    used = Boolean(s);
    return s;
  });
  return used;
}

/** Timer: called every few seconds by pg_cron; advances games whose phase deadline passed. */
export async function tick() {
  const { data } = await admin().from("tg_party_games").select("chat_id, id").is("finished_at", null).lt("deadline", new Date().toISOString()).limit(50);
  for (const g of data ?? []) {
    await transition(g.chat_id, g.id.slice(0, 8), (game) => P.onTimeout(game));
  }
  // Games nobody touched for 2 hours are closed quietly.
  await admin().from("tg_party_games").update({ finished_at: new Date().toISOString(), phase: "done" })
    .is("finished_at", null).lt("created_at", new Date(Date.now() - 2 * 3600_000).toISOString());
}

export const HELP =
  `🎭 <b>Мини-игры для чата</b>\n\n🔪 «мафия» — 4–12 игроков, мафия против мирных, доктор и комиссар\n` +
  `🕵️ «шпион» — 3–10 игроков, вычислите шпиона по вопросам о локации\n🐊 «крокодил» — объясняйте слово, остальные угадывают в чате\n` +
  `⚔️ «дуэль 1к» — PvP на деньги\n\nРоли и слова видите только вы — по кнопкам. Остановить: «стоп игра».`;
