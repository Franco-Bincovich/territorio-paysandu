import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("prototype record access gate, no anonymous access, no client writes and single parcel constraint", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema private;grant usage on schema private to authenticated;create function private.can_access() returns boolean language sql as $$select coalesce(current_setting('test.allowed',true),'false')='true'$$;`,
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261104145535_authorized_prototype_record.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261104145836_validate_prototype_fields.sql",
        "utf8",
      ),
    );
    const p = Object.fromEntries(
      [
        "id",
        "localidad",
        "address",
        "area",
        "built",
        "detected",
        "detectedPercent",
        "zone",
        "section",
        "block",
        "contact",
        "document",
        "phone",
        "phone2",
        "email",
        "type",
      ].map((k) => [
        k,
        k === "id" ? "17718" : k === "localidad" ? "Paysandú" : "SYNTHETIC",
      ]),
    );
    await db.query(
      `insert into prototype_parcels(locality,parcel,source_document,source_sha256,payload) values ('Paysandú','17718','Territorio_Paysandu_v03_Expediente_17718.html',repeat('0',64),$1)`,
      [JSON.stringify(p)],
    );
    await assert.rejects(() =>
      db.exec(
        "update prototype_parcels set payload=jsonb_set(payload,'{id}','null')",
      ),
    );
    await db.exec("set role anon");
    await assert.rejects(() => db.query("select * from prototype_parcels"));
    await db.exec("reset role;set role authenticated");
    assert.equal(
      (await db.query("select * from prototype_parcels")).rows.length,
      0,
    );
    await db.exec("set test.allowed='true'");
    assert.equal(
      (await db.query("select * from prototype_parcels")).rows.length,
      1,
    );
    await assert.rejects(() => db.exec("delete from prototype_parcels"));
    await db.exec("reset role");
    await assert.rejects(() =>
      db.exec("update prototype_parcels set parcel='17719'"),
    );
  } finally {
    await db.close();
  }
});
