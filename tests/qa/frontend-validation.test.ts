import test from "node:test";
import assert from "node:assert/strict";
import {
  validateConsultationFields,
  type ConsultationDraft,
} from "../../src/components/consultation-validation";
const valid: ConsultationDraft = {
  name: "PERSONA SINTÉTICA",
  relationship: "Titular",
  documentType: "CI",
  document: "00000001",
  phones: ["00000000"],
  emails: ["synthetic@example.test"],
  type: "General",
  description: "Consulta sintética de prueba.",
};
test("all required fields reported together; no API needed", () => {
  const errors = validateConsultationFields({
    ...valid,
    name: " ",
    document: "",
    relationship: "",
    phones: [""],
    emails: [""],
    description: "",
  });
  for (const key of [
    "name",
    "document",
    "relationship",
    "phone-0",
    "email-0",
    "description",
  ])
    assert.ok(errors[key]);
});
test("variable contacts preserve original error index and require at least one nonempty value", () => {
  assert.deepEqual(
    validateConsultationFields({
      ...valid,
      phones: ["", "00000000", ""],
      emails: ["", "test@example.test"],
    }),
    {},
  );
  const errors = validateConsultationFields({
    ...valid,
    phones: ["00000000", "abc"],
    emails: ["test@example.test", "invalid"],
  });
  assert.ok(errors["phone-1"]);
  assert.ok(errors["email-1"]);
  assert.equal(errors["phone-0"], undefined);
});
test("domain structural documents accepted without imposing institutional checksum", () => {
  assert.deepEqual(
    validateConsultationFields({ ...valid, document: "0.000.000-1" }),
    {},
  );
  assert.deepEqual(
    validateConsultationFields({
      ...valid,
      documentType: "RUT",
      document: "000000000001",
    }),
    {},
  );
  assert.ok(
    validateConsultationFields({
      ...valid,
      documentType: "RUT",
      document: "123",
    }).document,
  );
});
test("description accepts full domain 10000 maximum and rejects control characters", () => {
  assert.deepEqual(
    validateConsultationFields({ ...valid, description: "a".repeat(10000) }),
    {},
  );
  assert.ok(
    validateConsultationFields({ ...valid, description: "a".repeat(10001) })
      .description,
  );
  assert.ok(
    validateConsultationFields({ ...valid, name: "bad\u0000name" }).name,
  );
});

test("description minimum is 20 trimmed Unicode codepoints", () => {
  for (const value of [
    "a".repeat(19),
    " \t\n\r\u00a0" + "a".repeat(19) + "\u00a0 ",
    "😀".repeat(19),
  ])
    assert.ok(
      validateConsultationFields({ ...valid, description: value }).description,
    );
  for (const value of [
    "a".repeat(20),
    "a".repeat(21),
    " \t\n\r\u00a0" + "😀".repeat(20) + "\u00a0 ",
    "😀".repeat(10000),
  ])
    assert.deepEqual(
      validateConsultationFields({ ...valid, description: value }),
      {},
    );
  assert.ok(
    validateConsultationFields({ ...valid, description: "😀".repeat(10001) })
      .description,
  );
});
