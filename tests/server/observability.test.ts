import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../src/server/handler";
import {
  observeRequest,
  routeTemplate,
  type RequestEvent,
} from "../../src/server/observability";

test("request events contain only generated correlation, template, status and duration", async () => {
  const secret = "SECRET_SENTINEL-password-email-token-cedula-ip";
  const events: RequestEvent[] = [];
  const result = await handle(
    new Request(
      `https://app.invalid/api/parcels/${secret}/123?email=${secret}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          cookie: secret,
          "x-request-id": secret,
          "x-forwarded-for": secret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: secret }),
      },
    ),
    ["parcels", secret, "123"],
    (e) => events.push(e),
  );
  assert.equal(result.status, 405);
  assert.equal(result.headers.get("allow"), "GET");
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), [
    "durationMs",
    "event",
    "requestId",
    "route",
    "status",
  ]);
  assert.equal(events[0].route, "/api/parcels/{locality}/{parcel}");
  assert.equal(events[0].status, 405);
  assert.ok(events[0].durationMs >= 0);
  assert.match(events[0].requestId, /^[a-f0-9-]{36}$/);
  assert.equal(result.headers.get("x-request-id"), events[0].requestId);
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.equal(routeTemplate([secret]), "unmatched");
});
test("logging records failures without exception detail and logger failure cannot break response", async () => {
  const events: RequestEvent[] = [];
  await assert.rejects(
    observeRequest(
      "/api/session",
      async () => {
        throw new Error("sensitive exception");
      },
      (e) => events.push(e),
    ),
  );
  assert.equal(events[0].status, 500);
  assert.ok(!JSON.stringify(events).includes("sensitive"));
  const response = await observeRequest(
    "/api/session",
    async () => new Response(null, { status: 204 }),
    () => {
      throw new Error("logger down");
    },
  );
  assert.equal(response.status, 204);
});
test("unknown route never logs raw route/query and standard unsupported methods return405", async () => {
  const events: RequestEvent[] = [];
  const missing = await handle(
    new Request("https://app.invalid/api/person-private"),
    ["person-private"],
    (e) => events.push(e),
  );
  assert.equal(missing.status, 404);
  assert.equal(events[0].route, "unmatched");
  for (const method of ["PUT", "DELETE", "OPTIONS", "HEAD"]) {
    const result = await handle(
      new Request("https://app.invalid/api/consultations", { method }),
      ["consultations"],
      () => {},
    );
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("allow"), "GET, POST");
  }
});
