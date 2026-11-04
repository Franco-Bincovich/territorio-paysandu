import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, type HandlerDependencies } from "../../src/server/handler";
import { applicationCatalogue } from "../../src/server/prototype-catalogue";
import { HttpError } from "../../src/server/security";

test("prototype HTTP preserves provenance and gates source access before reading", async () => {
  const names = ["DATA_MODE", "PROTOTYPE_RECORD_ENABLED", "IMAGE_PROVIDER"];
  const previous = names.map((name) => process.env[name]);
  Object.assign(process.env, { DATA_MODE: "synthetic", PROTOTYPE_RECORD_ENABLED: "true", IMAGE_PROVIDER: "catalogue" });
  const payload = {
    id: "17718", localidad: "Paysandú", address: "DOMICILIO SINTÉTICO QA",
    area: "1.200 m²", built: "0 m²", detected: "sin dato", detectedPercent: "TEXTO QA",
    zone: "QA", section: "QA", block: "QA", contact: "PERSONA SINTÉTICA QA",
    document: "00000000", phone: "00000000", phone2: "", email: "qa@example.invalid", type: "Titular",
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
        maybeSingle: async () => ({ data: { payload, source_document: "fixture-synthetic.html" }, error: null }),
        order: async () => ({ data: [], error: null }),
      };
      return query;
    },
  };
  const handle = createHandler({
    configuration: () => ({ origin: "https://app.example.invalid", url: "https://db.example.invalid", key: "synthetic" }),
    identity: async () => {
      if (!authenticated) throw new HttpError(401, "UNAUTHENTICATED", "Iniciá sesión.");
      return { client, user: { id: "synthetic-user" }, profile: { username: "QA" } };
    },
    privilegedClient: () => { throw new Error("privileged client must not run"); },
    sessionClient: async () => { throw new Error("session client must not run"); },
    catalogue: applicationCatalogue,
  } as unknown as HandlerDependencies);
  const request = () => new Request("https://app.example.invalid/api/parcels/Paysand%C3%BA/17718");
  try {
    const response = await handle(request(), ["parcels", "Paysandú", "17718"], () => {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /private.*no-store/);
    const body = await response.json();
    assert.equal(body.synthetic, false);
    assert.equal(body.provenance, "fixture-synthetic.html · No verificado institucionalmente");
    assert.equal(body.fields["Titular / contacto"], payload.contact);
    assert.equal(body.fields["Porcentaje declarado (sin validar)"], payload.detectedPercent);
    assert.equal(body.originalLandArea, 1200);
    assert.equal(body.originalBuiltArea, 0);
    assert.equal(body.detectedBuiltArea, null);
    assert.deepEqual(body.contacts, []); // No invented independent contact or consultation.
    assert.equal(reads, 2);
    authenticated = false;
    const denied = await handle(request(), ["parcels", "Paysandú", "17718"], () => {});
    assert.equal(denied.status, 401);
    assert.equal(reads, 2);
    assert.equal(JSON.stringify(await denied.json()).includes(payload.contact), false);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
