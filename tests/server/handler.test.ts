import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../src/server/handler";

test("unconfigured API fails closed without exposing environment values", async () => {
  const old = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  try {
    const response = await handle(new Request("http://localhost/api/session"), [
      "session",
    ]);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.error.code, "CONFIGURATION");
    assert.ok(!JSON.stringify(body).includes("SUPABASE"));
  } finally {
    if (old !== undefined) process.env.SUPABASE_URL = old;
  }
});
test("cross-origin login rejected before auth access", async () => {
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "APP_ORIGIN",
  ] as const;
  const previous = keys.map((k) => process.env[k]);
  process.env.SUPABASE_URL = "https://synthetic.invalid";
  process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic-not-a-key";
  process.env.APP_ORIGIN = "http://localhost:3000";
  try {
    const response = await handle(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { origin: "https://attacker.invalid" },
      }),
      ["auth", "login"],
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "ORIGIN");
  } finally {
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
