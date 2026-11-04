import { parseData } from "../domain";
export type ConsultationDraft = {
  name: string;
  relationship: string;
  documentType: string;
  document: string;
  phones: string[];
  emails: string[];
  type: string;
  description: string;
};
export type FieldErrors = Record<string, string>;
// Each field is evaluated by the same pure domain parser as the API. The other
// values are valid synthetic probes, not defaults submitted to the API.
const probe = {
  type: "General",
  description: "Validación sintética",
  person: {
    name: "PERSONA SINTÉTICA",
    relationship: "Titular",
    documentType: "CI",
    document: "00000001",
    phones: ["00000000"],
    emails: ["synthetic@example.test"],
  },
};
function accepts(value: unknown): boolean {
  try {
    parseData(value);
    return true;
  } catch {
    return false;
  }
}
export function validateConsultationFields(
  draft: ConsultationDraft,
): FieldErrors {
  const errors: FieldErrors = {};
  const personField = (field: string, value: unknown) =>
    accepts({ ...probe, person: { ...probe.person, [field]: value } });
  if (!personField("name", draft.name))
    errors.name = "Ingresá un nombre de hasta 200 caracteres.";
  if (!personField("relationship", draft.relationship))
    errors.relationship =
      "Ingresá el vínculo con el padrón, hasta 100 caracteres.";
  if (
    !accepts({
      ...probe,
      person: {
        ...probe.person,
        documentType: draft.documentType,
        document:
          draft.documentType === "RUT" ? "000000000001" : probe.person.document,
      },
    })
  )
    errors.documentType = "Elegí cédula de identidad o RUT.";
  if (
    !accepts({
      ...probe,
      person: {
        ...probe.person,
        documentType: draft.documentType,
        document: draft.document,
      },
    })
  )
    errors.document =
      draft.documentType === "RUT"
        ? "Ingresá un RUT de 12 dígitos."
        : "Ingresá una cédula de 7 u 8 dígitos; podés incluir puntos y guion.";
  if (!accepts({ ...probe, type: draft.type }))
    errors.type = "Elegí uno de los tres tipos de consulta disponibles.";
  if (!accepts({ ...probe, description: draft.description }))
    errors.description = "Ingresá una descripción de hasta 10.000 caracteres.";
  for (const [key, values, label] of [
    ["phone", draft.phones, "teléfono"],
    ["email", draft.emails, "correo electrónico"],
  ] as const) {
    if (!values.some((value) => value.trim()))
      errors[`${key}-0`] = `Ingresá al menos un ${label}.`;
    values.forEach((value, index) => {
      if (
        value.trim() &&
        !personField(key === "phone" ? "phones" : "emails", [value])
      )
        errors[`${key}-${index}`] =
          key === "phone"
            ? "Ingresá un teléfono válido de al menos 6 dígitos, hasta 40 caracteres."
            : "Ingresá un correo electrónico válido, hasta 254 caracteres.";
    });
  }
  return errors;
}
export function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    name: "Nombre completo",
    relationship: "Vínculo con el padrón",
    documentType: "Tipo de documento",
    document: "Documento",
    type: "Tipo",
    description: "Descripción",
  };
  if (key.startsWith("phone-")) return `Teléfono ${Number(key.slice(6)) + 1}`;
  if (key.startsWith("email-"))
    return `Correo electrónico ${Number(key.slice(6)) + 1}`;
  return labels[key] ?? "Formulario";
}
