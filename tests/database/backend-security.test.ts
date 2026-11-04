import test from "node:test";
import assert from "node:assert/strict";
import {
  checkOrigin,
  jsonBody,
  accountBucket,
} from "../../src/server/security";

test("independent: missing, null and look-alike origins cannot mutate", () => {
  for (const origin of [
    undefined,
    "null",
    "https://pilot.example.invalid.evil.invalid",
    "http://pilot.example.invalid",
  ]) {
    const request = new Request(
      "https://pilot.example.invalid/api/auth/password",
      { method: "POST", headers: origin ? { origin } : undefined },
    );
    assert.throws(() => checkOrigin(request, "https://pilot.example.invalid"));
  }
  assert.doesNotThrow(() =>
    checkOrigin(
      new Request("https://pilot.example.invalid/api/auth/password", {
        method: "POST",
        headers: { origin: "https://pilot.example.invalid" },
      }),
      "https://pilot.example.invalid",
    ),
  );
});
test("independent: chunked body without content-length stops at bounded bytes", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(32769));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(
    "https://pilot.example.invalid/api/consultations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit,
  );
  await assert.rejects(jsonBody(request));
  assert.equal(cancelled, true);
});
test("independent: username case/compatibility variants share abuse bucket", () => {
  assert.equal(accountBucket(" Paysandu "), accountBucket("paysandu"));
  assert.equal(accountBucket("Ｐａｙｓａｎｄｕ"), accountBucket("paysandu"));
});
