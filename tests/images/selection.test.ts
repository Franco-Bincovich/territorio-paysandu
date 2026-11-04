import assert from "node:assert/strict";
import test from "node:test";
import {
  selectHistoricalImage,
  imageUrlAvailability,
  type HistoricalCandidate,
} from "../../src/domain/image-selection";
const candidate = (
  id: string,
  capturedOn: string,
  source = "Google Earth",
): HistoricalCandidate => ({ id, capturedOn, source });
test("selects the latest image strictly before construction inside ten years", () => {
  const result = selectHistoricalImage({
    referenceDate: "2026-11-04",
    constructionDate: "2020-06-01",
    candidates: [
      candidate("old", "2017-01-01"),
      candidate("recent", "2020-05-31"),
      candidate("same", "2020-06-01"),
      candidate("after", "2024-01-01"),
    ],
  });
  assert.equal(result.status, "selected");
  if (result.status !== "selected") throw Error();
  assert.equal(result.candidate.id, "recent");
  assert.equal(result.isKnownBeforeConstruction, true);
  assert.equal(result.reason, "before-construction");
  assert.equal(result.windowStart, "2016-11-04");
});
test("fallback chooses the closest eligible date to lower window boundary", () => {
  const result = selectHistoricalImage({
    referenceDate: "2026-11-04",
    constructionDate: "2010-01-01",
    candidates: [
      candidate("later", "2020-05-31"),
      candidate("boundary", "2016-11-04"),
      candidate("outside", "2016-11-03"),
    ],
  });
  assert.equal(result.status, "selected");
  if (result.status !== "selected") throw Error();
  assert.equal(result.candidate.id, "boundary");
  assert.equal(result.reason, "fallback-no-earlier-image");
  assert.equal(result.isKnownBeforeConstruction, false);
});
test("unknown construction explicitly reports fallback, never an earlier claim", () => {
  const result = selectHistoricalImage({
    referenceDate: "2026-11-04",
    candidates: [
      candidate("later", "2025-01-01"),
      candidate("first", "2017-01-01"),
    ],
  });
  assert.equal(result.status, "selected");
  if (result.status !== "selected") throw Error();
  assert.equal(result.candidate.id, "first");
  assert.equal(result.reason, "fallback-construction-unknown");
  assert.equal(result.isKnownBeforeConstruction, false);
});
test("no matching source or date produces unavailable; no out-of-window fallback", () => {
  for (const candidates of [
    [],
    [candidate("outside", "2016-11-03")],
    [candidate("future", "2026-11-05")],
    [candidate("survey", "2020-01-01", "Relevamiento")],
  ])
    assert.equal(
      selectHistoricalImage({ referenceDate: "2026-11-04", candidates }).status,
      "unavailable",
    );
});
test("leap day is clamped to February 28 ten calendar years earlier", () => {
  const result = selectHistoricalImage({
    referenceDate: "2024-02-29",
    candidates: [candidate("inclusive", "2014-02-28")],
  });
  assert.equal(result.windowStart, "2014-02-28");
  assert.equal(result.status, "selected");
});
test("selection does not mutate input and tie-breaking is deterministic", () => {
  const candidates = Object.freeze([
    Object.freeze(candidate("b", "2020-01-01")),
    Object.freeze(candidate("a", "2020-01-01")),
  ]);
  for (const list of [candidates, [...candidates].reverse()]) {
    const result = selectHistoricalImage({
      referenceDate: "2026-11-04",
      constructionDate: "2021-01-01",
      candidates: list,
    });
    assert.equal(result.status, "selected");
    if (result.status === "selected") assert.equal(result.candidate.id, "a");
  }
  assert.equal(candidates[0].id, "b");
});
test("rejects invalid dates, impossible chronology and duplicate ids", () => {
  for (const referenceDate of ["2026-02-30", "invalid", "2026-1-1"])
    assert.throws(
      () => selectHistoricalImage({ referenceDate, candidates: [] }),
      RangeError,
    );
  assert.throws(
    () =>
      selectHistoricalImage({
        referenceDate: "2026-11-04",
        constructionDate: "2027-01-01",
        candidates: [],
      }),
    RangeError,
  );
  assert.throws(
    () =>
      selectHistoricalImage({
        referenceDate: "2026-11-04",
        candidates: [candidate("bad", "2025-02-29")],
      }),
    RangeError,
  );
  assert.throws(
    () =>
      selectHistoricalImage({
        referenceDate: "2026-11-04",
        candidates: [
          candidate("a", "2020-01-01"),
          candidate("a", "2021-01-01"),
        ],
      }),
    RangeError,
  );
});
test("expiry at now is already unavailable; future expiry remains usable", () => {
  const url = "https://images.example.test/synthetic";
  const now = "2026-11-04T12:00:00Z";
  assert.deepEqual(imageUrlAvailability({ url, expiresAt: now }, now), {
    available: false,
    reason: "expired-url",
  });
  assert.equal(
    imageUrlAvailability({ url, expiresAt: "2026-11-04T11:59:59Z" }, now)
      .available,
    false,
  );
  assert.deepEqual(
    imageUrlAvailability({ url, expiresAt: "2026-11-04T12:00:01Z" }, now),
    { available: true, reason: "available-until-expiry" },
  );
  assert.deepEqual(imageUrlAvailability({ url }, now), {
    available: true,
    reason: "expiry-unspecified",
  });
});
test("missing or unsafe URLs unavailable; malformed expiry rejected", () => {
  const now = "2026-11-04T12:00:00Z";
  assert.equal(imageUrlAvailability({ url: null }, now).reason, "missing-url");
  for (const url of [
    "javascript:alert(1)",
    "http://images.example.test/x",
    "https://user:pass@example.test/x",
    "not-a-url",
  ])
    assert.equal(imageUrlAvailability({ url }, now).reason, "unsupported-url");
  for (const expiresAt of [
    "2026-02-30T12:00:00Z",
    "2026-11-04T25:00:00Z",
    "2026-11-04",
    "invalid",
  ])
    assert.throws(
      () =>
        imageUrlAvailability(
          { url: "https://images.example.test/x", expiresAt },
          now,
        ),
      RangeError,
    );
  assert.throws(
    () => imageUrlAvailability({}, new Date("invalid")),
    RangeError,
  );
});
