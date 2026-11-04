import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { catalogue } from "../../src/server/catalogue";

test("new consultation type migrates without altering existing records and supports RPC create/edit", async () => {
  const db = new PGlite();
  const user = "10000000-0000-4000-8000-000000000001";
  const session = "20000000-0000-4000-8000-000000000001";
  const previousMode = process.env.DATA_MODE;
  process.env.DATA_MODE = "synthetic";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, encrypted_password text);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now(),not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;`);
    for (const name of [
      "20261104035645_initial_collaborator_schema.sql",
      "20261104125456_enforce_synthetic_parcel_keys.sql",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    }
    await db.query("insert into auth.users values ($1,'synthetic-hash-only')", [
      user,
    ]);
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [
      session,
      user,
    ]);
    await db.query(
      "insert into public.profiles(user_id,username,must_change_password) values ($1,'QA',false)",
      [user],
    );
    const keys = (
      await db.query<{ locality: string; parcel: string }>(
        "select * from private.synthetic_parcel_keys order by locality,parcel",
      )
    ).rows;
    assert.equal(keys.length, 3);
    for (const key of keys)
      assert.ok(
        await catalogue().findParcel(key),
        "DB key must exist in synthetic adapter",
      );
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user, JSON.stringify({ session_id: session })],
    );
    await db.exec("set role authenticated");
    assert.equal(
      (
        await db.query<{ active: boolean }>(
          "select public.touch_session() as active",
        )
      ).rows[0].active,
      true,
    );
    const base = {
      type: "General",
      description: "Consulta completamente sintética",
      person: {
        name: "Persona sintética",
        documentType: "CI",
        document: "00000001",
        relationship: "Titular",
        phones: ["00000000"],
        emails: ["qa@example.invalid"],
      },
    };
    for (const key of [
      { locality: "NO EXISTE", parcel: "900001" },
      { locality: "LOCALIDAD SINTÉTICA", parcel: "900002" },
      { locality: "LOCALIDAD SINTÉTICA", parcel: "0900001" },
    ]) {
      await assert.rejects(
        db.query("select public.create_consultation($1::jsonb,$2::uuid)", [
          JSON.stringify({ ...base, ...key }),
          crypto.randomUUID(),
        ]),
        (e: any) => e.code === "23503",
      );
    }
    assert.equal(
      (await db.query("select * from public.consultations")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.contacts")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into private.synthetic_parcel_keys values ('NO EXISTE','900001')",
      ),
      (e: any) => e.code === "42501",
    );
    for (const key of keys)
      await db.query("select public.create_consultation($1::jsonb,$2::uuid)", [
        JSON.stringify({ ...base, ...key }),
        crypto.randomUUID(),
      ]);
    assert.equal(
      (await db.query("select * from public.consultations")).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from public.contacts")).rows.length,
      3,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from private.idempotency")).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from private.consultation_revisions")).rows
        .length,
      3,
    );
    const before = (await db.query("select * from consultations order by id"))
      .rows;
    const contactsBefore = (
      await db.query("select * from contacts order by id")
    ).rows;
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261104172704_voluntary_area_consultation_type.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("select * from consultations order by id")).rows,
      before,
    );
    assert.deepEqual(
      (await db.query("select * from contacts order by id")).rows,
      contactsBefore,
    );
    await db.exec("set role authenticated");
    const next = {
      ...base,
      ...keys[0],
      type: "Declaracion voluntaria de metros",
    };
    const created = (
      await db.query<{ record: any }>(
        "select public.create_consultation($1::jsonb,$2::uuid) as record",
        [JSON.stringify(next), crypto.randomUUID()],
      )
    ).rows[0].record;
    assert.equal(created.type, next.type);
    const edited = (
      await db.query<{ record: any }>(
        "select public.edit_consultation($1::uuid,1,$2::jsonb) as record",
        [
          created.id,
          JSON.stringify({
            ...next,
            description: "Descripción ampliada enteramente sintética",
          }),
        ],
      )
    ).rows[0].record;
    assert.equal(edited.type, next.type);
    assert.equal(edited.version, 2);
    assert.equal(edited.original_snapshot.description, next.description);
    await assert.rejects(
      db.query("select public.create_consultation($1::jsonb,$2::uuid)", [
        JSON.stringify({ ...next, type: "NO PERMITIDO" }),
        crypto.randomUUID(),
      ]),
    );
  } finally {
    if (previousMode === undefined) delete process.env.DATA_MODE;
    else process.env.DATA_MODE = previousMode;
    await db.close();
  }
});
