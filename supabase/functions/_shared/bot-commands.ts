// Bot menu labels and command parsing. No Deno or network code, so the Node tests import it too.

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
