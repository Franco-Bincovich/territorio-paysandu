import test from "node:test";
import assert from "node:assert/strict";
import { catalogue } from "../../src/server/catalogue";

test("synthetic catalogue exact person search crosses localities without substring or name normalization", async () => {
  const previous = process.env.DATA_MODE;
  process.env.DATA_MODE = "synthetic";
  try {
    const adapter = catalogue();
    const matches = await adapter.findPerson({
      field: "name",
      exact: "PERSONA SINTÉTICA UNO",
    });
    assert.equal(matches.length, 3);
    assert.equal(new Set(matches.map((r) => r.key.locality)).size, 2);
    for (const exact of [
      "PERSONA",
      "PERSONA SINTÉTICA",
      "persona sintética uno",
      "",
    ])
      assert.equal(
        (await adapter.findPerson({ field: "name", exact })).length,
        0,
      );
    assert.equal(
      (await adapter.findPerson({ field: "CI", exact: "00000001" })).length,
      2,
    );
    assert.equal(
      (await adapter.findPerson({ field: "RUT", exact: "000000000001" }))
        .length,
      2,
    );
    assert.equal(
      (await adapter.findPerson({ field: "CI", exact: "0000000" })).length,
      0,
    );
    assert.equal(
      (await adapter.findPerson({ field: "RUT", exact: "00000000000" })).length,
      0,
    );
    assert.ok(matches.every((r) => r.source === "synthetic"));
    assert.deepEqual(matches.map((r) => r.key.parcel).sort(), [
      "900001",
      "900002",
      "900003",
    ]);
    for (const field of ["CI", "RUT"] as const) {
      const exact = field === "CI" ? "00000002" : "000000000002";
      const homonym = await adapter.findPerson({ field, exact });
      assert.equal(homonym.length, 1);
      assert.equal(homonym[0].key.parcel, "900003");
    }
  } finally {
    if (previous === undefined) delete process.env.DATA_MODE;
    else process.env.DATA_MODE = previous;
  }
});

test("parcel lookup preserves locality and textual parcel identity", async () => {
  const previous = process.env.DATA_MODE;
  process.env.DATA_MODE = "synthetic";
  try {
    const adapter = catalogue();
    assert.equal(
      (
        await adapter.findParcel({
          locality: "LOCALIDAD SINTÉTICA",
          parcel: "900001",
        })
      )?.key.parcel,
      "900001",
    );
    assert.equal(
      await adapter.findParcel({
        locality: "OTRA LOCALIDAD SINTÉTICA",
        parcel: "900001",
      }),
      null,
    );
    assert.equal(
      await adapter.findParcel({
        locality: "LOCALIDAD SINTÉTICA",
        parcel: "0900001",
      }),
      null,
    );
    assert.equal(
      await adapter.findParcel({
        locality: "LOCALIDAD SINTÉTICA",
        parcel: "900002",
      }),
      null,
    );
  } finally {
    if (previous === undefined) delete process.env.DATA_MODE;
    else process.env.DATA_MODE = previous;
  }
});

test("institutional or missing catalogue configuration fails closed", () => {
  const previous = process.env.DATA_MODE;
  try {
    for (const value of [undefined, "institutional"]) {
      if (value === undefined) delete process.env.DATA_MODE;
      else process.env.DATA_MODE = value;
      assert.throws(
        () => catalogue(),
        (error: any) =>
          error.status === 503 && error.code === "INTEGRATION_BLOCKED",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.DATA_MODE;
    else process.env.DATA_MODE = previous;
  }
});
