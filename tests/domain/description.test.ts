import test from "node:test";
import assert from "node:assert/strict";
import { parseDescription, DomainError } from "../../src/domain";
const invalid = (value: unknown) =>
  assert.throws(
    () => parseDescription(value),
    (e: unknown) => e instanceof DomainError && e.code === "VALIDATION",
  );
test("description minimum excludes outer padding and rejects whitespace-only input", () => {
  for (const value of [
    "",
    " ".repeat(20),
    "\t\n\r\u00a0".repeat(10),
    "a".repeat(19),
    "   " + "a".repeat(19) + "   ",
  ])
    invalid(value);
  assert.equal(parseDescription("a".repeat(20)), "a".repeat(20));
  assert.equal(parseDescription("a".repeat(21)), "a".repeat(21));
  assert.equal(
    parseDescription(" \t\n\r\u00a0" + "a".repeat(20) + "\u00a0\r\n\t "),
    "a".repeat(20),
  );
});
test("description retains existing technical maximum without padding changing its meaning", () => {
  assert.equal(parseDescription("a".repeat(10000)).length, 10000);
  assert.equal(parseDescription("  " + "a".repeat(10000) + "  ").length, 10000);
  invalid("a".repeat(10001));
  invalid("  " + "a".repeat(10001) + "  ");
});
test("description counts Unicode code points consistently with PostgreSQL text", () => {
  invalid("😀".repeat(19));
  assert.equal(parseDescription("😀".repeat(20)), "😀".repeat(20));
  assert.equal(Array.from(parseDescription("😀".repeat(10000))).length, 10000);
  invalid("😀".repeat(10001));
  assert.equal(parseDescription("á".repeat(20)), "á".repeat(20));
});
test("description allows meaningful internal spacing but never pads an undersized value", () => {
  const value = "abcdefghij\nklmnopqrs";
  assert.equal(Array.from(value).length, 20);
  assert.equal(parseDescription(value), value);
  invalid(" \tabcdefghijklmnopqrs\n ");
});
test("description rejects nonstrings and disallowed controls before trimming", () => {
  for (const value of [
    null,
    undefined,
    20,
    {},
    [],
    true,
    "a".repeat(20) + "\u0000",
    "\v" + "a".repeat(20),
    "a".repeat(20) + "\f",
  ])
    invalid(value);
});
