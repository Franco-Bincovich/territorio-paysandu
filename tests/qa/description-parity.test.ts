import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { parseData } from "../../src/domain";
import { validateConsultationFields } from "../../src/components/consultation-validation";
const person = {
  name: "PERSONA QA SINTÉTICA",
  documentType: "CI",
  document: "00000001",
  relationship: "Titular",
  phones: ["00000001"],
  emails: ["qa@example.test"],
};
const samples = () => {
  const rows: Array<{ label: string; value: string; valid: boolean }> = [];
  for (const symbol of ["a", "😀"])
    for (const n of [19, 20, 21, 10000, 10001])
      rows.push({
        label: `${symbol} ${n}codepoints`,
        value: symbol.repeat(n),
        valid: n >= 20 && n <= 10000,
      });
  for (const ws of [
    " ",
    "\t",
    "\n",
    "\r",
    "\u00a0",
    "\u2003",
    "\u2028",
    "\ufeff",
  ])
    for (const n of [0, 19, 20])
      rows.push({
        label: `trim U+${ws.codePointAt(0)!.toString(16)} ${n}`,
        value: ws + "á".repeat(n) + ws,
        valid: n === 20,
      });
  for (const c of ["\u0000", "\u0001", "\u0008", "\u000b", "\u000c", "\u001f"])
    rows.push({
      label: `raw control ${c.codePointAt(0)}`,
      value: c + "a".repeat(20) + c,
      valid: false,
    });
  rows.push({
    label: "combining codepoints",
    value: "a\u0301".repeat(10),
    valid: true,
  });
  return rows;
};
test("independent description domain/client parity at codepoint boundaries and Unicode whitespace", () => {
  for (const row of samples()) {
    const input = { type: "General", person, description: row.value };
    if (row.valid)
      assert.equal(parseData(input).description, row.value.trim(), row.label);
    else assert.throws(() => parseData(input), row.label);
    const errors = validateConsultationFields({
      ...person,
      type: "General",
      description: row.value,
    });
    assert.equal(Boolean(errors.description), !row.valid, row.label);
  }
});
test("independent public SQL RPC rejects bypassed invalid lengths; valid create/edit/retry preserve invariants", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create table auth.users(id uuid primary key,encrypted_password text);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now(),not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;`);
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    const user = randomUUID(),
      session = randomUUID();
    await db.query("insert into auth.users values($1,$2)", [
      user,
      "SYNTHETIC_ONLY",
    ]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      session,
      user,
    ]);
    await db.query(
      "insert into public.profiles(user_id,username,must_change_password) values($1,'QA-PARITY',false)",
      [user],
    );
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user, JSON.stringify({ session_id: session })],
    );
    await db.exec("set role authenticated");
    await db.query("select public.touch_session()");
    const payload = (description: string) => ({
      locality: "QA",
      parcel: "99999",
      type: "General",
      person,
      description,
    });
    const create = async (description: string, key = randomUUID()) =>
      (
        await db.query<{ value: any }>(
          "select public.create_consultation($1::jsonb,$2::uuid) as value",
          [JSON.stringify(payload(description)), key],
        )
      ).rows[0].value;
    let validCount = 0;
    for (const row of samples()) {
      if (row.valid) {
        const saved = await create(row.value);
        assert.equal(saved.description, row.value.trim(), row.label);
        validCount++;
      } else await assert.rejects(create(row.value), row.label);
    }
    const key = randomUUID(),
      initial = "😀".repeat(20);
    const first = await create(initial, key);
    validCount++;
    assert.equal((await create(initial, key)).id, first.id);
    await assert.rejects(
      create("different valid content for conflict", key),
      /IDEMPOTENCY_CONFLICT/,
    );
    const edit = async (description: string) =>
      (
        await db.query<{ value: any }>(
          "select public.edit_consultation($1::uuid,$2::integer,$3::jsonb) as value",
          [first.id, 1, JSON.stringify(payload(description))],
        )
      ).rows[0].value;
    await assert.rejects(edit("x".repeat(19)));
    const edited = await edit("z".repeat(21));
    assert.equal(edited.version, 2);
    assert.equal(edited.original_snapshot.description, initial);
    assert.equal(edited.description, "z".repeat(21));
    await assert.rejects(edit("z".repeat(21)), /VERSION_CONFLICT/);
    const counts = await db.query<{ n: number }>(
      "select count(*)::integer as n from public.contacts",
    );
    assert.equal(
      counts.rows[0].n,
      validCount,
      "invalid create/edit/retry never creates extra contact",
    );
  } finally {
    await db.close();
  }
});
