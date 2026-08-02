/** Formats Russian mobile numbers while preserving an editable +7 prefix. */
export function formatRussianPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (!digits.startsWith("7")) digits = "7" + digits;
  digits = digits.slice(0, 11);
  const code = digits.slice(1, 4);
  const first = digits.slice(4, 7);
  const second = digits.slice(7, 9);
  const third = digits.slice(9, 11);
  let result = "+7";
  if (code) result += ` (${code}`;
  if (code.length === 3) result += ")";
  if (first) result += ` ${first}`;
  if (second) result += ` ${second}`;
  if (third) result += ` ${third}`;
  return result;
}

/** API payloads use a stable E.164-like representation, not the display mask. */
export function normalizeRussianPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (!digits.startsWith("7")) digits = "7" + digits;
  return "+" + digits.slice(0, 11);
}
