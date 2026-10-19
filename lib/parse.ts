/**
 * Parses an amount typed by a person: "10 000", "10000", "1,5", "1.5", "-250", "$1 200".
 * A comma is a decimal separator (RU/UZ habit) unless a dot is also present, in which case commas group thousands.
 * Returns null when the text is not a number.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s $₿]/g, "");
  if (!s) return null;
  s = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** True when `n` has no more than `decimals` digits after the point. */
export const hasDecimals = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals === n;
