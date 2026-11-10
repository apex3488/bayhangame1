// Bot menu labels, command and amount parsing. No Deno or network code, so tests import it too.

export const BTN = {
  play: "🎮 Играть",
  profile: "👤 Профиль",
  balance: "💰 Баланс",
  daily: "🎁 Ежедневная награда",
  top: "🏆 Рейтинг",
  tasks: "📋 Задания",
  invite: "👥 Пригласить друга",
  help: "ℹ️ Помощь",
};

const BUTTON_COMMANDS: Record<string, string> = {
  [BTN.play.toLowerCase()]: "/play",
  [BTN.profile.toLowerCase()]: "/profile",
  [BTN.balance.toLowerCase()]: "/balance",
  [BTN.daily.toLowerCase()]: "/daily",
  [BTN.top.toLowerCase()]: "/top",
  [BTN.tasks.toLowerCase()]: "/tasks",
  [BTN.invite.toLowerCase()]: "/invite",
  [BTN.help.toLowerCase()]: "/help",
};

/**
 * Menu buttons send their whole label ("🏆 Рейтинг"), commands send "/top arg" or "/top@Bot":
 * the label is matched first, then the first word as a command.
 */
export function parseCommand(text: string, botUsername: string) {
  const trimmed = text.trim();
  const [first, ...rest] = trimmed.split(/\s+/);
  const cmd = BUTTON_COMMANDS[trimmed.toLowerCase()] ?? first.replace(new RegExp(`@${botUsername}$`, "i"), "").toLowerCase();
  return { cmd, arg: BUTTON_COMMANDS[trimmed.toLowerCase()] ? "" : rest.join(" ") };
}

// ------------------------------------------------------------------ amounts ----
export type Amount = { all: true } | { all: false; value: number };

const SUFFIX: [RegExp, number][] = [
  [/^(млрд|b|ккк|kkk)$/, 1e9],
  [/^(трлн|t|кккк|kkkk)$/, 1e12],
  [/^(кк|kk|м|m|млн)$/, 1e6],
  [/^(к|k|тыс)$/, 1e3],
];

/** "1000", "1 000", "1к", "2.5кк", "3млн", "1,5k", "все" → amount; null when it is not an amount. */
export function parseAmount(raw: string | undefined): Amount | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\$/g, "");
  if (["все", "всё", "all", "вабанк", "ва-банк"].includes(s)) return { all: true };
  const m = s.match(/^(\d+(?:[.,]\d+)?)([a-zа-я]*)$/);
  if (!m) return null;
  let v = Number(m[1].replace(",", "."));
  if (m[2]) {
    const mult = SUFFIX.find(([re]) => re.test(m[2]))?.[1];
    if (!mult) return null;
    v *= mult;
  }
  v = Math.round(v * 100) / 100;
  return Number.isFinite(v) && v > 0 ? { all: false, value: v } : null;
}

// ----------------------------------------------------------------- commands ----
/** Normalised Russian command → internal key. Two-word phrases are checked before single words. */
const PHRASES: Record<string, string> = {
  "топ чата": "chattop", "топ чат": "chattop", "топ корп": "corptop", "топ корпораций": "corptop",
  "мой бизнес": "assets", "мои активы": "assets", "моё имущество": "assets", "мое имущество": "assets",
  "открыть кейс": "case", "купить btc": "btcbuy", "купить биткоин": "btcbuy", "продать btc": "btcsell",
  "продать биткоин": "btcsell", "забрать награды": "claimall", "забрать задания": "claimall",
  "стоп игра": "partystop", "остановить игру": "partystop", "настройки чата": "chatsettings",
};
const WORDS: Record<string, string> = {
  "помощь": "help", "команды": "help", "хелп": "help", "help": "help", "start": "start",
  "б": "balance", "баланс": "balance", "бал": "balance", "balance": "balance",
  "профиль": "profile", "п": "profile", "я": "profile", "profile": "profile", "стата": "profile",
  "бонус": "daily", "ежедневка": "daily", "ежедневный": "daily", "daily": "daily",
  "работа": "work", "работать": "work", "work": "work",
  "топ": "top", "top": "top", "рейтинг": "top",
  "игры": "games", "games": "games",
  "казино": "casino", "рулетка": "spin", "спин": "spin", "колесо": "spin", "слоты": "slots", "слот": "slots",
  "кубик": "dice", "кости": "dice", "баскетбол": "basketball", "дартс": "darts", "боулинг": "bowling",
  "вверх": "up", "вниз": "down", "трейд": "trade", "краш": "crash", "crash": "crash", "мины": "mines", "mines": "mines",
  "банк": "bank", "положить": "bankin", "снять": "bankout", "вклад": "deposit", "вклады": "deposits",
  "btc": "btc", "биткоин": "btc", "бтц": "btc", "крипта": "btc",
  "перевод": "transfer", "перевести": "transfer", "дать": "transfer", "передать": "transfer",
  "магазин": "shop", "недвижимость": "realty", "дома": "realty", "машины": "cars", "авто": "cars", "гараж": "cars",
  "бизнесы": "business", "бизнес": "business", "роскошь": "luxury",
  "купить": "buy", "продать": "sell", "улучшить": "upgrade", "нанять": "hire",
  "собрать": "collect", "доход": "collect", "имущество": "assets", "активы": "assets",
  "добыча": "mine", "копать": "mine", "шахта": "mine", "ресурсы": "resources",
  "кейсы": "cases", "кейс": "case", "промо": "promo", "промокод": "promo",
  "задания": "quests", "квесты": "quests", "достижения": "achievements", "забрать": "claimall",
  "рефералы": "invite", "пригласить": "invite", "рефка": "invite", "ник": "nick",
  "корпа": "corp", "корпорация": "corp", "корп": "corp", "брак": "marry", "свадьба": "marry", "развод": "divorce",
  "вип": "vip", "vip": "vip", "события": "events", "ивенты": "events", "история": "history",
  "дуэль": "duel", "мафия": "mafia", "шпион": "spy", "крокодил": "crocodile",
  "настройки": "chatsettings", "привязать": "link", "игра": "play", "играть": "play", "админ": "admin", "admin": "admin",
  "выдать": "a_give", "отнять": "a_take", "бан": "a_ban", "разбан": "a_unban", "игрок": "a_player",
  "рассылка": "a_broadcast", "статистика": "a_stats", "стат": "a_stats",
  // English names behind the slash commands in the Telegram menu (/tasks, /mafia, ...).
  "tasks": "quests", "invite": "invite", "play": "play", "mafia": "mafia", "spy": "spy", "crocodile": "crocodile",
};

/**
 * How many words may follow each command. A longer message is ordinary chat ("я сегодня устал"
 * must not open the profile), unless it starts with "/".
 */
const MAX_ARGS: Record<string, number> = {
  casino: 1, spin: 1, slots: 1, dice: 2, basketball: 1, darts: 1, bowling: 1, up: 1, down: 1, trade: 2,
  crash: 2, mines: 2, bankin: 1, bankout: 1, deposit: 2, btcbuy: 1, btcsell: 1, transfer: 5, buy: 5,
  sell: 6, upgrade: 5, hire: 5, case: 3, promo: 4, nick: 4, corp: 8, marry: 4, duel: 1, chatsettings: 2,
  work: 3, top: 1, play: 2, vip: 6, a_give: 6, a_take: 6, a_ban: 20, a_unban: 4, a_player: 4, a_broadcast: 200, admin: 0,
};

export interface ChatCommand {
  cmd: string;
  args: string[];
  /** Everything after the command words, as typed (for nicknames and texts with spaces). */
  rest: string;
}

/**
 * Parses a chat message: "/balance", "/balance@Bot", "Баланс", "казино 1к", "топ чата".
 * Returns null for ordinary chat messages so the bot stays quiet in groups.
 */
export function parseChat(text: string, botUsername: string): ChatCommand | null {
  let t = text.trim();
  if (!t || t.length > 500) return null;
  const slash = t.startsWith("/");
  if (slash) t = t.slice(1).replace(new RegExp(`^(\\S+)@${botUsername}\\b`, "i"), "$1");
  const words = t.split(/\s+/);
  const lower = words.map((w) => w.toLowerCase().replace(/ё/g, "е"));
  const two = lower.slice(0, 2).join(" ");
  const phrase = PHRASES[two];
  const key = phrase ?? WORDS[lower[0]];
  if (!key) return null;
  const args = words.slice(phrase ? 2 : 1);
  if (!slash && args.length > (MAX_ARGS[key] ?? 0)) return null;
  return { cmd: key, args, rest: args.join(" ") };
}

/** Lowercase, ё→е, letters only: for comparing guesses and names. */
export function norm(s: string) {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}
