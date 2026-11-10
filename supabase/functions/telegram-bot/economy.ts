// Economy commands for private chats and groups. Each one calls the same game RPC as the app.
import { parseAmount, type ChatCommand } from "../_shared/bot-commands.ts";
import { admin, BOT_USERNAME, rpc, SITE_URL } from "../_shared/telegram.ts";
import { NAMES } from "../_shared/names.ts";
import { call, type Ctx, esc, key, mention, money, n, name, need, openGame, reply, resolveAmount } from "./ctx.ts";

type Kind = "realty" | "car" | "business" | "luxury";
const KINDS: { kind: Kind; table: string; prefix: string; title: string; mine: string }[] = [
  { kind: "realty", table: "realty_items", prefix: "realty_", title: "🏠 Недвижимость", mine: "user_realty" },
  { kind: "car", table: "car_items", prefix: "car_", title: "🚗 Машины", mine: "user_cars" },
  { kind: "business", table: "business_items", prefix: "business_", title: "🏭 Бизнесы", mine: "user_businesses" },
  { kind: "luxury", table: "luxury_items", prefix: "lux_", title: "💎 Роскошь", mine: "user_luxury" },
];
const RESOURCES = ["wood", "stone", "iron", "diamond", "energy"];
const JOBS = ["courier", "taxi", "mechanic", "programmer", "engineer", "financier", "entrepreneur", "director"];
const lc = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();

/** Finds a catalogue code by code or Russian name ("Частный остров", "island", "Bugatti Chiron"). */
function findCode(query: string, prefixes: string[]): { prefix: string; code: string } | null {
  const q = lc(query).replace(/^["«]|["»]$/g, "");
  if (!q) return null;
  for (const prefix of prefixes) {
    for (const [k, v] of Object.entries(NAMES)) {
      if (!k.startsWith(prefix)) continue;
      const code = k.slice(prefix.length);
      if (code === q.replace(/\s+/g, "_") || lc(v) === q) return { prefix, code };
    }
  }
  for (const prefix of prefixes) {
    for (const [k, v] of Object.entries(NAMES)) if (k.startsWith(prefix) && lc(v).includes(q) && q.length >= 3) return { prefix, code: k.slice(prefix.length) };
  }
  return null;
}
const kindOf = (prefix: string) => KINDS.find((k) => k.prefix === prefix)!;
const uid = async (ctx: Ctx) => (await call(ctx, "get_my_snapshot")).user_id as string;

// ------------------------------------------------------------------ views ----
export async function balance(ctx: Ctx) {
  const s = await call(ctx, "get_my_snapshot");
  return reply(ctx,
    `💰 <b>${esc(s.game_name)}</b>\n\n💵 Наличные: <b>${money(s.cash)}</b>\n🏦 Банк: ${money(s.bank)}\n` +
    `₿ BTC: ${n(s.btc)} (≈ ${money(n(s.btc) * n(s.btc_rate))})\n🏠 Активы: ${money(s.assets_value)}\n\n💼 Капитал: <b>${money(s.total_capital)}</b>`);
}

export async function profile(ctx: Ctx) {
  const p = await call(ctx, "my_profile");
  const s = await call(ctx, "get_my_snapshot");
  const vip = await call(ctx, "my_vip");
  const per = n(s.xp_per_level) || 500;
  return reply(ctx,
    `👤 <b>${esc(p.game_name)}</b> · ID ${p.public_id}${vip?.active ? ` · 👑 VIP ${vip.level}` : ""}\n` +
    `⭐ Уровень ${p.level} · ${n(p.xp) % per}/${per} XP\n\n💼 Капитал: <b>${money(s.total_capital)}</b>\n💵 Наличные: ${money(s.cash)} · 🏦 ${money(s.bank)}\n` +
    `🏠 Активы: ${money(s.assets_value)} · 🚗 машин: ${s.cars_owned}\n\n🎲 Игр: ${p.stats.games_played} · побед: ${p.stats.games_won}\n` +
    `🛠 Смен: ${p.stats.shifts} · ⛏ добыч: ${p.stats.mined}\n🔑 Логин для браузера: <code>${esc(p.login)}</code>`,
    openGame(ctx, BOT_USERNAME));
}

export async function daily(ctx: Ctx) {
  const st = await call(ctx, "daily_status");
  if (!st.can_claim) {
    const h = Math.max(1, Math.ceil((new Date(st.next_at).getTime() - Date.now()) / 3_600_000));
    return reply(ctx, `⏳ Бонус уже получен. Следующий примерно через ${h} ч. Серия: ${st.streak}/7.`);
  }
  const r = await call(ctx, "claim_daily", { p_idempotency_key: key(ctx) });
  if (r.status === "duplicate") return;
  return reply(ctx, `🎁 ${mention(ctx.from)} получает <b>+${money(r.reward)}</b> — бонус дня ${r.streak}/7!`);
}

export async function work(ctx: Ctx, c: ChatCommand) {
  const jobs: any[] = await call(ctx, "my_jobs");
  if (!c.rest) {
    const now = Date.now();
    const rows = jobs.map((j) => {
      const wait = j.next_available_at ? new Date(j.next_available_at).getTime() - now : 0;
      const status = !j.eligible ? `🔒 ${j.require_car ? "нужна машина" : `капитал от ${money(j.min_capital)}`}`
        : wait > 0 ? `⏳ ${Math.ceil(wait / 60000)} мин` : "✅ можно";
      return `• <b>${name(`job_${j.key}`, j.key)}</b> — ${money(j.income_min)}–${money(j.income_max)} · ${status}`;
    });
    return reply(ctx, `🛠 <b>Работа</b>\n\n${rows.join("\n")}\n\nНапишите «работа курьер» (или название другой профессии).`);
  }
  const q = lc(c.rest);
  const job = JOBS.find((j) => j === q || lc(name(`job_${j}`)) === q || lc(name(`job_${j}`)).startsWith(q));
  if (!job) return reply(ctx, "Нет такой профессии. Напишите «работа», чтобы увидеть список.");
  const r = await call(ctx, "work_shift", { p_job: job, p_idempotency_key: key(ctx) });
  if (r.status === "duplicate") return;
  return reply(ctx, `🛠 ${mention(ctx.from)} отработал(а) смену «${name(`job_${job}`)}»: <b>+${money(r.salary)}</b>, +${r.xp} XP.`);
}

export async function top(ctx: Ctx, chatOnly: boolean) {
  const medal = ["🥇", "🥈", "🥉"];
  const list: any[] = chatOnly ? await rpc("tg_chat_top", { p_chat: ctx.chat.id, p_limit: 10 }) : await rpc("tg_call", { p_tg: 0, p_fn: "leaderboard", p_arg: "10" });
  const rows = list.map((r) => `${medal[r.rank - 1] ?? `${r.rank}.`} ${esc(r.game_name)} — ${money(r.total_capital)}`);
  const title = chatOnly ? "🏆 <b>Топ этого чата</b>" : "🏆 <b>Топ игроков BAYHAN GAME</b>";
  const hint = chatOnly ? "" : ctx.isPrivate ? "" : "\n\nТоп только этого чата: «топ чата».";
  return reply(ctx, `${title}\n\n${rows.join("\n") || "Пока пусто — сыграйте хоть раз в этом чате."}${hint}`);
}

export async function corpTop(ctx: Ctx) {
  const list: any[] = await call(ctx, "leaderboard_corporations", { p_limit: 10 });
  return reply(ctx, `🏢 <b>Топ корпораций</b>\n\n${list.map((r) => `${r.rank}. ${esc(r.name)} — ур. ${r.level}, ${r.members} 👥, ${r.prestige} ★`).join("\n") || "Пока нет корпораций."}`);
}

// ------------------------------------------------------------------- bank ----
export async function bank(ctx: Ctx, c: ChatCommand) {
  if (c.cmd === "bankin" || c.cmd === "bankout") {
    const amt = await resolveAmount(ctx, parseAmount(c.args[0]));
    if (c.cmd === "bankout" && parseAmount(c.args[0])?.all) {
      const s = await call(ctx, "get_my_snapshot");
      return bankMove(ctx, "bank_withdraw", n(s.bank));
    }
    if (!amt) return reply(ctx, `Укажите сумму: «${c.cmd === "bankin" ? "положить" : "снять"} 10к».`);
    return bankMove(ctx, c.cmd === "bankin" ? "bank_deposit" : "bank_withdraw", amt);
  }
  if (c.cmd === "deposit") {
    const amt = await resolveAmount(ctx, parseAmount(c.args[0]));
    const days = Number(c.args[1]);
    if (!amt || ![30, 90, 180].includes(days)) return reply(ctx, "Вклад: «вклад 100к 30» — срок 30, 90 или 180 дней (3%, 8%, 15%).");
    const r = await call(ctx, "deposit_open", { p_amount: amt, p_days: days, p_idempotency_key: key(ctx) });
    return reply(ctx, r.status === "duplicate" ? "Уже открыт." : `🏦 Вклад ${money(amt)} на ${days} дн. открыт. Забрать после срока: «вклады».`);
  }
  if (c.cmd === "deposits") {
    const { data } = await admin().from("bank_deposits").select("id, amount, rate_percent, days, ends_at").eq("user_id", await uid(ctx)).eq("claimed", false).order("id");
    const open = data ?? [];
    // Matured deposits are paid out right here, through the same deposit_claim as in the app.
    const paid: string[] = [];
    for (const d of open) {
      if (new Date(d.ends_at).getTime() <= Date.now()) {
        try {
          const r = await call(ctx, "deposit_claim", { p_deposit: d.id });
          paid.push(`✅ Вклад №${d.id}: получено ${money(r.payout)} (проценты ${money(r.interest)})`);
        } catch { /* shown in the list below */ }
      }
    }
    const rows = open.filter((d: any) => new Date(d.ends_at).getTime() > Date.now()).map((d: any) => `№${d.id}: ${money(d.amount)} под ${d.rate_percent}% до ${new Date(d.ends_at).toLocaleDateString("ru-RU")}`);
    return reply(ctx, `🏦 <b>Вклады</b>\n\n${[...paid, ...rows].join("\n") || "Нет открытых вкладов. Открыть: «вклад 100к 30»."}`);
  }
  const s = await call(ctx, "get_my_snapshot");
  return reply(ctx, `🏦 <b>Банк</b>\n\nНа счету: <b>${money(s.bank)}</b>\nНаличные: ${money(s.cash)}\n\n` +
    `«положить 10к» · «снять все» · «вклад 100к 30» (30/90/180 дн.: 3/8/15%) · «вклады»`);
}

async function bankMove(ctx: Ctx, fn: string, amount: number) {
  if (amount <= 0) return reply(ctx, "Нечего переводить.");
  const r = await call(ctx, fn, { p_amount: amount, p_idempotency_key: key(ctx) });
  if (r?.status === "duplicate") return;
  const s = await call(ctx, "get_my_snapshot");
  return reply(ctx, `🏦 ${fn === "bank_deposit" ? "Положено" : "Снято"} ${money(amount)}. Банк: ${money(s.bank)}, наличные: ${money(s.cash)}.`);
}

export async function btc(ctx: Ctx, c: ChatCommand) {
  if (c.cmd === "btcbuy") {
    const usd = await resolveAmount(ctx, parseAmount(c.args[0]));
    if (!usd) return reply(ctx, "Купить: «купить btc 10к» (сумма в долларах).");
    const r = await call(ctx, "btc_buy", { p_usd: usd, p_idempotency_key: key(ctx) });
    if (r.status === "duplicate") return;
    return reply(ctx, `₿ Куплено ${n(r.btc)} BTC за ${money(usd)} (курс ${money(r.rate)}).`);
  }
  if (c.cmd === "btcsell") {
    const s = await call(ctx, "get_my_snapshot");
    const a = (c.args[0] ?? "").toLowerCase();
    const amount = ["все", "всё", "all"].includes(a) ? n(s.btc) : Number(a.replace(",", "."));
    if (!(amount > 0)) return reply(ctx, "Продать: «продать btc 0.5» или «продать btc все».");
    const r = await call(ctx, "btc_sell", { p_btc: Math.floor(amount * 1e8) / 1e8, p_idempotency_key: key(ctx) });
    if (r.status === "duplicate") return;
    return reply(ctx, `₿ Продано ${amount} BTC: +${money(r.usd)}.`);
  }
  const s = await call(ctx, "get_my_snapshot");
  return reply(ctx, `₿ <b>Биткоин</b>\n\nКурс: ${money(s.btc_rate)}\nУ вас: ${n(s.btc)} BTC (≈ ${money(n(s.btc) * n(s.btc_rate))})\n\n«купить btc 10к» · «продать btc все»`);
}

// --------------------------------------------------------------- transfer ----
export async function transfer(ctx: Ctx, c: ChatCommand) {
  let to: string | null = null;
  let amountArg: string | undefined;
  if (ctx.replyTo && !ctx.replyTo.is_bot) {
    to = await rpc<string | null>("tg_game_name", { p_tg: ctx.replyTo.id });
    if (!to) return reply(ctx, `У ${mention(ctx.replyTo)} нет аккаунта BAYHAN GAME.`);
    amountArg = c.args[0];
  } else if (c.args.length >= 2) {
    amountArg = c.args[c.args.length - 1];
    to = c.args.slice(0, -1).join(" ").replace(/^@/, "");
  }
  const amount = await resolveAmount(ctx, parseAmount(amountArg));
  if (!to || !amount) return reply(ctx, "Перевод: ответьте на сообщение игрока «перевод 1000» или напишите «перевод Ник 1000».");
  const r = await call(ctx, "transfer_funds", { p_to_game_name: to, p_amount: amount, p_idempotency_key: key(ctx) });
  if (r.status === "duplicate") return;
  return reply(ctx, `💸 ${mention(ctx.from)} перевёл(а) <b>${money(amount)}</b> игроку ${esc(to)}${n(r.fee) ? ` (комиссия ${money(r.fee)})` : ""}.`);
}

// ----------------------------------------------------------------- assets ----
export async function shop(ctx: Ctx, c: ChatCommand) {
  const target = { realty: "realty", cars: "car", business: "business", luxury: "luxury" }[c.cmd as string] as Kind | undefined;
  if (!target) {
    return reply(ctx, `🛒 <b>Магазин BAYHAN</b>\n\n«недвижимость» · «машины» · «бизнесы» · «роскошь»\n«кейсы» · «ресурсы»\n\n` +
      `Купить: «купить Частный остров» или по коду. Продать: «продать <название>». Улучшить: «улучшить <название>».`);
  }
  const k = KINDS.find((x) => x.kind === target)!;
  const { data } = await admin().from(k.table).select("*").eq("active", true).order("price");
  const rows = (data ?? []).map((i: any) => {
    const extra = i.income_per_hour ? ` · ${money(i.income_per_hour)}/ч` : i.max_speed ? ` · ${i.max_speed} км/ч` : "";
    return `• ${esc(name(k.prefix + i.code, i.code))} — <b>${money(i.price)}</b>${extra}`;
  });
  return reply(ctx, `${k.title}\n\n${rows.join("\n")}\n\nКупить: «купить ${esc(name(k.prefix + (data?.[0]?.code ?? ""), ""))}»`);
}

export async function assetOp(ctx: Ctx, c: ChatCommand) {
  if (!c.rest) return reply(ctx, `Укажите, что именно: «${c.args.length ? c.cmd : { buy: "купить", sell: "продать", upgrade: "улучшить", hire: "нанять" }[c.cmd]} <название>».`);
  // Resources: "купить дерево 10", "продать железо все".
  const last = c.args[c.args.length - 1];
  const res = findCode(c.args.slice(0, -1).join(" ") || c.rest, ["res_"]);
  if ((c.cmd === "buy" || c.cmd === "sell") && res && RESOURCES.includes(res.code)) {
    const qtyText = c.args.length > 1 ? last : "1";
    if (c.cmd === "buy") {
      const qty = Math.floor(Number(qtyText));
      if (!(qty > 0)) return reply(ctx, "Количество: «купить дерево 10».");
      const r = await call(ctx, "shop_buy", { p_code: `buy_${res.code}`, p_qty: qty, p_idempotency_key: key(ctx) });
      if (r.status === "duplicate") return;
      return reply(ctx, `🛒 Куплено: ${name(`res_${res.code}`)} × ${qty} за ${money(r.total)}.`);
    }
    const { data } = await admin().from("user_resources").select("amount").eq("user_id", await uid(ctx)).eq("code", res.code).maybeSingle();
    const have = n(data?.amount);
    const qty = ["все", "всё"].includes(lc(qtyText)) ? have : Math.floor(Number(qtyText));
    if (!(qty > 0)) return reply(ctx, `У вас ${have} шт. Продать: «продать ${name(`res_${res.code}`).toLowerCase()} все».`);
    const r = await call(ctx, "sell_resource", { p_code: res.code, p_amount: qty, p_idempotency_key: key(ctx) });
    if (r.status === "duplicate") return;
    return reply(ctx, `💰 Продано: ${name(`res_${res.code}`)} × ${qty} = <b>+${money(r.usd)}</b>.`);
  }

  const found = findCode(c.rest, KINDS.map((k) => k.prefix));
  if (!found) return reply(ctx, "Не нашёл такой предмет. Посмотрите «магазин».");
  const kind = kindOf(found.prefix).kind;
  const fn = { buy: "asset_buy", sell: "asset_sell", upgrade: "asset_upgrade", hire: "business_hire" }[c.cmd as "buy"]!;
  if (c.cmd === "hire" && kind !== "business") return reply(ctx, "Нанимать сотрудников можно только в бизнес.");
  const args = c.cmd === "hire" ? { p_code: found.code, p_idempotency_key: key(ctx) } : { p_kind: kind, p_code: found.code, p_idempotency_key: key(ctx) };
  const r = await call(ctx, fn, args);
  if (r?.status === "duplicate") return;
  const title = esc(name(found.prefix + found.code, found.code));
  const verb = { buy: `🎉 ${mention(ctx.from)} купил(а) <b>${title}</b>!`, sell: `💰 ${title} продано: <b>+${money(r?.proceeds)}</b>.`,
    upgrade: `⬆️ ${title} улучшено до уровня ${r?.level} за ${money(r?.cost)}.`, hire: `👷 В ${title} нанят сотрудник (всего ${r?.employees}) за ${money(r?.cost)}.` }[c.cmd as "buy"];
  return reply(ctx, verb);
}

export async function collect(ctx: Ctx) {
  const r = await call(ctx, "collect_income", { p_kind: null });
  const total = n(r?.total);
  return reply(ctx, total > 0 ? `💼 Доход собран: <b>+${money(total)}</b>.` : "💼 Пока нечего собирать: доход копится каждый час.");
}

export async function assets(ctx: Ctx) {
  const id = await uid(ctx);
  const parts: string[] = [];
  for (const k of KINDS) {
    const { data } = await admin().from(k.mine).select("*").eq("user_id", id);
    if (!data?.length) continue;
    parts.push(`${k.title}\n${data.map((a: any) => `• ${esc(name(k.prefix + a.code, a.code))}${a.level > 1 ? ` (ур. ${a.level})` : ""}${a.employees ? ` · 👷 ${a.employees}` : ""}`).join("\n")}`);
  }
  const { data: res } = await admin().from("user_resources").select("code, amount").eq("user_id", id).gt("amount", 0);
  if (res?.length) parts.push(`⛏ Ресурсы\n${res.map((r: any) => `• ${name(`res_${r.code}`, r.code)}: ${r.amount}`).join("\n")}`);
  return reply(ctx, `📦 <b>Имущество</b>\n\n${parts.join("\n\n") || "Пока ничего нет. Загляните в «магазин»."}\n\nСобрать доход: «собрать».`);
}

export async function mine(ctx: Ctx) {
  const r = await call(ctx, "mine_resources");
  const got = Object.entries(r?.rewards ?? {}).filter(([, v]) => n(v) > 0).map(([k, v]) => `${name(`res_${k}`, k)} × ${v}`);
  return reply(ctx, `⛏ ${mention(ctx.from)} копает… ${got.length ? `Найдено: ${got.join(", ")}.` : "Сегодня пусто."}\nПродать: «продать дерево все».`);
}

export async function resources(ctx: Ctx) {
  const { data } = await admin().from("resources").select("code, buy_price, sell_price").eq("enabled", true).order("sort_order");
  const { data: mineRows } = await admin().from("user_resources").select("code, amount").eq("user_id", await uid(ctx));
  const have = Object.fromEntries((mineRows ?? []).map((r: any) => [r.code, r.amount]));
  return reply(ctx, `⛏ <b>Ресурсы</b>\n\n${(data ?? []).map((r: any) => `• ${name(`res_${r.code}`, r.code)}: у вас ${have[r.code] ?? 0} · купить ${money(r.buy_price)} · продать ${money(r.sell_price)}`).join("\n")}\n\n«добыча» · «купить дерево 10» · «продать дерево все»`);
}

export async function cases(ctx: Ctx, c: ChatCommand) {
  if (c.cmd === "case" && c.rest) {
    const f = findCode(c.rest, ["case_"]);
    if (!f) return reply(ctx, "Нет такого кейса. Список: «кейсы».");
    const r = await call(ctx, "open_case", { p_code: f.code, p_idempotency_key: key(ctx) });
    if (r.status === "duplicate") return;
    const rw = r.reward ?? {};
    const what = rw.reward_type === "resource" ? `${name(`res_${rw.resource_code}`, rw.resource_code)} × ${n(rw.amount)}`
      : rw.reward_type === "btc" ? `${n(rw.amount)} BTC` : money(rw.amount);
    return reply(ctx, `🎁 ${mention(ctx.from)} открывает кейс «${name(`case_${f.code}`)}»… Выпало: <b>${what}</b>!`);
  }
  const { data } = await admin().from("cases").select("code, price").eq("active", true).order("sort_order");
  return reply(ctx, `🎁 <b>Кейсы</b>\n\n${(data ?? []).map((x: any) => `• ${name(`case_${x.code}`, x.code)} — ${money(x.price)}`).join("\n")}\n\nОткрыть: «кейс Золотой».`);
}

export async function promo(ctx: Ctx, c: ChatCommand) {
  if (!c.args[0]) return reply(ctx, "Промокод: «промо КОД».");
  const r = await call(ctx, "redeem_promo", { p_code: c.args[0] });
  return reply(ctx, `🎟 Промокод активирован: ${[n(r.usd) ? money(r.usd) : "", n(r.btc) ? `${n(r.btc)} BTC` : ""].filter(Boolean).join(" + ") || "награда получена"}!`);
}

const QUEST_NAMES: Record<string, string> = {
  play_5_games: "Сыграть 5 игр", win_3_games: "Выиграть 3 игры", mine_10: "Добыть ресурсы 10 раз", invite_1: "Пригласить друга", earn_10000: "Заработать $10,000",
};
export async function quests(ctx: Ctx, c: ChatCommand) {
  const qs: any[] = await call(ctx, "my_quests");
  const as: any[] = await call(ctx, "my_achievements");
  if (c.cmd === "claimall") {
    let total = 0;
    for (const q of qs.filter((q) => !q.claimed && n(q.progress) >= n(q.target))) {
      try { const r = await call(ctx, "claim_quest", { p_code: q.code }); total += n(r.reward); } catch { /* claimed concurrently */ }
    }
    for (const a of as.filter((a) => !a.claimed && n(a.progress) >= n(a.condition_value))) {
      try { const r = await call(ctx, "claim_achievement", { p_code: a.code }); total += n(r.reward); } catch { /* claimed concurrently */ }
    }
    return reply(ctx, total ? `🏅 Награды за задания и достижения: <b>+${money(total)}</b>.` : "Нечего забирать — выполняйте задания.");
  }
  const mark = (done: boolean, claimed: boolean) => (claimed ? "✅" : done ? "🎁" : "▫️");
  const qRows = qs.map((q) => `${mark(n(q.progress) >= n(q.target), q.claimed)} ${QUEST_NAMES[q.code] ?? q.code} — ${Math.min(n(q.progress), n(q.target))}/${n(q.target)} · ${money(q.reward_usd)}`);
  const aDone = as.filter((a) => a.claimed).length;
  const ready = qs.some((q) => !q.claimed && n(q.progress) >= n(q.target)) || as.some((a) => !a.claimed && n(a.progress) >= n(a.condition_value));
  return reply(ctx, `📋 <b>Задания</b>\n\n${qRows.join("\n")}\n\n🏅 Достижения: ${aDone}/${as.length}${ready ? "\n\n🎁 Есть награды — напишите «забрать»." : ""}`);
}

export async function invite(ctx: Ctx) {
  const r = await call(ctx, "my_referrals");
  return reply(ctx, `👥 <b>Пригласить друга</b>\n\nДруг получит стартовый капитал, а вы — <b>${money(r.reward)}</b> после его 3 смен.\n\n` +
    `Telegram: https://t.me/${BOT_USERNAME}?start=ref_${r.code}\nБраузер: ${SITE_URL}/register?ref=${r.code}\n\nПриглашено: ${r.invited} · засчитано: ${r.qualified} · заработано: ${money(r.earned)}`);
}

export async function nick(ctx: Ctx, c: ChatCommand) {
  if (!c.rest) return reply(ctx, "Смена имени: «ник НовоеИмя» (3–20 символов: латиница, цифры, _ и пробел).");
  const r = await call(ctx, "rename_game_name", { p_name: c.rest });
  return reply(ctx, `✏️ Теперь вас зовут <b>${esc(r.game_name)}</b>.`);
}

export async function vipEvents(ctx: Ctx, c: ChatCommand) {
  if (c.cmd === "vip") {
    const v = await call(ctx, "my_vip");
    return reply(ctx, v?.active ? `👑 VIP ${v.level} до ${new Date(v.ends_at).toLocaleDateString("ru-RU")} · множитель наград ×${v.multiplier}.` : "👑 VIP не активен. VIP выдаёт администрация.");
  }
  const { data } = await admin().from("events").select("title, description, multiplier, ends_at").eq("active", true).lte("starts_at", new Date().toISOString()).gte("ends_at", new Date().toISOString());
  return reply(ctx, `🎉 <b>События</b>\n\n${(data ?? []).map((e: any) => `• <b>${esc(e.title)}</b> ×${e.multiplier} до ${new Date(e.ends_at).toLocaleDateString("ru-RU")}\n${esc(e.description)}`).join("\n\n") || "Сейчас событий нет."}`);
}

export async function history(ctx: Ctx) {
  const { data } = await admin().from("ledger_entries").select("amount, direction, reason, created_at").eq("user_id", await uid(ctx)).order("created_at", { ascending: false }).limit(10);
  return reply(ctx, `📜 <b>Последние операции</b>\n\n${(data ?? []).map((e: any) => `${e.direction === "credit" ? "🟢 +" : "🔴 −"}${money(e.amount)} · ${esc(e.reason)}`).join("\n") || "Пока пусто."}`);
}

// ------------------------------------------------------- corp & marriage ----
export async function corp(ctx: Ctx, c: ChatCommand) {
  const sub = lc(c.args[0] ?? "");
  const rest = c.args.slice(1).join(" ");
  if (sub === "создать") {
    if (!rest) return reply(ctx, "«корпа создать Название»");
    await call(ctx, "corp_create", { p_name: rest, p_description: "", p_idempotency_key: key(ctx) });
    return reply(ctx, `🏢 Корпорация <b>${esc(rest)}</b> основана!`);
  }
  if (sub === "вложить" || sub === "снять") {
    const amt = await resolveAmount(ctx, parseAmount(c.args[1]));
    if (!amt) return reply(ctx, `«корпа ${sub} 10к»`);
    await call(ctx, sub === "вложить" ? "corp_deposit" : "corp_withdraw", { p_amount: amt, p_idempotency_key: key(ctx) });
    return reply(ctx, `🏢 ${sub === "вложить" ? "В казну внесено" : "Из казны снято"} ${money(amt)}.`);
  }
  if (sub === "выйти") {
    await call(ctx, "corp_leave");
    return reply(ctx, "🏢 Вы покинули корпорацию.");
  }
  if (sub === "пригласить") {
    const target = ctx.replyTo ? await rpc<string | null>("tg_game_name", { p_tg: ctx.replyTo.id }) : rest;
    if (!target) return reply(ctx, "Ответьте на сообщение игрока «корпа пригласить» или напишите «корпа пригласить Ник».");
    await call(ctx, "corp_invite", { p_game_name: target });
    return reply(ctx, `📨 ${esc(target)} приглашён(а) в корпорацию. Принять: «корпа» → кнопка.`);
  }
  const r = await call(ctx, "my_corporation");
  if (!r?.corp) {
    const invites: any[] = r?.invites ?? [];
    return reply(ctx, `🏢 Вы не в корпорации.\n\n«корпа создать Название»${invites.length ? "\n\nПриглашения:" : ""}`,
      invites.length ? invites.map((i) => [{ text: `✅ ${i.corp}`, callback_data: `ci:${i.id}:1` }, { text: "✖️", callback_data: `ci:${i.id}:0` }]) : undefined);
  }
  return reply(ctx, `🏢 <b>${esc(r.corp.name)}</b> · ур. ${r.corp.level} · ${r.corp.prestige} ★\nКазна: ${money(r.corp.treasury)}\nВаша роль: ${esc(r.role)}\n\n` +
    `Участники:\n${(r.members ?? []).map((m: any) => `• ${esc(m.game_name)} (${esc(m.role)})`).join("\n")}\n\n«корпа вложить 10к» · «корпа пригласить» (ответом) · «корпа выйти» · «топ корп»`);
}

export async function marry(ctx: Ctx, c: ChatCommand) {
  if (c.cmd === "divorce") {
    await call(ctx, "marriage_divorce");
    return reply(ctx, "💔 Брак расторгнут.");
  }
  const target = ctx.replyTo && !ctx.replyTo.is_bot ? await rpc<string | null>("tg_game_name", { p_tg: ctx.replyTo.id }) : c.rest || null;
  if (!target) {
    const m = await call(ctx, "my_marriage");
    if (m?.partner) return reply(ctx, `💍 Вы в браке с <b>${esc(m.partner.game_name)}</b> с ${new Date(m.partner.since).toLocaleDateString("ru-RU")}.`);
    const inc: any[] = m?.incoming ?? [];
    return reply(ctx, inc.length ? "💌 Вам сделали предложение:" : "💍 Вы не в браке. Сделать предложение: ответьте на сообщение игрока «брак».",
      inc.length ? inc.map((p: any) => [{ text: `💍 Да, ${p.from}`, callback_data: `mr:${p.id}:1` }, { text: "Нет", callback_data: `mr:${p.id}:0` }]) : undefined);
  }
  await call(ctx, "marriage_propose", { p_game_name: target });
  const toUser = ctx.replyTo ? mention(ctx.replyTo) : esc(target);
  return reply(ctx, `💌 ${mention(ctx.from)} делает предложение ${toUser}! Ответить: написать «брак» без имени.`);
}

export const NEED_ACCOUNT = new Set(["balance", "profile", "daily", "work", "bank", "bankin", "bankout", "deposit", "deposits", "btc", "btcbuy", "btcsell",
  "transfer", "buy", "sell", "upgrade", "hire", "collect", "assets", "mine", "resources", "case", "promo", "quests", "claimall", "achievements",
  "invite", "nick", "corp", "marry", "divorce", "vip", "history"]);

export async function handle(ctx: Ctx, c: ChatCommand): Promise<boolean> {
  if (NEED_ACCOUNT.has(c.cmd) && !(await need(ctx))) return true;
  switch (c.cmd) {
    case "balance": await balance(ctx); return true;
    case "profile": await profile(ctx); return true;
    case "daily": await daily(ctx); return true;
    case "work": await work(ctx, c); return true;
    case "top": await top(ctx, false); return true;
    case "chattop": await top(ctx, true); return true;
    case "corptop": await corpTop(ctx); return true;
    case "bank": case "bankin": case "bankout": case "deposit": case "deposits": await bank(ctx, c); return true;
    case "btc": case "btcbuy": case "btcsell": await btc(ctx, c); return true;
    case "transfer": await transfer(ctx, c); return true;
    case "shop": case "realty": case "cars": case "business": case "luxury": await shop(ctx, c); return true;
    case "buy": case "sell": case "upgrade": case "hire": await assetOp(ctx, c); return true;
    case "collect": await collect(ctx); return true;
    case "assets": await assets(ctx); return true;
    case "mine": await mine(ctx); return true;
    case "resources": await resources(ctx); return true;
    case "cases": case "case": await cases(ctx, c); return true;
    case "promo": await promo(ctx, c); return true;
    case "quests": case "achievements": case "claimall": await quests(ctx, c); return true;
    case "invite": await invite(ctx); return true;
    case "nick": await nick(ctx, c); return true;
    case "vip": case "events": await vipEvents(ctx, c); return true;
    case "history": await history(ctx); return true;
    case "corp": await corp(ctx, c); return true;
    case "marry": case "divorce": await marry(ctx, c); return true;
  }
  return false;
}
