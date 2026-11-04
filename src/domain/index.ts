/** Portable business contracts. SessionContext MUST be produced by a trusted auth adapter. */
export type ConsultationType = "General" | "Reclamo" | "Falta de documentación";
export type ParcelKey = Readonly<{ locality: string; parcel: string }>;
export type PersonSnapshot = Readonly<{
  name: string;
  documentType: "CI" | "RUT";
  document: string;
  relationship: string;
  phones: readonly string[];
  emails: readonly string[];
}>;
export type ConsultationData = Readonly<{
  person: PersonSnapshot;
  type: ConsultationType;
  description: string;
}>;
export type SessionContext = Readonly<{
  userId: string;
  role: "Colaborador";
  enabled: boolean;
  mustChangePassword: boolean;
  verified: boolean;
  expiresAt: string;
  lastActivityAt: string;
}>;
export type Revision = Readonly<{
  version: number;
  at: string;
  by: string;
  data: ConsultationData;
}>;
export type Consultation = Readonly<{
  id: string;
  parcel: ParcelKey;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  originalSnapshot: ConsultationData;
  data: ConsultationData;
  revisions: readonly Revision[];
}>;
export type Contact = Readonly<{
  id: string;
  consultationId: string;
  parcel: ParcelKey;
  person: PersonSnapshot;
  createdAt: string;
}>;
export type HistoryFilter = Readonly<{
  parcel?: ParcelKey;
  type?: ConsultationType;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}>;
export type HistoryPage = Readonly<{
  records: readonly Consultation[];
  total: number;
}>;
export type Receipt = Readonly<{
  userId: string;
  key: string;
  fingerprint: string;
  consultationId: string;
}>;

/** Transaction must serialize conflicting idempotency keys; failures roll back all writes. */
export interface ConsultationTransaction {
  findReceipt(userId: string, key: string): Promise<Receipt | null>;
  insertReceipt(receipt: Receipt): Promise<void>;
  get(id: string): Promise<Consultation | null>;
  insert(record: Consultation): Promise<void>;
  insertContact(contact: Contact): Promise<void>;
  /** Atomic compare-and-swap; false means stale version. */
  replace(record: Consultation, expectedVersion: number): Promise<boolean>;
}
export interface ConsultationRepository {
  transaction<T>(
    operation: (tx: ConsultationTransaction) => Promise<T>,
  ): Promise<T>;
  get(id: string): Promise<Consultation | null>;
  list(filter: HistoryFilter): Promise<HistoryPage>;
}
export type ParcelRecord = Readonly<{
  key: ParcelKey;
  address: string;
  originalLandArea: number | null;
  originalBuildingArea: number | null;
  detectedBuildingArea: number | null;
  source: "synthetic" | "institutional" | "prototype";
  fields?: Record<string, string>;
  provenance?: string;
}>;
export type PersonSearch = Readonly<{
  field: "name" | "CI" | "RUT";
  exact: string;
}>;
export interface CadastreAdapter {
  findParcel(key: ParcelKey): Promise<ParcelRecord | null>;
  /** No locality restriction; exact match, never substring matching. */
  findPerson(query: PersonSearch): Promise<readonly ParcelRecord[]>;
}
export type ParcelImage = Readonly<{
  url: string;
  source: string;
  expiresAt?: string;
  capturedAt?: string;
}>;
export type ParcelImages = Readonly<{
  historical: ParcelImage | null;
  survey: (ParcelImage & { metadata: Readonly<Record<string, string>> }) | null;
  unavailableReason?: "not_found" | "temporarily_unavailable";
}>;
export interface ImageAdapter {
  getImages(key: ParcelKey): Promise<ParcelImages>;
}
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "PASSWORD_CHANGE_REQUIRED"
      | "SESSION_EXPIRED"
      | "VALIDATION"
      | "NOT_FOUND"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
const types: readonly string[] = [
  "General",
  "Reclamo",
  "Falta de documentación",
];
const fail = (message: string): never => {
  throw new DomainError("VALIDATION", message);
};
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail("Expected object");
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Unexpected field");
}
function string(value: unknown, field: string, max = 500): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(`Invalid ${field}`);
  return (value as string).trim();
}
export function parseParcel(value: unknown): ParcelKey {
  const data = obj(value);
  exactKeys(data, ["locality", "parcel"]);
  const locality = string(data.locality, "locality", 100);
  const parcel = string(data.parcel, "parcel", 30);
  if (!/^\d+$/.test(parcel)) fail("Invalid parcel");
  return Object.freeze({ locality, parcel });
}
/** Minimum from PAY-T032. The existing technical maximum is retained pending
 * owner reconciliation with the historical provisional 5000; not an approved requirement. */
export const DESCRIPTION_MIN_LENGTH = 20;
export const DESCRIPTION_MAX_LENGTH = 10000;
export function parseDescription(value: unknown): string {
  if (
    typeof value !== "string" ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail("Invalid description");
  const normalized = (value as string).trim();
  // Unicode code points match PostgreSQL length(text); avoid UTF-16 surrogate counting.
  const length = Array.from(normalized).length;
  if (length < DESCRIPTION_MIN_LENGTH || length > DESCRIPTION_MAX_LENGTH)
    fail("Invalid description");
  return normalized;
}
export function parseData(value: unknown): ConsultationData {
  const data = obj(value);
  exactKeys(data, ["person", "type", "description"]);
  if (!types.includes(data.type as string)) fail("Invalid consultation type");
  const p = obj(data.person);
  exactKeys(p, [
    "name",
    "documentType",
    "document",
    "relationship",
    "phones",
    "emails",
  ]);
  if (p.documentType !== "CI" && p.documentType !== "RUT")
    fail("Invalid document type");
  const document = string(p.document, "document", 30).replace(/[.\s-]/g, "");
  // Structural validation only; authoritative checksum rules must be supplied by the institution.
  if (
    !/^\d+$/.test(document) ||
    (p.documentType === "CI"
      ? !/^\d{7,8}$/.test(document)
      : !/^\d{12}$/.test(document))
  )
    fail("Invalid document format");
  if (
    !Array.isArray(p.phones) ||
    p.phones.length === 0 ||
    !Array.isArray(p.emails) ||
    p.emails.length === 0
  )
    fail("At least one phone and email required");
  const phones = (p.phones as unknown[]).map((item) => {
    const phone = string(item, "phone", 40);
    if (
      !/^\+?[\d ()-]{6,40}$/.test(phone) ||
      phone.replace(/\D/g, "").length < 6
    )
      fail("Invalid phone");
    return phone;
  });
  const emails = (p.emails as unknown[]).map((item) => {
    const email = string(item, "email", 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Invalid email");
    return email;
  });
  return Object.freeze({
    type: data.type as ConsultationType,
    description: parseDescription(data.description),
    person: Object.freeze({
      name: string(p.name, "name", 200),
      documentType: p.documentType as "CI" | "RUT",
      document,
      relationship: string(p.relationship, "relationship", 100),
      phones: Object.freeze(phones),
      emails: Object.freeze(emails),
    }),
  });
}
export function authorize(session: SessionContext, now: Date): void {
  if (!session || session.verified !== true || !session.userId)
    throw new DomainError("UNAUTHENTICATED", "Verified session required");
  if (!session.enabled || session.role !== "Colaborador")
    throw new DomainError("FORBIDDEN", "Active collaborator required");
  const expiry = Date.parse(session.expiresAt);
  const activity = Date.parse(session.lastActivityAt);
  if (
    !Number.isFinite(expiry) ||
    !Number.isFinite(activity) ||
    expiry <= now.getTime() ||
    activity > now.getTime() ||
    now.getTime() - activity >= 60 * 60 * 1000
  )
    throw new DomainError("SESSION_EXPIRED", "Session expired");
  if (session.mustChangePassword !== false)
    throw new DomainError(
      "PASSWORD_CHANGE_REQUIRED",
      "Password change required",
    );
}
export class ConsultationService {
  constructor(
    private readonly repository: ConsultationRepository,
    private readonly now: () => Date,
    private readonly id: () => string,
  ) {}
  async create(session: SessionContext, input: unknown): Promise<Consultation> {
    const now = this.now();
    authorize(session, now);
    const dto = obj(input);
    exactKeys(dto, ["parcel", "data", "idempotencyKey"]);
    const parcel = parseParcel(dto.parcel);
    const data = parseData(dto.data);
    const key = string(dto.idempotencyKey, "idempotency key", 128);
    const fingerprint = JSON.stringify({ parcel, data });
    const at = now.toISOString();
    return this.repository.transaction(async (tx) => {
      const receipt = await tx.findReceipt(session.userId, key);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new DomainError(
            "CONFLICT",
            "Idempotency key reused with different payload",
          );
        const existing = await tx.get(receipt.consultationId);
        if (!existing) throw new Error("Broken idempotency receipt");
        return existing;
      }
      const record: Consultation = Object.freeze({
        id: this.id(),
        parcel,
        creatorUserId: session.userId,
        createdAt: at,
        updatedAt: at,
        version: 1,
        originalSnapshot: data,
        data,
        revisions: Object.freeze([
          { version: 1, at, by: session.userId, data },
        ]),
      });
      await tx.insert(record);
      await tx.insertContact({
        id: this.id(),
        consultationId: record.id,
        parcel,
        person: data.person,
        createdAt: at,
      });
      await tx.insertReceipt({
        userId: session.userId,
        key,
        fingerprint,
        consultationId: record.id,
      });
      return record;
    });
  }
  async edit(session: SessionContext, input: unknown): Promise<Consultation> {
    const now = this.now();
    authorize(session, now);
    const dto = obj(input);
    exactKeys(dto, ["id", "expectedVersion", "data"]);
    const id = string(dto.id, "id", 128);
    const data = parseData(dto.data);
    if (
      !Number.isSafeInteger(dto.expectedVersion) ||
      (dto.expectedVersion as number) < 1
    )
      fail("Invalid expectedVersion");
    return this.repository.transaction(async (tx) => {
      const old = await tx.get(id);
      if (!old) throw new DomainError("NOT_FOUND", "Consultation not found");
      if (old.creatorUserId !== session.userId)
        throw new DomainError("FORBIDDEN", "Only creator may edit");
      if (old.version !== dto.expectedVersion)
        throw new DomainError("CONFLICT", "Consultation changed");
      const version = old.version + 1;
      const at = now.toISOString();
      const next: Consultation = Object.freeze({
        ...old,
        data,
        updatedAt: at,
        version,
        revisions: Object.freeze([
          ...old.revisions,
          { version, at, by: session.userId, data },
        ]),
      });
      if (!(await tx.replace(next, old.version)))
        throw new DomainError("CONFLICT", "Consultation changed");
      return next;
    });
  }
  async get(session: SessionContext, id: string): Promise<Consultation> {
    authorize(session, this.now());
    const record = await this.repository.get(string(id, "id", 128));
    if (!record) throw new DomainError("NOT_FOUND", "Consultation not found");
    return record;
  }
  async list(
    session: SessionContext,
    filter: HistoryFilter,
  ): Promise<HistoryPage> {
    authorize(session, this.now());
    if (
      !Number.isSafeInteger(filter.page) ||
      filter.page < 1 ||
      !Number.isSafeInteger(filter.pageSize) ||
      filter.pageSize < 1 ||
      filter.pageSize > 100
    )
      fail("Invalid pagination");
    if (filter.type !== undefined && !types.includes(filter.type))
      fail("Invalid consultation type");
    for (const date of [filter.from, filter.to])
      if (date !== undefined && !Number.isFinite(Date.parse(date)))
        fail("Invalid date filter");
    if (
      filter.from &&
      filter.to &&
      Date.parse(filter.from) > Date.parse(filter.to)
    )
      fail("Invalid date range");
    return this.repository.list({
      ...filter,
      parcel: filter.parcel ? parseParcel(filter.parcel) : undefined,
    });
  }
}
