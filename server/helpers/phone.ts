/**
 * Convert a phone number to E.164. US/Canada numbers typed without a country
 * code, e.g. "(555) 123-4567" or "1-555-123-4567", become +15551234567 (#34).
 */
export function toE164Phone(phone: string): string {
  const compact = phone.trim().replace(/[\s().-]/g, "");
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  const digits = compact.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return compact;
}

/**
 * Comparison key for two phone numbers that may be formatted differently.
 * "+1 (801) 808-6639", "18018086639" and "8018086639" all give the same key.
 */
export function phoneMatchKey(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function samePhone(a: unknown, b: unknown): boolean {
  const left = phoneMatchKey(a);
  return left.length > 0 && left === phoneMatchKey(b);
}
