import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  supabaseImageAdapter,
  downloadPrototypeImage,
  PROTOTYPE_KEY,
} from "../../src/server/storage-images";
import { imageResponse } from "../../src/server/images";
const historical = {
  locality: "Paysandú",
  parcel: "17718",
  kind: "historical",
  bucket: "imagenes-satelitales",
  filename: "synthetic-test.png",
  object_path: "paysandu/17718/historical/synthetic-test.png",
  source: "Google Earth",
  metadata: { sensor: "synthetic-only" },
  hosting_authorized_at: "2026-11-04T00:00:00+00:00",
};
const survey = {
  ...historical,
  kind: "survey",
  bucket: "imagenes-catastro",
  object_path: "paysandu/17718/survey/synthetic-test.png",
  source: "Relevamiento",
};
function fixture(rows: unknown, failBucket = "", dbError: unknown = null) {
  const filters: unknown[] = [],
    calls: unknown[] = [];
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      filters.push(args);
      return query;
    },
    then: (resolve: (x: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: dbError }).then(resolve),
  };
  const client = {
    from: (name: string) => {
      assert.equal(name, "parcel_images");
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          calls.push([bucket, path]);
          return bucket === failBucket
            ? { error: new Error("not found") }
            : {
                data: new Blob(["synthetic fixture bytes"], {
                  type: "image/png",
                }),
                error: null,
              };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { adapter: supabaseImageAdapter(client), client, filters, calls };
}
test("references use session-protected proxy; only survey metadata projected; PostgREST timezone accepted", async () => {
  const f = fixture([historical, survey]);
  const images = await f.adapter.getImages(PROTOTYPE_KEY);
  assert.deepEqual(f.filters, [
    ["locality", "Paysandú"],
    ["parcel", "17718"],
  ]);
  assert.equal(f.calls.length, 0);
  assert.equal(images.historical?.url, "/api/parcel-image/historical");
  const response = imageResponse(images, new Date());
  assert.equal("metadata" in response[0], false);
  assert.deepEqual(response[1].metadata, survey.metadata);
  assert.equal(response[0].url, "/api/parcel-image/historical");
  for (const kind of ["historical", "survey"])
    assert.equal(
      (await downloadPrototypeImage(f.client, kind)).type,
      "image/png",
    );
  assert.deepEqual(f.calls, [
    [historical.bucket, historical.object_path],
    [survey.bucket, survey.object_path],
  ]);
});
test("same parcel in a different locality and other parcels never query or sign", async () => {
  for (const key of [
    { locality: "Otra", parcel: "17718" },
    { locality: "Paysandú", parcel: "17719" },
  ]) {
    const f = fixture([historical]);
    assert.equal((await f.adapter.getImages(key)).historical, null);
    assert.equal(f.calls.length, 0);
    assert.equal(f.filters.length, 0);
  }
});
test("reject malformed, wrong bucket, traversal, unapproved and duplicate references before signing", async () => {
  for (const rows of [
    [{ ...historical, bucket: "imagenes-catastro" }],
    [{ ...historical, object_path: "../secret" }],
    [{ ...historical, hosting_authorized_at: null }],
    [historical, historical],
    [{ ...historical, locality: "Otra" }],
    [{ ...historical, filename: "../secret" }],
  ]) {
    const f = fixture(rows);
    await assert.rejects(f.adapter.getImages(PROTOTYPE_KEY));
    assert.equal(f.calls.length, 0);
  }
});
test("missing object fails explicitly; other object succeeds; missing refs and lookup failures handled", async () => {
  const f = fixture([historical, survey], "imagenes-satelitales");
  await assert.rejects(downloadPrototypeImage(f.client, "historical"));
  assert.equal(
    (await downloadPrototypeImage(f.client, "survey")).type,
    "image/png",
  );
  assert.equal(
    (await fixture([]).adapter.getImages(PROTOTYPE_KEY)).unavailableReason,
    "not_found",
  );
  await assert.rejects(downloadPrototypeImage(fixture([]).client, "survey"));
  await assert.rejects(
    fixture(null, "", new Error("denied")).adapter.getImages(PROTOTYPE_KEY),
  );
  await assert.rejects(downloadPrototypeImage(f.client, "../secret"));
});

test("proxy revalidates every request; revoked session denies bytes and all responses forbid caching", async () => {
  const { createImageDownloadHandler } =
    await import("../../src/server/image-download");
  const { HttpError } = await import("../../src/server/security");
  const f = fixture([historical, survey]);
  let authorized = true,
    checks = 0;
  const handle = createImageDownloadHandler({
    enabled: () => true,
    identity: async () => {
      checks++;
      if (!authorized) throw new HttpError(401, "SESSION_EXPIRED", "expired");
      return { client: f.client };
    },
  });
  const success = await handle("historical");
  assert.equal(success.status, 200);
  assert.equal(await success.text(), "synthetic fixture bytes");
  assert.equal(
    success.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  authorized = false;
  const denied = await handle("historical");
  assert.equal(denied.status, 401);
  assert.equal(checks, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(
    denied.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.ok(!(await denied.text()).includes("synthetic fixture bytes"));
});

test("jsonb metadata supports numbers, booleans, null and nested values without altering source data", async () => {
  const metadata = {
    area: 125.75,
    zero: 0,
    verified: false,
    missing: null,
    capture: { year: 2020, note: "original" },
    bands: ["red", 3, null],
    literal: "00125.750 m²",
    ["long-label-".repeat(12)]: "x".repeat(1100),
  };
  const before = JSON.stringify(metadata);
  const f = fixture([
    { ...historical, metadata },
    { ...survey, metadata },
  ]);
  const images = await f.adapter.getImages(PROTOTYPE_KEY);
  assert.deepEqual(images.survey?.metadata, {
    area: "125.75",
    zero: "0",
    verified: "false",
    missing: "null",
    capture: '{"year":2020,"note":"original"}',
    bands: '["red",3,null]',
    literal: "00125.750 m²",
    ["long-label-".repeat(12)]: "x".repeat(1100),
  });
  assert.equal(JSON.stringify(metadata), before);
  assert.equal("metadata" in imageResponse(images, new Date())[0], false);
  assert.equal(
    (await downloadPrototypeImage(f.client, "historical")).type,
    "image/png",
  );
  assert.equal(
    (await downloadPrototypeImage(f.client, "survey")).type,
    "image/png",
  );
});

test("metadata root matches SQL object constraint; malformed non-JSON values fail closed", async () => {
  for (const metadata of [
    null,
    [],
    "text",
    { bad: undefined },
    { bad: Infinity },
  ]) {
    await assert.rejects(
      fixture([{ ...survey, metadata }]).adapter.getImages(PROTOTYPE_KEY),
    );
  }
});
