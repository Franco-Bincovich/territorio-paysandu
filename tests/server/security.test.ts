import test from "node:test";
import assert from "node:assert/strict";
import {
  accountBucket,
  checkOrigin,
  jsonBody,
  HttpError,
} from "../../src/server/security";
import { catalogue } from "../../src/server/catalogue";

test("writes reject absent and cross-site origin, permit exact configured origin", () => {
  for (const origin of [
    undefined,
    "https://attacker.invalid",
    "https://app.example.evil",
  ]) {
    assert.throws(
      () =>
        checkOrigin(
          new Request("https://app.example/api/auth/login", {
            method: "POST",
            headers: origin ? { origin } : {},
          }),
          "https://app.example",
        ),
      HttpError,
    );
  }
  assert.doesNotThrow(() =>
    checkOrigin(
      new Request("https://app.example/api/auth/login", {
        method: "POST",
        headers: { origin: "https://app.example" },
      }),
      "https://app.example",
    ),
  );
});
test("account limiter canonicalizes casing and whitespace without exposing usernames", () => {
  assert.equal(accountBucket(" Paysandu "), accountBucket("paysandu"));
  assert.match(accountBucket("Paysandu"), /^[a-f0-9]{64}$/);
});
test("JSON rejects malformed, primitive, array and oversized bodies", async () => {
  for (const body of [
    "null",
    "[]",
    "false",
    "{",
    '{"x":"' + "x".repeat(65536) + '"}',
  ])
    await assert.rejects(
      () =>
        jsonBody(
          new Request("https://app.example", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        ),
      HttpError,
    );
  assert.deepEqual(
    await jsonBody(
      new Request("https://app.example", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"x":1}',
      }),
    ),
    { x: 1 },
  );
});
test("institutional catalogue fails closed and synthetic exact person search spans localities", async () => {
  const previous = process.env.DATA_MODE;
  try {
    delete process.env.DATA_MODE;
    assert.throws(() => catalogue(), HttpError);
    process.env.DATA_MODE = "institutional";
    assert.throws(() => catalogue(), HttpError);
    process.env.DATA_MODE = "synthetic";
    const adapter = catalogue();
    assert.equal(
      (
        await adapter.findPerson({
          field: "name",
          exact: "PERSONA SINTÉTICA UNO",
        })
      ).length,
      3,
    );
    assert.equal(
      (await adapter.findPerson({ field: "name", exact: "PERSONA" })).length,
      0,
    );
    assert.equal(
      await adapter.findParcel({ locality: "UNKNOWN", parcel: "900001" }),
      null,
    );
    assert.equal(
      (
        await adapter.getImages({
          locality: "LOCALIDAD SINTÉTICA",
          parcel: "900001",
        })
      ).historical,
      null,
    );
  } finally {
    if (previous === undefined) delete process.env.DATA_MODE;
    else process.env.DATA_MODE = previous;
  }
});
