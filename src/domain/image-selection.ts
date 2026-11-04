/** Pure rules for the institutional image adapter; no networking or credentials.
 * Conservative G2 interpretation: historical fallback stays inside the ten-year
 * window. The final institutional G3 contract must confirm this policy.
 */
export type HistoricalCandidate = Readonly<{
  id: string;
  capturedOn: string;
  source: string;
}>;
export type HistoricalSelection =
  | Readonly<{
      status: "selected";
      candidate: HistoricalCandidate;
      reason:
        | "before-construction"
        | "fallback-no-earlier-image"
        | "fallback-construction-unknown";
      isKnownBeforeConstruction: boolean;
      windowStart: string;
      windowEnd: string;
    }>
  | Readonly<{
      status: "unavailable";
      reason: "no-candidate-in-window";
      windowStart: string;
      windowEnd: string;
    }>;

/** Calendar dates use canonical YYYY-MM-DD, without local-time ambiguity. */
function calendarDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError(`${field} must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new RangeError(`${field} is not a valid calendar date`);
  return date;
}
function tenYearsEarlier(date: Date): string {
  const year = date.getUTCFullYear() - 10;
  if (year < 1)
    throw new RangeError("referenceDate must allow a ten-year window");
  const month = date.getUTCMonth();
  // Clamp leap day to the last valid day of the destination month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(date.getUTCDate(), lastDay)).padStart(2, "0")}`;
}
export function selectHistoricalImage(
  input: Readonly<{
    referenceDate: string;
    constructionDate?: string | null;
    candidates: readonly HistoricalCandidate[];
  }>,
): HistoricalSelection {
  const reference = calendarDate(input.referenceDate, "referenceDate");
  const construction =
    input.constructionDate == null
      ? null
      : calendarDate(input.constructionDate, "constructionDate");
  if (construction && construction > reference)
    throw new RangeError("constructionDate cannot be after referenceDate");
  const windowStart = tenYearsEarlier(reference);
  const windowEnd = input.referenceDate;
  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    calendarDate(candidate.capturedOn, "capturedOn");
    if (!candidate.id.trim() || ids.has(candidate.id))
      throw new RangeError("candidate ids must be nonempty and unique");
    ids.add(candidate.id);
  }
  const eligible = input.candidates.filter(
    (c) =>
      c.source === "Google Earth" &&
      c.capturedOn >= windowStart &&
      c.capturedOn <= windowEnd,
  );
  if (eligible.length === 0)
    return {
      status: "unavailable",
      reason: "no-candidate-in-window",
      windowStart,
      windowEnd,
    };
  const ordered = [...eligible].sort(
    (a, b) =>
      a.capturedOn.localeCompare(b.capturedOn) || a.id.localeCompare(b.id),
  );
  const earlier = construction
    ? ordered.filter((c) => c.capturedOn < input.constructionDate!)
    : [];
  // Stable deterministic tie-breaking by id when acquisition dates coincide.
  const latestDate = earlier.at(-1)?.capturedOn;
  const candidate = latestDate
    ? earlier.find((c) => c.capturedOn === latestDate)!
    : ordered[0];
  return {
    status: "selected",
    candidate: { ...candidate },
    reason: latestDate
      ? "before-construction"
      : construction
        ? "fallback-no-earlier-image"
        : "fallback-construction-unknown",
    isKnownBeforeConstruction: Boolean(latestDate),
    windowStart,
    windowEnd,
  };
}

export type ImageUrlAvailability = Readonly<{
  available: boolean;
  reason:
    | "available-until-expiry"
    | "expiry-unspecified"
    | "missing-url"
    | "expired-url"
    | "unsupported-url";
}>;
function instant(value: string | Date, field: string): number {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw new RangeError(`${field} is invalid`);
    return value.getTime();
  }
  // Require UTC timestamps, and reject calendar rollover accepted by Date.parse.
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(
      value,
    );
  if (!match) throw new RangeError(`${field} must be a UTC ISO timestamp`);
  calendarDate(match[1], field);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)
    throw new RangeError(`${field} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`${field} is invalid`);
  return parsed;
}
/** This checks URL shape/expiration only, never asserts service availability. */
export function imageUrlAvailability(
  image: Readonly<{ url?: string | null; expiresAt?: string | null }>,
  now: string | Date,
): ImageUrlAvailability {
  const nowMs = instant(now, "now");
  const expiry =
    image.expiresAt == null ? null : instant(image.expiresAt, "expiresAt");
  if (!image.url) return { available: false, reason: "missing-url" };
  let url: URL;
  try {
    url = new URL(image.url);
  } catch {
    return { available: false, reason: "unsupported-url" };
  }
  if (url.protocol !== "https:" || url.username || url.password)
    return { available: false, reason: "unsupported-url" };
  if (expiry !== null && expiry <= nowMs)
    return { available: false, reason: "expired-url" };
  return {
    available: true,
    reason: expiry === null ? "expiry-unspecified" : "available-until-expiry",
  };
}
