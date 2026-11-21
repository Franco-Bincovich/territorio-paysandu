const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../scripts/register-runtime-ts.cjs");

const { InstitutionalRepository } = require("../Backend/server/institutional/repository.ts");
const { parcelTypeWithNotice, requiresClassificationNotice } = require("../Frontend/src/components/parcel-classification.ts");

test("solo PH y UH activan el aviso de ficha tras normalizar PadPH", () => {
  for (const [value, expected] of [
    ["PH", "PH"], ["UH", "UH"], [" ph ", "PH"], ["\tUh ", "UH"],
    ["CO", null], ["co", null], [null, null], [undefined, null],
    ["", null], ["   ", null], ["RURAL", null], ["PHX", null], ["U H", null],
  ]) {
    assert.equal(parcelTypeWithNotice(value), expected, JSON.stringify(value));
  }
});

test("la ficha expone PadPH de la lectura catastral existente", async () => {
  for (const [stored, exposed] of [[" PH ", "PH"], ["uh", "uh"], ["CO", "CO"], [null, null], ["", null], ["   ", null], ["XYZ", "XYZ"]]) {
    const queries = [];
    const repository = new InstitutionalRepository(read => read({
      async query(sql) {
        queries.push(sql);
        return sql.includes("AGM_CIU_PADRONES")
          ? [{ PadCod: 10, PADRON: 101, LOCALIDAD: "PAYSANDU", PadPH: stored }]
          : [];
      },
    }));
    const record = await repository.getParcel("PAYSANDU", "101", "10");
    assert.equal(record.padPh, exposed);
    assert.equal(queries.length, 2);
    assert.match(queries[0], /p\.PadPH.*FROM AGM_CIU_PADRONES/s);
    assert.match(queries[1], /FROM AGM_CIU_VINCULOS/);
  }
});

test("la clasificación de búsqueda no abre el popup para PH ni UH", () => {
  const evidence = { source: "institutional", verified: true, reference: "QA" };
  for (const code of ["PH", "UH", "ph", " UH "]) {
    assert.equal(requiresClassificationNotice({ code, evidence }), false);
  }
  assert.equal(requiresClassificationNotice({ code: "RURAL", evidence }), true);
});
