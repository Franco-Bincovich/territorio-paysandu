import test from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  type HandlerDependencies,
} from "../../src/server/handler";
import { applicationCatalogue } from "../../src/server/prototype-catalogue";
import { HttpError } from "../../src/server/security";

test("canonical parcel key reaches contact/image reads and consultation RPC", async () => {
  const prior = process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER = "catalogue";
  const canonical = { locality: "Paysandú", parcel: "17718" };
  const contactFilters: Array<[string, unknown]> = [];
  const imageKeys: unknown[] = [];
  const writes: unknown[] = [];
  const client = {
    from: (table: string) => {
      assert.equal(table, "contacts");
      const q = {
        select: () => q,
        eq: (field: string, value: unknown) => { contactFilters.push([field, value]); return q; },
        order: async () => ({ data: [], error: null }),
      };
      return q;
    },
    rpc: async (name: string, args: { p_payload: Record<string, unknown> }) => {
      assert.equal(name, "create_consultation");
      writes.push(args.p_payload);
      return { data: { ...args.p_payload, id: "10000000-0000-4000-8000-000000000001", version: 1 }, error: null };
    },
  };
  const handle = createHandler({
    configuration: () => ({ origin: "https://app.example.invalid", url: "https://db.example.invalid", key: "synthetic" }),
    identity: async () => ({ client }),
    catalogue: () => ({
      findParcel: async (requested: { locality: string; parcel: string }) => {
        assert.equal(requested.locality, "Paysandu");
        assert.equal(requested.parcel, "17718");
        return { key: canonical, address: "SYNTHETIC", source: "prototype" };
      },
      getImages: async (key: unknown) => { imageKeys.push(key); return { historical: null, survey: null }; },
    }),
    privilegedClient: () => { throw new Error("must not use administrative access"); },
    sessionClient: async () => { throw new Error("must not start a session"); },
  } as unknown as HandlerDependencies);
  try {
    const detail = await handle(new Request("https://app.example.invalid/api/parcels/Paysandu/17718"), ["parcels", "Paysandu", "17718"], () => {});
    assert.equal(detail.status, 200);
    assert.deepEqual(contactFilters, [["locality", "Paysandú"], ["parcel", "17718"]]);
    assert.deepEqual(imageKeys, [canonical]);
    const draft = {
      locality: "Paysandu", parcel: "17718", type: "General", description: "Consulta sintética de prueba canónica",
      person: { name: "PERSONA SINTÉTICA", documentType: "CI", document: "00000001", relationship: "Titular", phones: ["00000000"], emails: ["qa@example.invalid"] },
      idempotencyKey: "20000000-0000-4000-8000-000000000001",
    };
    const created = await handle(new Request("https://app.example.invalid/api/consultations", { method: "POST", headers: { origin: "https://app.example.invalid", "content-type": "application/json" }, body: JSON.stringify(draft) }), ["consultations"], () => {});
    assert.equal(created.status, 201);
    const { idempotencyKey: _key, ...data } = draft;
    assert.deepEqual(writes, [{ ...data, ...canonical }]);
    assert.equal((await created.json()).locality, "Paysandú");
  } finally {
    if (prior === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = prior;
  }
});

test("prototype HTTP preserves provenance and gates source access before reading", async () => {
  const names = ["DATA_MODE", "PROTOTYPE_RECORD_ENABLED", "IMAGE_PROVIDER"];
  const previous = names.map((name) => process.env[name]);
  Object.assign(process.env, {
    DATA_MODE: "synthetic",
    PROTOTYPE_RECORD_ENABLED: "true",
    IMAGE_PROVIDER: "catalogue",
  });
  const payload = {
    id: "17718",
    localidad: "Paysandú",
    address: "DOMICILIO SINTÉTICO QA",
    area: "1.200 m²",
    built: "0 m²",
    detected: "sin dato",
    detectedPercent: "TEXTO QA",
    zone: "QA",
    section: "QA",
    block: "QA",
    contact: "PERSONA SINTÉTICA QA",
    document: "00000000",
    phone: "00000000",
    phone2: "",
    email: "qa@example.invalid",
    type: "Titular",
  };
  let reads = 0;
  let authenticated = true;
  const client = {
    from(table: string) {
      reads++;
      assert.ok(["prototype_parcels", "contacts"].includes(table));
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: { payload, source_document: "fixture-synthetic.html" },
          error: null,
        }),
        order: async () => ({ data: [], error: null }),
      };
      return query;
    },
  };
  const handle = createHandler({
    configuration: () => ({
      origin: "https://app.example.invalid",
      url: "https://db.example.invalid",
      key: "synthetic",
    }),
    identity: async () => {
      if (!authenticated)
        throw new HttpError(401, "UNAUTHENTICATED", "Iniciá sesión.");
      return {
        client,
        user: { id: "synthetic-user" },
        profile: { username: "QA" },
      };
    },
    privilegedClient: () => {
      throw new Error("privileged client must not run");
    },
    sessionClient: async () => {
      throw new Error("session client must not run");
    },
    catalogue: applicationCatalogue,
  } as unknown as HandlerDependencies);
  const request = () =>
    new Request("https://app.example.invalid/api/parcels/Paysand%C3%BA/17718");
  try {
    for (const locality of [
      "Paysandu",
      "Paysandú",
      "PAYSANDU",
      "  paysandu  ",
      "Paysandu\u0301",
    ]) {
      const search = await handle(
        new Request(
          `https://app.example.invalid/api/search?locality=${encodeURIComponent(locality)}&parcel=17718`,
        ),
        ["search"],
        () => {},
      );
      assert.equal(search.status, 200);
      const result = await search.json();
      assert.equal(result.results.length, 1, `missing result for ${locality}`);
      assert.equal(result.results[0].locality, "Paysandú");
    }
    const wrong = await handle(
      new Request(
        "https://app.example.invalid/api/search?locality=Otra&parcel=17718",
      ),
      ["search"],
      () => {},
    );
    assert.deepEqual((await wrong.json()).results, []);
    reads = 0;
    const response = await handle(
      request(),
      ["parcels", "Paysandu", "17718"],
      () => {},
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /private.*no-store/);
    const body = await response.json();
    assert.equal(body.locality, "Paysandú");
    assert.equal(body.synthetic, false);
    assert.equal(
      body.provenance,
      "fixture-synthetic.html · No verificado institucionalmente",
    );
    assert.equal(body.fields["Titular / contacto"], payload.contact);
    assert.equal(
      body.fields["Porcentaje declarado (sin validar)"],
      payload.detectedPercent,
    );
    assert.equal(body.originalLandArea, 1200);
    assert.equal(body.originalBuiltArea, 0);
    assert.equal(body.detectedBuiltArea, null);
    assert.deepEqual(body.contacts, []); // No invented independent contact or consultation.
    assert.equal(reads, 2);
    authenticated = false;
    const denied = await handle(
      request(),
      ["parcels", "Paysandu", "17718"],
      () => {},
    );
    assert.equal(denied.status, 401);
    assert.equal(reads, 2);
    assert.equal(
      JSON.stringify(await denied.json()).includes(payload.contact),
      false,
    );
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
