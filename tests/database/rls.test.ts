import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "10000000-0000-4000-8000-000000000001",
  B = "10000000-0000-4000-8000-000000000002";
const SA = "20000000-0000-4000-8000-000000000001",
  SB = "20000000-0000-4000-8000-000000000002";
const K = "30000000-0000-4000-8000-000000000001";
const payload = {
  locality: "SINTETICA",
  parcel: "99999",
  type: "General",
  description: "QA sintético",
  person: {
    name: "Persona QA",
    documentType: "CI",
    document: "12345678",
    relationship: "Titular",
    phones: ["099000000"],
    emails: ["qa@example.invalid"],
  },
};

test("Independent PostgreSQL RLS, grants and transaction checks", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create table auth.users(id uuid primary key, encrypted_password text);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now(),not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;`);
    await db.exec(
      await readFile(
        new URL("../../supabase/migrations/20261104035645_initial_collaborator_schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query("insert into auth.users values ($1,$3),($2,$3)", [
      A,
      B,
      "synthetic-hash-in-test-only",
    ]);
    await db.query(
      "insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)",
      [SA, A, SB, B],
    );
    await db.query(
      "insert into public.profiles(user_id,username,must_change_password) values ($1,'QA-A',false),($2,'QA-B',false)",
      [A, B],
    );
    async function role(user = A, session = SA) {
      await db.exec("reset role");
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [user, JSON.stringify({ session_id: session })],
      );
      await db.exec("set role authenticated");
    }
    async function admin(sql: string, params: unknown[] = []) {
      await db.exec("reset role");
      return db.query(sql, params);
    }
    async function rpc(name: string, args: unknown[]) {
      return (
        await db.query<{ value: any }>(
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
          args,
        )
      ).rows[0].value;
    }
    await role();
    assert.equal(await rpc("touch_session", []), true);
    let id = "";
    await t.test(
      "RPC creates atomic consultation, snapshot and contact; exact retry is idempotent",
      async () => {
        const first = await rpc("create_consultation", [
          JSON.stringify(payload),
          K,
        ]);
        id = first.id;
        assert.equal(first.creator_user_id, A);
        assert.deepEqual(first.original_snapshot, payload);
        assert.equal(
          (await rpc("create_consultation", [JSON.stringify(payload), K])).id,
          id,
        );
        await assert.rejects(
          rpc("create_consultation", [
            JSON.stringify({ ...payload, description: "Different" }),
            K,
          ]),
          /IDEMPOTENCY_CONFLICT/,
        );
        assert.equal(
          (await db.query("select * from public.contacts")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "direct writes and private tables denied even for creator",
      async () => {
        await assert.rejects(
          db.query(
            "update public.consultations set description=$1 where id=$2",
            ["hacked", id],
          ),
          /permission denied/,
        );
        await assert.rejects(
          db.query("delete from public.contacts"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update public.profiles set must_change_password=false"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select * from private.session_activity"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "other collaborator reads globally but cannot edit ownership",
      async () => {
        await role(B, SB);
        assert.equal(await rpc("touch_session", []), true);
        assert.equal(
          (await db.query("select * from public.consultations")).rows.length,
          1,
        );
        await assert.rejects(
          rpc("edit_consultation", [id, 1, JSON.stringify(payload)]),
          /FORBIDDEN/,
        );
        await role();
      },
    );
    await t.test(
      "own edit increments version and preserves original contact and snapshot",
      async () => {
        const changed = {
          ...payload,
          description: "Edited",
          person: { ...payload.person, name: "Changed QA" },
        };
        const row = await rpc("edit_consultation", [
          id,
          1,
          JSON.stringify(changed),
        ]);
        assert.equal(row.version, 2);
        assert.deepEqual(row.original_snapshot, payload);
        await assert.rejects(
          rpc("edit_consultation", [id, 1, JSON.stringify(changed)]),
          /VERSION_CONFLICT/,
        );
        const contact = (
          await db.query<{ person: any }>("select person from public.contacts")
        ).rows[0];
        assert.equal(contact.person.name, payload.person.name);
        await admin("select 1");
        assert.equal(
          (await db.query("select * from private.consultation_revisions")).rows
            .length,
          2,
        );
        await role();
      },
    );
    await t.test("password gate blocks direct reads and RPC", async () => {
      await admin(
        "update public.profiles set must_change_password=true where user_id=$1",
        [A],
      );
      await role();
      assert.equal(
        (await db.query("select * from public.consultations")).rows.length,
        0,
      );
      await assert.rejects(
        rpc("create_consultation", [JSON.stringify(payload), K]),
        /FORBIDDEN/,
      );
      await admin(
        "update public.profiles set must_change_password=false where user_id=$1",
        [A],
      );
      await role();
    });
    await t.test("forced-password sessions have independent expiry and revocation checks", async () => {
      await admin("update public.profiles set must_change_password=true where user_id=$1", [A]); await role();
      assert.equal(await rpc("touch_auth_session", []), true);
      assert.equal((await db.query("select * from public.consultations")).rows.length, 0);
      await role(A, SB); assert.equal(await rpc("touch_auth_session", []), false);
      await admin("update private.session_activity set last_seen=now()-interval '60 minutes' where user_id=$1", [A]); await role();
      assert.equal(await rpc("touch_auth_session", []), false);
      await admin("update private.session_activity set last_seen=now() where user_id=$1", [A]);
      await admin("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [SA]); await role();
      assert.equal(await rpc("touch_auth_session", []), false);
      await admin("delete from auth.sessions where id=$1", [SA]); await role();
      assert.equal(await rpc("touch_auth_session", []), false);
      await db.exec("reset role;set role anon"); await assert.rejects(rpc("touch_auth_session", []), /permission denied/);
      await admin("insert into auth.sessions(id,user_id) values ($1,$2)", [SA,A]);
      await admin("update public.profiles set must_change_password=false where user_id=$1", [A]); await role();
      assert.equal(await rpc("touch_session", []), true);
    });
    await t.test(
      "60 minute boundary cannot be revived by touch RPC",
      async () => {
        await admin(
          "update private.session_activity set last_seen=now()-interval '60 minutes' where user_id=$1",
          [A],
        );
        await role();
        assert.equal(await rpc("touch_session", []), false);
        assert.equal(
          (await db.query("select * from public.consultations")).rows.length,
          0,
        );
        await admin(
          "update private.session_activity set last_seen=now() where user_id=$1",
          [A],
        );
        await role();
      },
    );
    await t.test("revoked auth session blocks old token claims", async () => {
      await admin("delete from auth.sessions where id=$1", [SA]);
      await role();
      assert.equal(await rpc("touch_session", []), false);
      assert.equal(
        (await db.query("select * from public.consultations")).rows.length,
        0,
      );
      await admin("insert into auth.sessions(id,user_id) values ($1,$2)", [
        SA,
        A,
      ]);
      await role();
      assert.equal(await rpc("touch_session", []), true);
    });
    await t.test(
      "hash reset preserves forced-change gate; only service finalization of fresh identity opens it",
      async () => {
        await admin(
          "update public.profiles set must_change_password=false where user_id=$1",
          [A],
        );
        await admin("update auth.users set encrypted_password=$1 where id=$2", [
          "new-synthetic-test-hash",
          A,
        ]);
        const profile = (
          await db.query<{ must_change_password: boolean }>(
            "select must_change_password from public.profiles where user_id=$1",
            [A],
          )
        ).rows[0];
        assert.equal(profile.must_change_password, true);
        await role();
        assert.equal(await rpc("touch_auth_session", []), false, "old session cannot enter password endpoint after hash reset");
        assert.equal(await rpc("touch_session", []), false);
        await assert.rejects(
          rpc("finalize_password_change", [A, SA]),
          /permission denied/,
        );
        await db.exec("reset role;set role anon");
        await assert.rejects(
          rpc("finalize_password_change", [A, SA]),
          /permission denied/,
        );
        await db.exec("reset role;set role service_role");
        assert.equal(
          await rpc("finalize_password_change", [A, SA]),
          false,
          "old session cannot finalize",
        );
        assert.equal(
          await rpc("finalize_password_change", [A, SB]),
          false,
          "other user session cannot finalize",
        );
        await admin(
          "update auth.sessions set created_at=clock_timestamp() where id=$1",
          [SA],
        );
        await role();
        assert.equal(await rpc("touch_auth_session", []), true, "fresh session can enter password flow only");
        assert.equal(
          await rpc("touch_session", []),
          false,
          "fresh session alone must not bypass password gate",
        );
        await db.exec("reset role;set role service_role");
        assert.equal(await rpc("finalize_password_change", [A, SA]), true);
        await role();
        assert.equal(await rpc("touch_session", []), true);
      },
    );
    await t.test(
      "service finalization rejects password changes outside short completion window",
      async () => {
        await admin(
          "update public.profiles set must_change_password=true,password_changed_at=now()-interval '10 minutes' where user_id=$1",
          [B],
        );
        await db.exec("set role service_role");
        assert.equal(await rpc("finalize_password_change", [B, SB]), false);
        await admin(
          "update public.profiles set must_change_password=false,password_changed_at=null where user_id=$1",
          [B],
        );
        await role();
      },
    );
    await t.test(
      "transaction rollback when contact insertion fails",
      async () => {
        await admin(
          "create function private.qa_fail() returns trigger language plpgsql as $$begin raise exception 'QA_INSERT_FAILURE'; end$$",
        );
        await admin(
          "create trigger qa_fail before insert on public.contacts for each row execute function private.qa_fail()",
        );
        await role();
        await assert.rejects(
          rpc("create_consultation", [
            JSON.stringify(payload),
            "30000000-0000-4000-8000-000000000099",
          ]),
          /QA_INSERT_FAILURE/,
        );
        assert.equal(
          (await db.query("select * from public.consultations")).rows.length,
          1,
        );
        await admin("drop trigger qa_fail on public.contacts");
        await role();
      },
    );
    await t.test(
      "anonymous has no read or RPC grant; limiter service-only and persistent",
      async () => {
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select * from public.consultations"),
          /permission denied/,
        );
        await assert.rejects(
          rpc("create_consultation", [JSON.stringify(payload), K]),
          /permission denied/,
        );
        await assert.rejects(
          rpc("consume_login_attempt", ["a".repeat(64)]),
          /permission denied/,
        );
        await db.exec("reset role;set role service_role");
        for (let i = 0; i < 5; i++)
          assert.equal(
            await rpc("consume_login_attempt", ["a".repeat(64)]),
            true,
          );
        assert.equal(
          await rpc("consume_login_attempt", ["a".repeat(64)]),
          false,
        );
        await role();
      },
    );
    await t.test(
      "disabled profiles and mismatched session owner cannot access",
      async () => {
        await role(A, SB);
        assert.equal(await rpc("touch_session", []), false);
        assert.equal(
          (await db.query("select * from public.consultations")).rows.length,
          0,
        );
        await admin(
          "update public.profiles set enabled=false where user_id=$1",
          [A],
        );
        await role();
        assert.equal(await rpc("touch_session", []), false);
        await assert.rejects(
          rpc("create_consultation", [JSON.stringify(payload), K]),
          /FORBIDDEN/,
        );
        await admin(
          "update public.profiles set enabled=true where user_id=$1",
          [A],
        );
        await role();
      },
    );
    await t.test(
      "expired auth session denies read independently of recent activity",
      async () => {
        await admin(
          "update auth.sessions set not_after=now()-interval '1 second' where id=$1",
          [SA],
        );
        await role();
        assert.equal(await rpc("touch_session", []), false);
        assert.equal(
          (await db.query("select * from public.consultations")).rows.length,
          0,
        );
        await admin("update auth.sessions set not_after=null where id=$1", [
          SA,
        ]);
        await role();
      },
    );
    await t.test(
      "direct RPC rejects malformed document, phone and unknown data",
      async () => {
        for (const person of [
          { ...payload.person, document: "-" },
          { ...payload.person, phones: ["not-a-phone"] },
          { ...payload.person, phones: ["------"] },
        ])
          await assert.rejects(
            rpc("create_consultation", [
              JSON.stringify({ ...payload, person }),
              "30000000-0000-4000-8000-000000000088",
            ]),
            /INVALID/,
          );
        await assert.rejects(
          rpc("create_consultation", [
            JSON.stringify({ ...payload, status: "open" }),
            "30000000-0000-4000-8000-000000000077",
          ]),
          /INVALID/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
