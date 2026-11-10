// Party games for group chats: Mafia, Spy, Crocodile. Pure state machines: every transition takes
// the current game and returns the new phase/state plus "effects" (messages, private alerts,
// rewards) for the bot to perform. No network or database code, so tests can play whole games.
//
// Secrets never go to the group: roles, the spy's location and the crocodile word are shown with
// Telegram callback alerts, which only the player who pressed the button can see. That means the
// games need no private chat with the bot.

import { norm } from "./bot-commands.ts";

export type Kind = "mafia" | "spy" | "crocodile";
export interface Player { id: number; name: string }
export interface Btn { text: string; data: string }
export type Effect =
  | { t: "say"; text: string; buttons?: Btn[][] }
  | { t: "lobby"; text: string; buttons: Btn[][] }
  | { t: "alert"; text: string }
  | { t: "reward"; ids: number[] };
export interface Game { id: string; kind: Kind; phase: string; state: any; creator: number }
export interface Step { phase: string; state: any; deadlineSec: number | null; effects: Effect[]; finished?: boolean }
export type Rng = () => number;

export const LIMITS: Record<Kind, { min: number; max: number }> = {
  mafia: { min: 4, max: 12 },
  spy: { min: 3, max: 10 },
  crocodile: { min: 2, max: 50 },
};
export const TIMES = { lobby: 120, night: 60, day: 60, vote: 45, spyTalk: 240, spyVote: 60, croc: 180 };
const CROC_ROUNDS = 10;

const TITLES: Record<Kind, string> = { mafia: "🔪 Мафия", spy: "🕵️ Шпион", crocodile: "🐊 Крокодил" };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const nameOf = (players: Player[], id: number) => esc(players.find((p) => p.id === id)?.name ?? "?");
/** Callback data: p:<first 8 chars of the game id>:<action>[:<arg>] (stale buttons are ignored). */
export const cb = (g: { id: string }, action: string, arg: string | number = "") => `p:${g.id.slice(0, 8)}:${action}${arg === "" ? "" : `:${arg}`}`;
const shuffle = <T>(a: T[], rng: Rng) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
const pick = <T>(a: T[], rng: Rng) => a[Math.floor(rng() * a.length)];

// =================================================================== lobby ====
export function create(id: string, kind: Kind, starter: Player, rng: Rng = Math.random): { game: Game; step: Step } {
  const game: Game = { id, kind, phase: "lobby", creator: starter.id, state: { players: [starter] } };
  if (kind === "crocodile") {
    const step = crocStart(game, rng);
    return { game, step };
  }
  return { game, step: { phase: "lobby", state: game.state, deadlineSec: TIMES.lobby, effects: [lobbyView(game)] } };
}

function lobbyView(g: Game): Effect {
  const { min, max } = LIMITS[g.kind];
  const ps: Player[] = g.state.players;
  const rules = g.kind === "mafia"
    ? "Мафия убивает ночью, мирные ищут её днём голосованием. Есть доктор и комиссар."
    : "Все, кроме шпиона, знают локацию. Шпион пытается её угадать, остальные — вычислить шпиона.";
  return {
    t: "lobby",
    text: `<b>${TITLES[g.kind]}</b> — набор игроков\n${rules}\n\n` +
      `Игроки (${ps.length}/${max}):\n${ps.map((p, i) => `${i + 1}. ${esc(p.name)}`).join("\n")}\n\n` +
      `Нужно минимум ${min}. Создатель запускает игру; через ${TIMES.lobby / 60} мин она начнётся сама, если игроков хватит.`,
    buttons: [[{ text: "✋ Играю", data: cb(g, "join") }, { text: "🚪 Выйти", data: cb(g, "leave") }],
      [{ text: "▶️ Начать", data: cb(g, "start") }, { text: "✖️ Отменить", data: cb(g, "cancel") }]],
  };
}

const same = (g: Game, effects: Effect[]): Step => ({ phase: g.phase, state: g.state, deadlineSec: undefined as unknown as null, effects });
/** deadlineSec undefined = keep the current deadline. */
export const KEEP_DEADLINE = undefined as unknown as null;

// ================================================================= actions ====
/** A button press. `isChatAdmin` lets chat admins cancel any game. */
export function onAction(g: Game, from: Player, action: string, arg: string, rng: Rng = Math.random, isChatAdmin = false): Step {
  const ps: Player[] = g.state.players ?? [];
  const inGame = ps.some((p) => p.id === from.id);

  if (action === "cancel") {
    if (from.id !== g.creator && !isChatAdmin) return same(g, [{ t: "alert", text: "Отменить может создатель игры или админ чата." }]);
    return { phase: "done", state: g.state, deadlineSec: null, finished: true, effects: [{ t: "say", text: `${TITLES[g.kind]}: игра отменена.` }] };
  }

  if (g.phase === "lobby") {
    if (action === "join") {
      if (inGame) return same(g, [{ t: "alert", text: "Вы уже в игре." }]);
      if (ps.length >= LIMITS[g.kind].max) return same(g, [{ t: "alert", text: "Мест больше нет." }]);
      const state = { ...g.state, players: [...ps, from] };
      return { phase: "lobby", state, deadlineSec: KEEP_DEADLINE, effects: [{ t: "alert", text: "Вы в игре!" }, lobbyView({ ...g, state })] };
    }
    if (action === "leave") {
      if (!inGame) return same(g, [{ t: "alert", text: "Вас нет в списке." }]);
      const state = { ...g.state, players: ps.filter((p) => p.id !== from.id) };
      if (!state.players.length) return { phase: "done", state, deadlineSec: null, finished: true, effects: [{ t: "say", text: `${TITLES[g.kind]}: все вышли, игра отменена.` }] };
      return { phase: "lobby", state, deadlineSec: KEEP_DEADLINE, effects: [lobbyView({ ...g, state, creator: g.creator })] };
    }
    if (action === "start") {
      if (from.id !== g.creator && !isChatAdmin) return same(g, [{ t: "alert", text: "Начать может создатель игры." }]);
      if (ps.length < LIMITS[g.kind].min) return same(g, [{ t: "alert", text: `Нужно минимум ${LIMITS[g.kind].min} игрока.` }]);
      return g.kind === "mafia" ? mafiaStart(g, rng) : spyStart(g, rng);
    }
    return same(g, [{ t: "alert", text: "Игра ещё не началась." }]);
  }

  if (g.kind === "mafia") return mafiaAction(g, from, action, arg, rng);
  if (g.kind === "spy") return spyAction(g, from, action, arg);
  return crocAction(g, from, action, rng, isChatAdmin);
}

/** An ordinary chat message (crocodile guesses, the spy naming a location). */
export function onText(g: Game, from: Player, text: string, rng: Rng = Math.random): Step | null {
  if (g.kind === "crocodile" && g.phase === "round") return crocGuess(g, from, text, rng);
  if (g.kind === "spy" && g.phase === "talk") {
    const m = text.trim().match(/^локация\s+(.+)$/i);
    if (m && from.id === g.state.spy) return spyGuess(g, m[1]);
  }
  return null;
}

/** The phase deadline passed (called by the timer). */
export function onTimeout(g: Game, rng: Rng = Math.random): Step {
  if (g.phase === "lobby") {
    if ((g.state.players ?? []).length >= LIMITS[g.kind].min) return g.kind === "mafia" ? mafiaStart(g, rng) : spyStart(g, rng);
    return { phase: "done", state: g.state, deadlineSec: null, finished: true, effects: [{ t: "say", text: `${TITLES[g.kind]}: не набралось игроков, игра отменена.` }] };
  }
  if (g.kind === "mafia") {
    if (g.phase === "night") return mafiaNightEnd(g, rng);
    if (g.phase === "day") return mafiaVoteStart(g);
    if (g.phase === "vote") return mafiaVoteEnd(g, rng);
  }
  if (g.kind === "spy") {
    if (g.phase === "talk") return spyVoteStart(g);
    if (g.phase === "vote") return spyVoteEnd(g);
  }
  if (g.kind === "crocodile") return crocTimeout(g, rng);
  return { phase: "done", state: g.state, deadlineSec: null, finished: true, effects: [] };
}

// =================================================================== mafia ====
type Role = "mafia" | "doctor" | "sheriff" | "civilian";
const ROLE_NAME: Record<Role, string> = { mafia: "🔪 Мафия", doctor: "💉 Доктор", sheriff: "🕵️ Комиссар", civilian: "🙂 Мирный житель" };

export function mafiaRoles(n: number): Role[] {
  const roles: Role[] = Array(Math.max(1, Math.floor(n / 4))).fill("mafia");
  if (n >= 5) roles.push("doctor");
  if (n >= 6) roles.push("sheriff");
  while (roles.length < n) roles.push("civilian");
  return roles;
}

function mafiaStart(g: Game, rng: Rng): Step {
  const ps: Player[] = g.state.players;
  const roles = shuffle(mafiaRoles(ps.length), rng);
  const state = { players: ps, roles: Object.fromEntries(ps.map((p, i) => [p.id, roles[i]])), alive: ps.map((p) => p.id), day: 1, actions: {}, votes: {} };
  const counts = mafiaRoles(ps.length).reduce((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {} as Record<string, number>);
  const g2 = { ...g, phase: "night", state };
  return {
    phase: "night", state, deadlineSec: TIMES.night,
    effects: [
      { t: "say", text: `<b>🔪 Мафия началась!</b> Игроков: ${ps.length}. Мафия: ${counts.mafia}` + (counts.doctor ? ", доктор" : "") + (counts.sheriff ? ", комиссар" : "") +
        `.\nНажмите «🎭 Моя роль» — роль увидите только вы.` },
      mafiaNightView(g2),
    ],
  };
}

const alive = (s: any): number[] => s.alive;
const roleOf = (s: any, id: number): Role => s.roles[id];

function targetButtons(g: Game, action: string, ids: number[], extra: Btn[] = []): Btn[][] {
  const rows: Btn[][] = [];
  ids.forEach((id, i) => {
    if (i % 2 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: g.state.players.find((p: Player) => p.id === id)?.name ?? "?", data: cb(g, action, id) });
  });
  if (extra.length) rows.push(extra);
  rows.push([{ text: "🎭 Моя роль", data: cb(g, "role") }]);
  return rows;
}

function mafiaNightView(g: Game): Effect {
  return {
    t: "say",
    text: `🌙 <b>Ночь ${g.state.day}</b>. Город засыпает.\nКаждый живой игрок выбирает кого-то ниже: мафия — жертву, доктор — кого лечить, ` +
      `комиссар — кого проверить, мирные — просто подозреваемого. Так никто не поймёт, кто есть кто. ${TIMES.night} с.`,
    buttons: targetButtons(g, "act", alive(g.state)),
  };
}

function roleText(s: any, id: number): string {
  const r = roleOf(s, id);
  if (!r) return "Вы не участвуете в этой игре.";
  let t = `Ваша роль: ${ROLE_NAME[r]}.`;
  if (r === "mafia") {
    const team = Object.entries(s.roles).filter(([, v]) => v === "mafia").map(([k]) => nameOf(s.players, Number(k)));
    t += ` Мафия: ${team.join(", ")}. Ночью выбирайте жертву.`;
  } else if (r === "doctor") t += " Ночью выберите, кого спасти (можно себя).";
  else if (r === "sheriff") t += " Ночью проверяйте игроков.";
  else t += " Днём ищите мафию.";
  if (!alive(s).includes(id)) t += " Вы выбыли.";
  // Alerts show plain text: no HTML entities.
  return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function mafiaAction(g: Game, from: Player, action: string, arg: string, rng: Rng): Step {
  const s = g.state;
  if (action === "role") return same(g, [{ t: "alert", text: roleText(s, from.id) }]);
  if (!alive(s).includes(from.id)) return same(g, [{ t: "alert", text: roleOf(s, from.id) ? "Вы выбыли из игры." : "Вы не участвуете в этой игре." }]);
  const target = Number(arg);

  if (action === "act" && g.phase === "night") {
    if (!alive(s).includes(target)) return same(g, [{ t: "alert", text: "Этого игрока уже нет." }]);
    const r = roleOf(s, from.id);
    if (r === "mafia" && roleOf(s, target) === "mafia") return same(g, [{ t: "alert", text: "Нельзя выбрать своего." }]);
    const state = { ...s, actions: { ...s.actions, [from.id]: target } };
    const tname = nameOf(s.players, target).replace(/&amp;/g, "&");
    const note = r === "mafia" ? `Голос за ${tname} принят.`
      : r === "doctor" ? `Этой ночью вы лечите ${tname}.`
      : r === "sheriff" ? `${tname} — ${roleOf(s, target) === "mafia" ? "МАФИЯ! 🔪" : "не мафия."}`
      : "Принято. Спокойной ночи.";
    if (alive(state).every((id) => state.actions[id] !== undefined)) {
      const end = mafiaNightEnd({ ...g, state }, rng);
      return { ...end, effects: [{ t: "alert", text: note }, ...end.effects] };
    }
    return { phase: g.phase, state, deadlineSec: KEEP_DEADLINE, effects: [{ t: "alert", text: note }] };
  }

  if (action === "vote" && g.phase === "vote") {
    if (target !== 0 && !alive(s).includes(target)) return same(g, [{ t: "alert", text: "Этого игрока уже нет." }]);
    const state = { ...s, votes: { ...s.votes, [from.id]: target } };
    const note = target === 0 ? "Вы воздержались." : `Голос против ${nameOf(s.players, target).replace(/&amp;/g, "&")}.`;
    if (alive(state).every((id) => state.votes[id] !== undefined)) {
      const end = mafiaVoteEnd({ ...g, state }, rng);
      return { ...end, effects: [{ t: "alert", text: note }, ...end.effects] };
    }
    return { phase: g.phase, state, deadlineSec: KEEP_DEADLINE, effects: [{ t: "alert", text: note }] };
  }
  return same(g, [{ t: "alert", text: g.phase === "day" ? "Сейчас обсуждение. Голосование начнётся скоро." : "Сейчас это сделать нельзя." }]);
}

/** Most frequent value; ties broken at random. Returns undefined when nothing was chosen. */
function plurality(values: number[], rng: Rng): number | undefined {
  if (!values.length) return undefined;
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const max = Math.max(...counts.values());
  return pick([...counts.entries()].filter(([, c]) => c === max).map(([v]) => v), rng);
}

export function mafiaWinner(s: any): "mafia" | "town" | null {
  const m = alive(s).filter((id) => roleOf(s, id) === "mafia").length;
  if (m === 0) return "town";
  if (m >= alive(s).length - m) return "mafia";
  return null;
}

function mafiaFinish(g: Game, s: any, winner: "mafia" | "town", prefix: string): Step {
  const ids = Object.keys(s.roles).map(Number).filter((id) => (roleOf(s, id) === "mafia") === (winner === "mafia"));
  const reveal = s.players.map((p: Player) => `${esc(p.name)} — ${ROLE_NAME[roleOf(s, p.id)]}${alive(s).includes(p.id) ? "" : " ✝️"}`).join("\n");
  return {
    phase: "done", state: s, deadlineSec: null, finished: true,
    effects: [
      { t: "say", text: `${prefix}<b>${winner === "mafia" ? "🔪 Победила мафия!" : "🏆 Победили мирные жители!"}</b>\n\n${reveal}` },
      { t: "reward", ids },
    ],
  };
}

function mafiaNightEnd(g: Game, rng: Rng): Step {
  const s = g.state;
  const mafiaPicks = alive(s).filter((id) => roleOf(s, id) === "mafia" && s.actions[id] !== undefined).map((id) => s.actions[id]);
  const victim = plurality(mafiaPicks, rng);
  const doctor = alive(s).find((id) => roleOf(s, id) === "doctor");
  const healed = doctor !== undefined ? s.actions[doctor] : undefined;
  let news: string;
  let aliveNow = alive(s);
  if (victim === undefined) news = "Мафия этой ночью бездействовала.";
  else if (victim === healed) news = `Мафия напала на ${nameOf(s.players, victim)}, но доктор успел спасти! 💉`;
  else {
    aliveNow = aliveNow.filter((id) => id !== victim);
    news = `Этой ночью убит(а) <b>${nameOf(s.players, victim)}</b> — ${ROLE_NAME[roleOf(s, victim)]}.`;
  }
  const state = { ...s, alive: aliveNow, actions: {}, votes: {} };
  const win = mafiaWinner(state);
  if (win) return mafiaFinish(g, state, win, `🌅 ${news}\n\n`);
  return {
    phase: "day", state, deadlineSec: TIMES.day,
    effects: [{ t: "say", text: `🌅 <b>Утро, день ${s.day}.</b> ${news}\nЖивы: ${aliveNow.map((id) => nameOf(s.players, id)).join(", ")}.\n` +
      `Обсуждайте ${TIMES.day} с, затем голосование.`, buttons: [[{ text: "🎭 Моя роль", data: cb(g, "role") }]] }],
  };
}

function mafiaVoteStart(g: Game): Step {
  const state = { ...g.state, votes: {} };
  return {
    phase: "vote", state, deadlineSec: TIMES.vote,
    effects: [{ t: "say", text: `🗳 <b>Голосование.</b> Кого изгоняем? ${TIMES.vote} с. Голосуют только живые.`,
      buttons: targetButtons({ ...g, state }, "vote", alive(state), [{ text: "🤷 Воздержаться", data: cb(g, "vote", 0) }]) }],
  };
}

function mafiaVoteEnd(g: Game, rng: Rng): Step {
  const s = g.state;
  const votes = Object.values(s.votes as Record<string, number>);
  const counts = new Map<number, number>();
  votes.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const sorted = [...counts.entries()].filter(([v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  const skip = counts.get(0) ?? 0;
  let news: string;
  let aliveNow = alive(s);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1]) || sorted[0][1] <= skip) {
    news = "Город не смог договориться — никто не изгнан.";
  } else {
    const out = sorted[0][0];
    aliveNow = aliveNow.filter((id) => id !== out);
    news = `Город изгнал <b>${nameOf(s.players, out)}</b> — ${ROLE_NAME[roleOf(s, out)]}.`;
  }
  const state = { ...s, alive: aliveNow, votes: {}, actions: {}, day: s.day + 1 };
  const win = mafiaWinner(state);
  if (win) return mafiaFinish(g, state, win, `🗳 ${news}\n\n`);
  return { phase: "night", state, deadlineSec: TIMES.night, effects: [{ t: "say", text: `🗳 ${news}` }, mafiaNightView({ ...g, state })] };
}

// ===================================================================== spy ====
export const LOCATIONS = [
  "Аэропорт", "Банк", "Пляж", "Казино", "Цирк", "Посольство", "Больница", "Отель", "Военная база", "Киностудия",
  "Круизный лайнер", "Пассажирский поезд", "Пиратский корабль", "Полярная станция", "Полицейский участок",
  "Ресторан", "Школа", "Автосервис", "Космическая станция", "Подводная лодка", "Супермаркет", "Театр",
  "Университет", "Спа-салон", "Ночной клуб", "Офис BAYHAN", "Стройка", "Зоопарк", "Музей", "Стадион",
];

function spyStart(g: Game, rng: Rng): Step {
  const ps: Player[] = g.state.players;
  const state = { players: ps, spy: pick(ps, rng).id, location: pick(LOCATIONS, rng), alive: ps.map((p) => p.id), votes: {}, voteNow: [] };
  const g2 = { ...g, state };
  return {
    phase: "talk", state, deadlineSec: TIMES.spyTalk,
    effects: [{ t: "say", text: `<b>🕵️ Шпион начался!</b> Игроков: ${ps.length}.\nНажмите «🎭 Моя роль»: все, кроме шпиона, увидят локацию.\n` +
      `По очереди задавайте друг другу вопросы о месте, не называя его. Шпион может в любой момент написать «локация <название>» и попробовать угадать.\n` +
      `Через ${TIMES.spyTalk / 60} мин — голосование (или раньше, если половина нажмёт «Голосовать»).\n\nВозможные локации: ${LOCATIONS.join(", ")}.`,
      buttons: [[{ text: "🎭 Моя роль", data: cb(g2, "role") }], [{ text: "🗳 Голосовать сейчас", data: cb(g2, "votenow") }]] }],
  };
}

function spyAction(g: Game, from: Player, action: string, arg: string): Step {
  const s = g.state;
  const inGame = s.players.some((p: Player) => p.id === from.id);
  if (action === "role") {
    if (!inGame) return same(g, [{ t: "alert", text: "Вы не участвуете в этой игре." }]);
    return same(g, [{ t: "alert", text: from.id === s.spy
      ? "Вы — ШПИОН 🕵️. Локацию вы не знаете. Слушайте и угадайте: напишите в чат «локация <название>»."
      : `Локация: ${s.location}. Шпион среди вас — вычислите его.` }]);
  }
  if (!inGame) return same(g, [{ t: "alert", text: "Вы не участвуете в этой игре." }]);
  if (action === "votenow" && g.phase === "talk") {
    const voteNow: number[] = s.voteNow.includes(from.id) ? s.voteNow : [...s.voteNow, from.id];
    const need = Math.ceil(s.players.length / 2);
    const state = { ...s, voteNow };
    if (voteNow.length >= need) return spyVoteStart({ ...g, state });
    return { phase: g.phase, state, deadlineSec: KEEP_DEADLINE, effects: [{ t: "alert", text: `За досрочное голосование: ${voteNow.length}/${need}.` }] };
  }
  if (action === "vote" && g.phase === "vote") {
    const target = Number(arg);
    if (!s.players.some((p: Player) => p.id === target)) return same(g, [{ t: "alert", text: "Нет такого игрока." }]);
    if (target === from.id) return same(g, [{ t: "alert", text: "За себя голосовать нельзя." }]);
    const state = { ...s, votes: { ...s.votes, [from.id]: target } };
    if (s.players.every((p: Player) => state.votes[p.id] !== undefined)) {
      const end = spyVoteEnd({ ...g, state });
      return { ...end, effects: [{ t: "alert", text: "Голос принят." }, ...end.effects] };
    }
    return { phase: g.phase, state, deadlineSec: KEEP_DEADLINE, effects: [{ t: "alert", text: `Голос против ${nameOf(s.players, target).replace(/&amp;/g, "&")}.` }] };
  }
  return same(g, [{ t: "alert", text: "Сейчас это сделать нельзя." }]);
}

function spyVoteStart(g: Game): Step {
  const state = { ...g.state, votes: {} };
  return {
    phase: "vote", state, deadlineSec: TIMES.spyVote,
    effects: [{ t: "say", text: `🗳 <b>Кто шпион?</b> Голосуйте, ${TIMES.spyVote} с.`, buttons: targetButtons({ ...g, state }, "vote", state.players.map((p: Player) => p.id)) }],
  };
}

function spyFinish(g: Game, s: any, spyWins: boolean, prefix: string): Step {
  const ids = s.players.map((p: Player) => p.id).filter((id: number) => (id === s.spy) === spyWins);
  return {
    phase: "done", state: s, deadlineSec: null, finished: true,
    effects: [{ t: "say", text: `${prefix}<b>${spyWins ? "🕵️ Победил шпион!" : "🏆 Шпион пойман!"}</b>\nШпион: ${nameOf(s.players, s.spy)}. Локация: ${s.location}.` },
      { t: "reward", ids }],
  };
}

function spyVoteEnd(g: Game): Step {
  const s = g.state;
  const counts = new Map<number, number>();
  Object.values(s.votes as Record<string, number>).forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const caught = sorted.length > 0 && sorted[0][0] === s.spy && (!sorted[1] || sorted[1][1] < sorted[0][1]);
  const accused = sorted[0] ? nameOf(s.players, sorted[0][0]) : null;
  const prefix = accused ? `Большинство указало на ${accused}.\n` : "Никто не проголосовал.\n";
  return spyFinish(g, s, !caught, prefix);
}

function spyGuess(g: Game, guess: string): Step {
  const s = g.state;
  const right = norm(guess) === norm(s.location);
  return spyFinish(g, s, right, `Шпион назвал локацию: «${esc(guess)}» — ${right ? "верно!" : "мимо."}\n`);
}

// =============================================================== crocodile ====
export const WORDS = [
  "самолёт", "арбуз", "футбол", "гитара", "пират", "робот", "вертолёт", "пингвин", "библиотека", "светофор", "радуга",
  "космонавт", "холодильник", "снеговик", "динозавр", "телескоп", "водопад", "кенгуру", "фонарик", "лабиринт",
  "миллионер", "банкомат", "лимузин", "яхта", "небоскрёб", "казино", "шахматы", "попкорн", "пылесос", "барабан",
  "жираф", "маяк", "зонтик", "парашют", "компас", "вулкан", "магнит", "микроскоп", "ракета", "подводная лодка",
  "фейерверк", "кактус", "бегемот", "скрипка", "домино", "аквариум", "палатка", "кроссовки", "подушка", "чемодан",
  "отпуск", "свадьба", "экзамен", "лотерея", "биткоин", "бизнесмен", "таксист", "программист", "повар", "детектив",
  "фокусник", "супергерой", "привидение", "русалка", "дракон", "единорог", "снайпер", "хоккей", "бокс", "теннис",
  "серфинг", "сноуборд", "рыбалка", "шашлык", "мороженое", "пицца", "суши", "блины", "торт", "кофе",
];

function crocView(g: Game, s: any, head: string): Effect {
  return {
    t: "say",
    text: `${head}🐊 <b>Крокодил</b>, раунд ${s.round}/${CROC_ROUNDS}. Объясняет <b>${nameOf(s.players, s.host)}</b>: словами, без однокоренных, ` +
      `или жестами в голосовом/видео. Остальные пишут догадки в чат. ${TIMES.croc / 60} мин.`,
    buttons: [[{ text: "👀 Слово (для ведущего)", data: cb(g, "word") }, { text: "🔁 Другое слово", data: cb(g, "skip") }],
      [{ text: "⏹ Закончить", data: cb(g, "cancel") }]],
  };
}

function crocStart(g: Game, rng: Rng): Step {
  const starter: Player = g.state.players[0];
  const state = { players: [starter], host: starter.id, word: pick(WORDS, rng), round: 1, scores: {}, misses: 0 };
  return { phase: "round", state, deadlineSec: TIMES.croc, effects: [crocView(g, state, "")] };
}

function crocAction(g: Game, from: Player, action: string, rng: Rng, isChatAdmin: boolean): Step {
  const s = g.state;
  if (action === "word") return same(g, [{ t: "alert", text: from.id === s.host ? `Ваше слово: ${s.word.toUpperCase()}` : "Слово видит только ведущий 🤫" }]);
  if (action === "skip") {
    if (from.id !== s.host && !isChatAdmin) return same(g, [{ t: "alert", text: "Менять слово может только ведущий." }]);
    let word = s.word;
    while (word === s.word) word = pick(WORDS, rng);
    return { phase: g.phase, state: { ...s, word }, deadlineSec: KEEP_DEADLINE, effects: [{ t: "alert", text: `Новое слово: ${word.toUpperCase()}` }] };
  }
  return same(g, [{ t: "alert", text: "Сейчас это сделать нельзя." }]);
}

function crocGuess(g: Game, from: Player, text: string, rng: Rng): Step | null {
  const s = g.state;
  if (from.id === s.host) return null;
  const t = ` ${norm(text)} `;
  if (!t.includes(` ${norm(s.word)} `)) return null;
  const scores = { ...s.scores, [from.id]: (s.scores[from.id] ?? 0) + 1 };
  const players: Player[] = s.players.some((p: Player) => p.id === from.id) ? s.players : [...s.players, from];
  const head = `🎉 <b>${esc(from.name)}</b> угадал(а) слово «${esc(s.word)}»!\n\n`;
  if (s.round >= CROC_ROUNDS) return crocFinish(g, { ...s, scores, players }, head);
  const state = { ...s, players, scores, host: from.id, word: pick(WORDS.filter((w) => w !== s.word), rng), round: s.round + 1, misses: 0 };
  return { phase: "round", state, deadlineSec: TIMES.croc, effects: [crocView(g, state, head)] };
}

function crocTimeout(g: Game, rng: Rng): Step {
  const s = g.state;
  const head = `⏰ Никто не угадал. Слово было «${esc(s.word)}».\n\n`;
  if (s.round >= CROC_ROUNDS || s.misses >= 1) return crocFinish(g, s, head);
  const state = { ...s, word: pick(WORDS.filter((w) => w !== s.word), rng), round: s.round + 1, misses: s.misses + 1 };
  return { phase: "round", state, deadlineSec: TIMES.croc, effects: [crocView(g, state, head)] };
}

function crocFinish(g: Game, s: any, head: string): Step {
  const entries = Object.entries(s.scores as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const table = entries.map(([id, n], i) => `${i + 1}. ${nameOf(s.players, Number(id))} — ${n}`).join("\n") || "Никто не угадал ни одного слова.";
  const best = entries.length ? entries[0][1] : 0;
  // A reward needs at least 3 different people in the game, so two friends cannot farm it.
  const winners = s.players.length >= 3 && best > 0 ? entries.filter(([, n]) => n === best).map(([id]) => Number(id)) : [];
  return {
    phase: "done", state: s, deadlineSec: null, finished: true,
    effects: [{ t: "say", text: `${head}🐊 <b>Крокодил окончен!</b>\n\n${table}` }, ...(winners.length ? [{ t: "reward" as const, ids: winners }] : [])],
  };
}
