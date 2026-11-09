export type InstitutionalLink = {
  conCod: string | null; relCod: string | null; relationship: string;
  priority: number | null; prioritized: string | null;
  contactPriority: number | null; contactPrioritized: string | null;
  documentType: string | null; documentOriginal: string | null;
  documentNormalized: string | null; documentValid: string | null; documentState: string | null;
};
export type InstitutionalPerson = {
  personId: string | null; name: string; links: InstitutionalLink[];
  media: { type: string; value: string }[];
};
export type InstitutionalRef = {
  padCod: string; locality: string; parcel: string; address: string;
  source: "institutional";
  matchedPeople?: { personId: string | null; name: string; documentType: string | null; document: string | null;
    links?: { conCod: string | null; relCod: string | null; relationship: string; priority: number | null }[] }[];
};
export type PersonCandidate = { personId: string; name: string; documentType: string | null;
  document: string | null; parcelCount: number };
export type PersonSearchResult = { results: InstitutionalRef[]; people: PersonCandidate[];
  requiresDisambiguation: boolean; selectedPersonId: string | null; unidentifiedMatches: number };
export type InstitutionalParcel = InstitutionalRef & {
  fields: Record<string, string>; provenance: string;
  originalLandArea: number | null; originalBuiltArea: number | null; detectedBuiltArea: null;
  institutionalPeople: InstitutionalPerson[]; contacts: []; images: [];
  readOnly: true; synthetic: false;
};
