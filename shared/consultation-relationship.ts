export const relationshipOptions = [
  "TITULAR",
  "BIEN GANANCIAL",
  "BIEN EN USUFRUC",
  "NUDA PROPIEDAD",
  "POSEEDOR",
  "PROMITENTE COMP",
  "Otro",
] as const;

export function isRelationshipOption(value: unknown): value is typeof relationshipOptions[number] {
  return relationshipOptions.some(option => option === value);
}

export function relationshipDetailError(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return "Especificá el vínculo para guardar la consulta.";
  if (Array.from(value.trim()).length > 100) return "Ingresá hasta 100 caracteres, sin contar espacios al principio y al final.";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return "Ingresá un vínculo válido.";
}
