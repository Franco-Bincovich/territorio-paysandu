import test from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  type HandlerDependencies,
} from "../../src/server/handler";
import { HttpError } from "../../src/server/security";

const id = "b864e8ec-b9b1-4df2-8a58-b6d2d353336e";
const userId = "58432d99-048a-4e1e-89c0-eb158ebf42ef";
const base = {
  locality: "LOCALIDAD SINTÉTICA",
  parcel: "900001",
  type: "General",
  person: {
    name: "PERSONA SINTÉTICA",
    documentType: "CI",
    document: "00000001",
    relationship: "Titular",
    phones: ["00000000"],
    emails: ["synthetic@example.invalid"],
  },
};
function fixture(denied = false) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let authCalls = 0;
  // Only the external adapters are doubles; Request parsing, CSRF, route dispatch,
  // domain validation, RPC argument construction and Response rendering are real.
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        error: null,
        data: {
          ...(args.p_payload as Record<string, unknown>),
          id,
          creator_user_id: userId,
          created_at: "2026-11-04T00:00:00Z",
          updated_at: "2026-11-04T00:00:00Z",
          version: 1,
        },
      };
    },
  };
  const dependencies: HandlerDependencies = {
    configuration: () => ({
      url: "https://synthetic.invalid",
      key: "synthetic-not-a-key",
      origin: "https://app.example.invalid",
    }),
    identity: async () => {
      authCalls++;
      if (denied) throw new HttpError(401, "UNAUTHENTICATED", "Iniciá sesión.");
      return {
        client,
        user: { id: userId },
        profile: {
          username: "Colaborador sintético",
          role: "collaborator",
          enabled: true,
          must_change_password: false,
        },
      } as unknown as Awaited<ReturnType<HandlerDependencies["identity"]>>;
    },
    sessionClient: async () => {
      throw new Error("Unexpected Auth adapter path");
    },
    privilegedClient: () => {
      throw new Error(
        "Privileged client must never be used for consultation writes",
      );
    },
    catalogue: () => ({
      findParcel: async (key) => ({
        key,
        address: "synthetic",
        originalLandArea: null,
        originalBuildingArea: null,
        detectedBuildingArea: null,
        source: "synthetic",
      }),
      findPerson: async () => [],
      getImages: async () => ({ historical: null, survey: null }),
    }),
  };
  return {
    handle: createHandler(dependencies),
    calls,
    authCalls: () => authCalls,
  };
}
function request(method: "POST" | "PATCH", description: string) {
  const suffix = method === "PATCH" ? `/${id}` : "";
  return new Request(`https://app.example.invalid/api/consultations${suffix}`, {
    method,
    headers: {
      origin: "https://app.example.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...base,
      description,
      ...(method === "POST" ? { idempotencyKey: id } : { version: 1 }),
    }),
  });
}
for (const method of ["POST", "PATCH"] as const) {
  const route = method === "POST" ? ["consultations"] : ["consultations", id];
  test(`${method} rejects short, whitespace and over-limit descriptions before any persistence RPC`, async () => {
    for (const description of [
      "a".repeat(19),
      " ".repeat(25),
      "  " + "a".repeat(19) + "  ",
      "😀".repeat(19),
      "a".repeat(10001),
      "😀".repeat(10001),
    ]) {
      const f = fixture();
      const response = await f.handle(
        request(method, description),
        route,
        () => {},
      );
      assert.equal(response.status, 400, JSON.stringify(description));
      assert.equal((await response.json()).error.code, "VALIDATION");
      assert.equal(f.authCalls(), 1);
      assert.equal(f.calls.length, 0);
    }
  });
  test(`${method} accepts 20 and 10000 code points and sends trimmed value through authenticated RPC`, async () => {
    for (const description of [
      "a".repeat(20),
      "😀".repeat(20),
      "a".repeat(10000),
      "😀".repeat(10000),
    ]) {
      const f = fixture();
      const response = await f.handle(
        request(method, "  " + description + "  "),
        route,
        () => {},
      );
      assert.equal(response.status, method === "POST" ? 201 : 200);
      assert.equal(f.authCalls(), 1);
      assert.equal(f.calls.length, 1);
      assert.equal(
        f.calls[0].name,
        method === "POST" ? "create_consultation" : "edit_consultation",
      );
      assert.equal(
        (f.calls[0].args.p_payload as Record<string, unknown>).description,
        description,
      );
      assert.equal((await response.json()).description, description);
    }
  });
  test(`${method} still denies unauthenticated requests before validation or persistence`, async () => {
    const f = fixture(true);
    const response = await f.handle(
      request(method, "a".repeat(20)),
      route,
      () => {},
    );
    assert.equal(response.status, 401);
    assert.equal(f.calls.length, 0);
  });
}
