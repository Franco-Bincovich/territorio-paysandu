import test from "node:test";
import assert from "node:assert/strict";
import {
  prototypeRecord,
  applicationCatalogue,
} from "../../src/server/prototype-catalogue";
import type { SupabaseClient } from "@supabase/supabase-js";
const payload = {
  id: "17718",
  localidad: "Paysandú",
  address: "DIRECCIÓN SINTÉTICA",
  area: "1.200 m²",
  built: "0 m²",
  detected: "1.000,50 m²",
  detectedPercent: "100%",
  zone: "TEST",
  section: "TEST",
  block: "TEST",
  contact: "PERSONA SINTÉTICA",
  document: "00000000",
  phone: "TEST",
  phone2: "",
  email: "test@example.invalid",
  type: "Titular",
};
test("preserve all source fields; parse locale areas without inventing percent or contact", () => {
  const r = prototypeRecord({ payload, source_document: "fixture.html" });
  assert.equal(r.originalLandArea, 1200);
  assert.equal(r.detectedBuildingArea, 1000.5);
  assert.equal(r.originalBuildingArea, 0);
  assert.equal(Object.keys(r.fields!).length, 16);
  assert.equal(r.fields!["Porcentaje declarado (sin validar)"], "100%");
  assert.equal(r.source, "prototype");
  assert.match(r.provenance!, /No verificado/);
  assert.throws(() =>
    prototypeRecord({
      payload: { ...payload, id: "999" },
      source_document: "fixture",
    }),
  );
  assert.equal(
    prototypeRecord({
      payload: { ...payload, area: "sin dato" },
      source_document: "fixture",
    }).originalLandArea,
    null,
  );
});
test("prototype lookup uses caller client, no other parcel, exact person lookup and fail-closed errors", async () => {
  process.env.DATA_MODE = "synthetic";
  process.env.PROTOTYPE_RECORD_ENABLED = "true";
  let reads = 0;
  let failed = false;
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => {
      reads++;
      return {
        data: { payload, source_document: "fixture" },
        error: failed ? {} : null,
      };
    },
  };
  const adapter = applicationCatalogue({
    from: (table: string) => {
      assert.equal(table, "prototype_parcels");
      return q;
    },
  } as unknown as SupabaseClient);
  assert.equal(
    (await adapter.findParcel({ locality: "Paysandú", parcel: "17718" }))
      ?.source,
    "prototype",
  );
  assert.equal(
    await adapter.findParcel({ locality: "Paysandú", parcel: "17719" }),
    null,
  );
  assert.equal(reads, 1);
  assert.equal(
    (await adapter.findPerson({ field: "name", exact: "PERSONA" })).length,
    0,
  );
  assert.equal(
    (await adapter.findPerson({ field: "name", exact: payload.contact }))
      .length,
    1,
  );
  assert.equal(
    (await adapter.findPerson({ field: "CI", exact: payload.document })).length,
    0,
  );
  assert.equal(
    (await adapter.findPerson({ field: "RUT", exact: payload.document }))
      .length,
    0,
  );
  failed = true;
  await assert.rejects(() =>
    adapter.findParcel({ locality: "Paysandú", parcel: "17718" }),
  );
  delete process.env.PROTOTYPE_RECORD_ENABLED;
});
