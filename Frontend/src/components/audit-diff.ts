/** UI comparison only. The audited values themselves are never rewritten.
 * Optional empty/missing/null values and canonical number/string representations
 * are equivalent. Leading zeroes, punctuation, case and internal whitespace stay significant.
 * JSON object key order is irrelevant; array order remains significant.
 */
function canonical(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().flatMap(key => {
    const normalized = canonical((value as Record<string, unknown>)[key]);
    return normalized === null ? [] : [[key, normalized]];
  }));
  return value;
}
export function auditValueEqual(before: unknown, after: unknown) {
  return JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
}
export function auditAddress(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
