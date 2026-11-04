// PostgreSQL policy simulation only: not Supabase Auth/Storage HTTP verification.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("private image SQL: authorized readers, disabled/anonymous denial and direct write prevention", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema private; create schema storage;
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 create function private.can_access() returns boolean language sql as $$ select coalesce(current_setting('test.authorized',true),'false')='true' $$;
 grant usage on schema auth,private,storage to anon,authenticated,service_role;
 create function storage.allow_only_operation(op text) returns boolean language sql as $$ select coalesce(current_setting('test.operation',true),'object.get_authenticated')=op $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id int primary key,bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to anon,authenticated;
 -- Deliberately broad existing policy proves restrictive guards work.
 create policy unrelated_broad on storage.objects for all to public using(true) with check(true);`);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261104144022_private_prototype_images.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // Existing nested references survive the path migration unchanged.
    await db.exec(
      `insert into public.parcel_images values ('Paysandú','17718','historical','imagenes-satelitales','synthetic.png','paysandu/17718/historical/synthetic.png','Synthetic test only','{}',repeat('0',64),now(),'SYNTHETIC TEST ONLY');`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261104185042_support_uploaded_prototype_paths.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(
      (
        await db.query<{ object_path: string }>(
          "select object_path from public.parcel_images",
        )
      ).rows[0].object_path,
      "paysandu/17718/historical/synthetic.png",
    );
    for (const path of [
      "unrelated.png",
      "other/synthetic.png",
      "../synthetic.png",
    ])
      await assert.rejects(
        db.query(
          "update public.parcel_images set object_path=$1 where kind='historical'",
          [path],
        ),
      );
    await assert.rejects(
      db.exec(
        "update public.parcel_images set bucket='imagenes-catastro' where kind='historical'",
      ),
    );
    await assert.rejects(
      db.exec(
        "update public.parcel_images set locality='Otra' where kind='historical'",
      ),
    );
    await assert.rejects(
      db.exec(
        "update public.parcel_images set parcel='17719' where kind='historical'",
      ),
    );
    await db.exec(`update public.parcel_images set object_path=filename where kind='historical';
 insert into public.parcel_images values ('Paysandú','17718','survey','imagenes-catastro','synthetic-survey.png','paysandu/17718/survey/synthetic-survey.png','Synthetic test only','{}',repeat('0',64),now(),'SYNTHETIC TEST ONLY');
 insert into storage.objects values(1,'imagenes-satelitales','synthetic.png'),(2,'imagenes-satelitales','unlisted.png'),(4,'imagenes-catastro','paysandu/17718/survey/synthetic-survey.png'),(9,'unrelated','other.png');`);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from storage.buckets where public=false",
        )
      ).rows[0].n,
      2,
    );
    for (const uid of [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ]) {
      await db.exec(
        `reset role; select set_config('test.uid','${uid}',false); select set_config('test.authorized','true',false);set role authenticated;`,
      );
      assert.equal(
        (await db.query("select * from public.parcel_images")).rows.length,
        2,
      );
      assert.equal(
        (
          await db.query(
            "select * from storage.objects where bucket_id='imagenes-satelitales'",
          )
        ).rows.length,
        1,
      );
      assert.deepEqual(
        (
          await db.query<{ name: string }>(
            "select name from storage.objects where bucket_id in ('imagenes-satelitales','imagenes-catastro') order by id",
          )
        ).rows.map((r) => r.name),
        ["synthetic.png", "paysandu/17718/survey/synthetic-survey.png"],
      );
      await db.exec("select set_config('test.operation','object.sign',false)");
      assert.equal(
        (
          await db.query(
            "select * from storage.objects where bucket_id='imagenes-satelitales'",
          )
        ).rows.length,
        0,
      );
      await db.exec(
        "select set_config('test.operation','object.get_authenticated',false)",
      );
      await assert.rejects(
        db.exec(
          "insert into storage.objects values(3,'imagenes-catastro','new.png')",
        ),
      );
      assert.equal(
        (
          await db.query(
            "update storage.objects set name='replaced.png' where bucket_id='imagenes-satelitales' returning *",
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "delete from storage.objects where bucket_id='imagenes-satelitales' returning *",
          )
        ).rows.length,
        0,
      );
      await assert.rejects(db.exec("delete from public.parcel_images"));
      await db.exec("select set_config('test.authorized','false',false)");
      assert.equal(
        (await db.query("select * from public.parcel_images")).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from storage.objects where bucket_id='imagenes-satelitales'",
          )
        ).rows.length,
        0,
      );
    }
    await db.exec(
      "reset role; select set_config('test.uid','',false);set role anon;",
    );
    await assert.rejects(db.query("select * from public.parcel_images"));
    // Permission error or empty result are both secure denial for anonymous Storage.
    try {
      assert.equal(
        (
          await db.query(
            "select * from storage.objects where bucket_id='imagenes-satelitales'",
          )
        ).rows.length,
        0,
      );
    } catch (e) {
      assert.match(String(e), /permission denied/);
    }
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='unrelated'",
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
