export type Session = {
  user: { id: string; username: string } | null;
  mustChangePassword: boolean;
  synthetic: boolean;
};
export type ParcelRef = { locality: string; parcel: string; address: string };
export type Person = {
  name: string;
  documentType: "CI" | "RUT" | "Otros";
  document: string;
  relationship: string;
  phones: string[];
  phoneTypes?: ("Fijo" | "Celular")[];
  emails: string[];
};
export type Contact = Person & { id: string };
export type ParcelImage = {
  kind: "historical" | "survey";
  url?: string | null;
  source: string;
  metadata?: Record<string, string>;
  unavailableReason?: string;
};
export type Parcel = ParcelRef & {
  fields?: Record<string, string>;
  provenance?: string;
  originalLandArea?: number | null;
  originalBuiltArea?: number | null;
  detectedBuiltArea?: number | null;
  contacts: Contact[];
  images: ParcelImage[];
};
export type Consultation = {
  id: string;
  locality: string;
  parcel: string;
  type: string;
  description: string;
  person: Person;
  creatorUserId: string;
  createdAt: string;
  version: number;
};
export type ConsultationPage = {
  items: Consultation[];
  total: number;
  page: number;
  pageSize: number;
};
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => null);
  if (init?.signal?.aborted)
    throw new DOMException("Request superseded", "AbortError");
  if (
    response.status === 401 &&
    !url.startsWith("/api/auth/") &&
    url !== "/api/session" &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("territory-session-expired"));
  if (!response.ok)
    throw new RequestError(
      typeof data?.error === "string"
        ? data.error
        : data?.error?.message ||
            "No se pudo completar la operación. Intentá nuevamente.",
      response.status,
    );
  return data as T;
}
