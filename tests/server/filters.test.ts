import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDate,
  historyFilters,
  queryKeys,
} from "../../src/server/filters";

test("calendar rejects rollover and inverted ranges, accepts leap day and inclusive UTC dates", () => {
  for (const date of [
    "2026-02-29",
    "2024-02-30",
    "2026-04-31",
    "0000-01-01",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
  ])
    assert.throws(() => calendarDate(date));
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");
  assert.throws(() =>
    historyFilters(new URLSearchParams("from=2026-11-05&to=2026-11-04")),
  );
  const result = historyFilters(
    new URLSearchParams("from=2026-11-04&to=2026-11-04"),
  );
  assert.equal(result.from, result.to);
});
test("pagination rejects coercions, duplicates, overflow and unexpected filters", () => {
  for (const query of [
    "page=1e2",
    "page=0x10",
    "page=",
    "page=-1",
    "page=1.0",
    "page=9007199254740991",
    "page=2147483647&pageSize=100",
    "page=1&page=2",
    "foo=x",
    "type=Administrador",
    "parcel=ABC",
    "locality=",
    "pageSize=101",
  ])
    assert.throws(() => historyFilters(new URLSearchParams(query)), query);
  assert.deepEqual(historyFilters(new URLSearchParams()), {
    page: 1,
    pageSize: 20,
    start: 0,
    end: 19,
    filters: {},
    from: undefined,
    to: undefined,
  });
  const result = historyFilters(
    new URLSearchParams("page=2&pageSize=10&type=Reclamo&parcel=900001"),
  );
  assert.equal(result.start, 10);
  assert.equal(result.end, 19);
  assert.equal(result.filters.type, "Reclamo");
});
test("search query shape rejects duplicates and mixed person/parcel searches", () => {
  assert.throws(() =>
    queryKeys(new URLSearchParams("kind=name&q=x&locality=y"), ["kind", "q"]),
  );
  assert.throws(() =>
    queryKeys(new URLSearchParams("kind=name&q=x&q=y"), ["kind", "q"]),
  );
});

test("history accepts voluntary area type longer than30characters", () => {
  const type = "Declaracion voluntaria de metros";
  assert.equal(
    historyFilters(new URLSearchParams({ type })).filters.type,
    type,
  );
  assert.throws(() =>
    historyFilters(new URLSearchParams({ type: "Inventado" })),
  );
});
