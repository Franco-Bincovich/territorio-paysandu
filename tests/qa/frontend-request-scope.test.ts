import test from "node:test";
import assert from "node:assert/strict";
import { RequestScope, isAbort } from "../../src/components/request-scope";
import { historyDate } from "../../src/components/display-date";
test("new navigation invalidates previous request even if response later resolves", () => {
  const scope = new RequestScope();
  const first = scope.begin();
  const second = scope.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});
test("logout/unmount cancellation invalidates active request, later new request works", () => {
  const scope = new RequestScope();
  const first = scope.begin();
  scope.cancel();
  scope.cancel();
  assert.equal(first.isCurrent(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(scope.begin().isCurrent(), true);
});
test("abort recognition does not suppress genuine failures", () => {
  assert.equal(isAbort(new DOMException("aborted", "AbortError")), true);
  assert.equal(isAbort(new Error("offline")), false);
  assert.equal(isAbort("AbortError"), false);
});
test("history date uses UTC day independent of browser locale timezone", () => {
  assert.equal(historyDate("2026-11-04T00:30:00Z"), "4/11/2026");
  assert.equal(historyDate("2026-11-04T23:30:00-03:00"), "5/11/2026");
  assert.equal(historyDate("invalid"), "Fecha no disponible");
});
