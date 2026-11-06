import type { ParcelRef } from "./contracts";

/** Proposed additive search DTO. Current production API does not emit this field.
 * Only a trusted server adapter with an institutional reference may supply it. */
export type ParcelSearchResult = ParcelRef & {
  classification?: {
    code: string;
    evidence: { source: "institutional"; verified: boolean; reference: string };
  };
};

export function requiresClassificationNotice(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const classification = value as Partial<NonNullable<ParcelSearchResult["classification"]>>;
  return (
    ["PH", "UH", "RURAL"].includes(classification.code ?? "") &&
    classification.evidence?.source === "institutional" &&
    classification.evidence.verified === true &&
    typeof classification.evidence.reference === "string" &&
    classification.evidence.reference.trim().length > 0
  );
}
