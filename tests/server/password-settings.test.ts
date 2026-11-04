import test from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  type HandlerDependencies,
} from "../../src/server/handler";
import { HttpError } from "../../src/server/security";
const origin = "https://app.example.invalid",
  user = {
    id: "10000000-0000-4000-8000-000000000001",
    email: "qa@example.invalid",
  },
  session = "20000000-0000-4000-8000-000000000001";
function fixture(authorized = true) {
  let updates = 0;
  const events: string[] = [];
  const client = {
    auth: {
      updateUser: async () => {
        updates++;
        return { error: null };
      },
      signOut: async (x: any) => {
        assert.equal(x.scope, "global");
        events.push("logout");
        return { error: null };
      },
      signInWithPassword: async (x: any) => {
        assert.equal(x.email, user.email);
        events.push("reauth");
        return {
          data: { session: { access_token: "synthetic-token" } },
          error: null,
        };
      },
      getUser: async () => ({ data: { user }, error: null }),
      getClaims: async () => ({
        data: { claims: { sub: user.id, session_id: session } },
        error: null,
      }),
    },
  };
  const handle = createHandler({
    configuration: () => ({
      origin,
      url: "https://db.example.invalid",
      key: "synthetic",
    }),
    identity: async () => {
      if (!authorized)
        throw new HttpError(401, "UNAUTHENTICATED", "Iniciá sesión.");
      return {
        client,
        user,
        profile: { username: "QA", must_change_password: false },
      };
    },
    privilegedClient: () => ({
      rpc: async (name: string, args: any) => {
        assert.equal(name, "finalize_password_change");
        assert.deepEqual(args, { p_user_id: user.id, p_session_id: session });
        events.push("finalize");
        return { data: true, error: null };
      },
    }),
    sessionClient: async () => client,
    catalogue: () => {
      throw Error("not used");
    },
  } as unknown as HandlerDependencies);
  return {
    handle,
    events,
    get updates() {
      return updates;
    },
  };
}
function request(body: unknown) {
  return new Request(origin + "/api/auth/password", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("optional password change uses authenticated identity, global logout and verified fresh session", async () => {
  const f = fixture();
  const r = await f.handle(
    request({ password: "synthetic-new-password" }),
    ["auth", "password"],
    () => {},
  );
  assert.equal(r.status, 200);
  assert.equal(f.updates, 1);
  assert.deepEqual(f.events, ["logout", "reauth", "finalize"]);
  assert.equal(
    JSON.stringify(await r.json()).includes("synthetic-new-password"),
    false,
  );
});
test("password settings denies anonymous caller and foreign user fields before mutation", async () => {
  const f = fixture(false);
  assert.equal(
    (
      await f.handle(
        request({ password: "synthetic-new-password" }),
        ["auth", "password"],
        () => {},
      )
    ).status,
    401,
  );
  assert.equal(f.updates, 0);
  const g = fixture();
  assert.equal(
    (
      await g.handle(
        request({ password: "synthetic-new-password", userId: "someone-else" }),
        ["auth", "password"],
        () => {},
      )
    ).status,
    400,
  );
  assert.equal(g.updates, 0);
});
