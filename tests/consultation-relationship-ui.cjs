const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
require("../scripts/register-runtime-ts.cjs");
require.extensions[".css"] = () => {};
const { ConsultationForm } = require("../Frontend/src/components/consultation-form.tsx");
const { AuditSnapshot } = require("../Frontend/src/components/audit-snapshot.tsx");
const { validateConsultationFields, hasHistoricalRelationship, relationshipPayload } = require("../Frontend/src/components/consultation-validation.ts");

const parcel = { locality: "LOCALIDAD QA", parcel: "100", address: "" };
const person = {
  name: "Persona de prueba", relationship: "TITULAR", relationshipOtherDetail: null,
  documentType: "Otros", document: "QA-100", phones: ["099000000"], phoneTypes: ["Celular"],
  emails: ["vinculo@example.test"],
};
const draft = { ...person, type: "General", description: "Descripción de prueba de la consulta." };
const options = ["TITULAR", "BIEN GANANCIAL", "BIEN EN USUFRUC", "NUDA PROPIEDAD", "POSEEDOR", "PROMITENTE COMP", "Otro"];
function renderForm(initialPerson, readOnly = false) {
  return renderToStaticMarkup(createElement(ConsultationForm, {
    initial: initialPerson && { person: initialPerson, type: draft.type, description: draft.description },
    parcel, onSaved() {}, readOnly,
  }));
}

test("el alta ofrece las siete opciones exactas en orden y el detalle solo aparece para Otro", () => {
  const markup = renderForm();
  const select = markup.match(/<select[^>]*name="relationship"[^>]*>(.*?)<\/select>/s)[1];
  assert.deepEqual([...select.matchAll(/<option>(.*?)<\/option>/g)].map(match => match[1]), options);
  assert.doesNotMatch(markup, /name="relationshipOtherDetail"/);
  const readOnly = renderForm({ ...person, relationship: "Otro", relationshipOtherDetail: "Apoderado" }, true);
  assert.match(readOnly, /<fieldset disabled/);
  assert.match(readOnly, /Especificá el vínculo<\/label>/);
  assert.match(readOnly, /name="relationshipOtherDetail"[^>]*value="Apoderado"/);
});

test("el formulario rechaza Otro vacío, espacios y más de 100 caracteres y acepta 100 después de recortar", () => {
  const other = { ...draft, relationship: "Otro" };
  for (const relationshipOtherDetail of ["", "   ", "á".repeat(101)]) {
    assert.deepEqual(Object.keys(validateConsultationFields({ ...other, relationshipOtherDetail })), ["relationshipOtherDetail"]);
  }
  const boundary = "𐐀".repeat(100);
  const valid = { ...other, relationshipOtherDetail: "  " + boundary + "   " };
  assert.deepEqual(validateConsultationFields(valid), {});
  assert.deepEqual(relationshipPayload(valid), { relationship: "Otro", relationshipOtherDetail: boundary });
  assert.deepEqual(relationshipPayload({ ...other, relationshipOtherDetail: " Apoderado " }), {
    relationship: "Otro", relationshipOtherDetail: "Apoderado",
  });
});

test("al cambiar solo el detalle se envía el nuevo texto y al volver a TITULAR se envía null", () => {
  const initial = { relationship: "Otro", relationshipOtherDetail: "Apoderado" };
  assert.deepEqual(relationshipPayload({ ...draft, ...initial }, initial), {});
  assert.deepEqual(relationshipPayload({ ...draft, relationship: "Otro", relationshipOtherDetail: "  Representante  " }, initial),
    { relationship: "Otro", relationshipOtherDetail: "Representante" });
  assert.deepEqual(relationshipPayload({ ...draft, relationshipOtherDetail: "Texto anterior" }, initial),
    { relationship: "TITULAR", relationshipOtherDetail: null });
});

test("un valor histórico se muestra y queda fuera del PATCH hasta que se elige un vínculo nuevo", () => {
  for (const original of ["Titular", "Mandatario histórico", "Otro"]) {
    const initial = { ...person, relationship: original };
    assert.equal(hasHistoricalRelationship(initial), true);
    assert.match(renderForm(initial), new RegExp(original + " \\(vínculo histórico\\)"));
    assert.deepEqual(relationshipPayload({ ...draft, relationship: "" }, initial), {});
    assert.deepEqual(validateConsultationFields({ ...draft, relationship: "" }, 5, true), {});
    assert.deepEqual(relationshipPayload(draft, initial), { relationship: "TITULAR", relationshipOtherDetail: null });
  }
});

test("el historial muestra el texto de Otro y señala una modificación que solo cambió el detalle", () => {
  const before = { relacion_declarada: "Otro", relacion_otro_detalle: "Apoderado" };
  const after = { ...before, relacion_otro_detalle: "Representante" };
  for (const [value, comparison] of [[before, after], [after, before]]) {
    const markup = renderToStaticMarkup(createElement(AuditSnapshot, { value, comparison }));
    assert.ok(markup.includes("Detalle del vínculo"));
    assert.ok(markup.includes("Modificado</span></dt><dd>" + value.relacion_otro_detalle));
  }
});
