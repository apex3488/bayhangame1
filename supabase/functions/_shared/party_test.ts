// deno test supabase/functions/_shared — party game state machines and chat command parsing.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { create, type Game, LIMITS, mafiaRoles, mafiaWinner, onAction, onText, onTimeout, type Player, type Step } from "./party.ts";
import { parseAmount, parseChat } from "./bot-commands.ts";

/** Deterministic random numbers. */
const seq = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const P = (n: number): Player[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
const apply = (g: Game, s: Step): Game => ({ ...g, phase: s.phase, state: s.state });
const says = (s: Step) => s.effects.filter((e) => e.t === "say").map((e) => (e as { text: string }).text).join("\n");
const alertOf = (s: Step) => (s.effects.find((e) => e.t === "alert") as { text: string } | undefined)?.text ?? "";

function lobby(kind: "mafia" | "spy", n: number, rng = seq()) {
  const ps = P(n);
  let { game } = create("abcdef12-0000", kind, ps[0], rng);
  for (const p of ps.slice(1)) game = apply(game, onAction(game, p, "join", "", rng));
  return { game, ps };
}

Deno.test("mafia roles scale with the table", () => {
  assertEquals(mafiaRoles(4).filter((r) => r === "mafia").length, 1);
  assertEquals(mafiaRoles(8).filter((r) => r === "mafia").length, 2);
  assert(mafiaRoles(6).includes("doctor") && mafiaRoles(6).includes("sheriff"));
  assert(!mafiaRoles(4).includes("doctor"));
});

Deno.test("lobby: join, duplicates, limits, only creator starts", () => {
  const rng = seq();
  const { game, ps } = lobby("mafia", 3, rng);
  assertEquals(game.state.players.length, 3);
  assert(alertOf(onAction(game, ps[1], "join", "", rng)).includes("уже"));
  assert(alertOf(onAction(game, ps[1], "start", "", rng)).includes("создатель"));
  assert(alertOf(onAction(game, ps[0], "start", "", rng)).includes("минимум"));
  const t = onTimeout(game, rng);
  assert(t.finished && says(t).includes("отменена"), "too few players: cancelled on timeout");
  let full = lobby("mafia", 12, rng).game;
  assert(alertOf(onAction(full, { id: 99, name: "X" }, "join", "", rng)).includes("Мест"));
  full = apply(full, onAction(full, { id: 2, name: "P2" }, "leave", "", rng));
  assertEquals(full.state.players.length, 11);
});

Deno.test("mafia: a whole game ends with a winner and rewards the winning team", () => {
  const rng = seq(3);
  let { game, ps } = lobby("mafia", 6, rng);
  let step = onAction(game, ps[0], "start", "", rng);
  game = apply(game, step);
  assertEquals(game.phase, "night");
  const roles: Record<number, string> = game.state.roles;
  assertEquals(Object.values(roles).filter((r) => r === "mafia").length, 1);
  assert(alertOf(onAction(game, ps[2], "role", "", rng)).startsWith("Ваша роль"));
  assert(alertOf(onAction(game, { id: 77, name: "Z" }, "act", "1", rng)).includes("не участвуете"));

  const mafia = Number(Object.keys(roles).find((k) => roles[Number(k)] === "mafia"));
  let guard = 0;
  while (!step.finished && guard++ < 40) {
    const alive: number[] = game.state.alive;
    if (game.phase === "night") {
      // Mafia kills the first townsperson; everybody else points at the mafia.
      const victim = alive.find((id) => id !== mafia)!;
      for (const id of alive) {
        step = onAction(game, { id, name: `P${id}` }, "act", String(id === mafia ? victim : mafia), rng);
        game = apply(game, step);
        if (step.finished || game.phase !== "night") break;
      }
    } else if (game.phase === "day") {
      assert(alertOf(onAction(game, { id: alive[0], name: "" }, "vote", String(mafia), rng)).includes("обсуждение"));
      step = onTimeout(game, rng);
      game = apply(game, step);
    } else if (game.phase === "vote") {
      for (const id of alive) {
        step = onAction(game, { id, name: `P${id}` }, "vote", String(id === mafia ? alive.find((x) => x !== mafia)! : mafia), rng);
        game = apply(game, step);
        if (step.finished || game.phase !== "vote") break;
      }
    }
  }
  assert(step.finished, "game finished");
  assertEquals(mafiaWinner(game.state), "town");
  const reward = step.effects.find((e) => e.t === "reward") as { ids: number[] };
  assertEquals(reward.ids.sort(), ps.map((p) => p.id).filter((id) => id !== mafia).sort());
  assert(says(step).includes("Победили мирные"));
});

Deno.test("mafia: mafia cannot target mafia, dead players cannot act, doctor saves", () => {
  const rng = seq(11);
  let { game, ps } = lobby("mafia", 8, rng);
  game = apply(game, onAction(game, ps[0], "start", "", rng));
  const roles: Record<number, string> = game.state.roles;
  const by = (r: string) => Number(Object.keys(roles).find((k) => roles[Number(k)] === r));
  const mafias = Object.keys(roles).map(Number).filter((k) => roles[k] === "mafia");
  assert(alertOf(onAction(game, { id: mafias[0], name: "" }, "act", String(mafias[1]), rng)).includes("своего"));
  const doctor = by("doctor");
  const victim = Object.keys(roles).map(Number).find((k) => roles[k] === "civilian")!;
  let step: Step | undefined;
  for (const id of game.state.alive as number[]) {
    const target = roles[id] === "mafia" || id === doctor ? victim : victim;
    step = onAction(game, { id, name: "" }, "act", String(target), rng);
    game = apply(game, step);
  }
  assertEquals(game.phase, "day");
  assert(says(step!).includes("спасти"), "doctor healed the victim");
  assertEquals(game.state.alive.length, 8);
});

Deno.test("spy: town catches the spy; spy wins by naming the location", () => {
  const rng = seq(5);
  let { game, ps } = lobby("spy", 4, rng);
  game = apply(game, onAction(game, ps[0], "start", "", rng));
  const spy = game.state.spy as number;
  const other = ps.find((p) => p.id !== spy)!;
  assert(alertOf(onAction(game, other, "role", "", rng)).includes(game.state.location));
  assert(alertOf(onAction(game, { id: spy, name: "" }, "role", "", rng)).includes("ШПИОН"));
  // Two of four press "vote now" → vote starts.
  game = apply(game, onAction(game, ps[0], "votenow", "", rng));
  game = apply(game, onAction(game, ps[1], "votenow", "", rng));
  assertEquals(game.phase, "vote");
  let step: Step | undefined;
  for (const p of ps) {
    step = onAction(game, p, "vote", String(p.id === spy ? other.id : spy), rng);
    game = apply(game, step);
  }
  assert(step!.finished && says(step!).includes("Шпион пойман"));

  let g2 = lobby("spy", 3, seq(9)).game;
  g2 = apply(g2, onAction(g2, P(1)[0], "start", "", seq(9)));
  const s2 = onText(g2, { id: g2.state.spy, name: "" }, `локация ${g2.state.location}`)!;
  assert(s2.finished && says(s2).includes("Победил шпион"));
  assertEquals(onText(g2, { id: g2.state.spy === 1 ? 2 : 1, name: "" }, "локация Банк"), null, "only the spy can guess");
});

Deno.test("crocodile: host sees the word, a guess passes the turn, game ends after misses", () => {
  const rng = seq(13);
  let { game, step } = create("crocodil-0000", "crocodile", { id: 1, name: "Host" }, rng);
  game = apply(game, step);
  const word = game.state.word as string;
  assert(alertOf(onAction(game, { id: 1, name: "Host" }, "word", "", rng)).includes(word.toUpperCase()));
  assert(alertOf(onAction(game, { id: 2, name: "B" }, "word", "", rng)).includes("только ведущий"));
  assertEquals(onText(game, { id: 1, name: "Host" }, word), null, "the host cannot guess");
  assertEquals(onText(game, { id: 2, name: "B" }, "может быть кот?"), null);
  const s = onText(game, { id: 2, name: "B" }, `Это ${word.toUpperCase().replace("Ё", "Е")}!`)!;
  game = apply(game, s);
  assertEquals(game.state.host, 2);
  assertEquals(game.state.scores[2], 1);
  game = apply(game, onTimeout(game, rng));
  const end = onTimeout(game, rng);
  assert(end.finished, "two missed rounds in a row end the game");
  assert(!end.effects.some((e) => e.t === "reward"), "no reward with fewer than 3 people");
  assert(LIMITS.crocodile.min === 2);
});

Deno.test("amounts: suffixes, all, garbage", () => {
  assertEquals(parseAmount("1000"), { all: false, value: 1000 });
  assertEquals(parseAmount("1к"), { all: false, value: 1000 });
  assertEquals(parseAmount("2.5кк"), { all: false, value: 2_500_000 });
  assertEquals(parseAmount("1,5k"), { all: false, value: 1500 });
  assertEquals(parseAmount("3млрд"), { all: false, value: 3e9 });
  assertEquals(parseAmount("все"), { all: true });
  assertEquals(parseAmount("всё"), { all: true });
  assertEquals(parseAmount("abc"), null);
  assertEquals(parseAmount("-5"), null);
  assertEquals(parseAmount("0"), null);
  assertEquals(parseAmount("5х"), null);
});

Deno.test("chat commands: aliases, phrases, slash, ordinary chat ignored", () => {
  const p = (t: string) => parseChat(t, "BayhanGame2_bot");
  assertEquals(p("Б")?.cmd, "balance");
  assertEquals(p("баланс")?.cmd, "balance");
  assertEquals(p("/balance@BayhanGame2_bot")?.cmd, "balance");
  assertEquals(p("казино 1к")?.args, ["1к"]);
  assertEquals(p("топ чата")?.cmd, "chattop");
  assertEquals(p("Купить BTC 5000")?.cmd, "btcbuy");
  assertEquals(p("перевод Vasya Pupkin 500")?.rest, "Vasya Pupkin 500");
  assertEquals(p("я сегодня устал"), null);
  assertEquals(p("б как дела"), null);
  assertEquals(p("привет всем"), null);
  assertEquals(p("мафия")?.cmd, "mafia");
  assertEquals(p("Ёжик"), null);
});
