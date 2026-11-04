import test from "node:test";
import assert from "node:assert/strict";
import {
  ConsultationService,
  DomainError,
  authorize,
  parseData,
  type SessionContext,
} from "../../src/domain/index";
import { MemoryRepository } from "./memory";
const now = new Date("2026-01-01T12:00:00Z");
const actor: SessionContext = {
  userId: "synthetic-user-a",
  role: "Colaborador",
  enabled: true,
  verified: true,
  mustChangePassword: false,
  expiresAt: "2026-01-01T13:00:00Z",
  lastActivityAt: "2026-01-01T11:30:00Z",
};
const data = {
  person: {
    name: "Persona sintética QA",
    documentType: "CI",
    document: "12345678",
    relationship: "Titular",
    phones: ["099000000"],
    emails: ["qa@example.invalid"],
  },
  type: "General",
  description: "Consulta sintética de prueba.",
};
const input = {
  parcel: { locality: "LOCALIDAD-SINTETICA", parcel: "999999" },
  data,
  idempotencyKey: "request-a",
};
function setup() {
  const repository = new MemoryRepository();
  let counter = 0;
  return {
    repository,
    service: new ConsultationService(
      repository,
      () => now,
      () => `synthetic-${++counter}`,
    ),
  };
}
const code = (expected: DomainError["code"]) => (error: unknown) =>
  error instanceof DomainError && error.code === expected;

test("create persists one historical snapshot and new contact; repeated people remain independent", async () => {
  const { repository, service } = setup();
  const first = await service.create(actor, input);
  const second = await service.create(actor, {
    ...input,
    idempotencyKey: "request-b",
  });
  assert.notEqual(first.id, second.id);
  assert.equal(repository.contacts.length, 2);
  assert.equal(first.creatorUserId, actor.userId);
  assert.deepEqual(first.originalSnapshot, first.data);
  assert.equal(first.revisions.length, 1);
});
test("concurrent same-key retries create exactly one contact and consultation", async () => {
  const { repository, service } = setup();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => service.create(actor, input)),
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal(repository.records.size, 1);
  assert.equal(repository.contacts.length, 1);
  await assert.rejects(
    service.create(actor, {
      ...input,
      data: { ...data, description: "Different synthetic consultation" },
    }),
    code("CONFLICT"),
  );
});
test("contact failure rolls back consultation and receipt and permits retry", async () => {
  const { repository, service } = setup();
  repository.failContactInsert = true;
  await assert.rejects(
    service.create(actor, input),
    /Simulated contact failure/,
  );
  assert.equal(repository.records.size, 0);
  assert.equal(repository.receipts.length, 0);
  assert.equal(repository.contacts.length, 0);
  repository.failContactInsert = false;
  await service.create(actor, input);
  assert.equal(repository.records.size, 1);
});
test("read is global; edit is creator-only and cannot transfer ownership", async () => {
  const { service } = setup();
  const created = await service.create(actor, input);
  const other = { ...actor, userId: "synthetic-user-b" };
  assert.equal((await service.get(other, created.id)).id, created.id);
  await assert.rejects(
    service.edit(other, { id: created.id, expectedVersion: 1, data }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.edit(actor, {
      id: created.id,
      expectedVersion: 1,
      data,
      creatorUserId: other.userId,
    }),
    code("VALIDATION"),
  );
  await assert.rejects(
    service.create(actor, { ...input, creatorUserId: other.userId }),
    code("VALIDATION"),
  );
});
test("editing preserves original snapshot, contact and revision history; detects lost updates", async () => {
  const { repository, service } = setup();
  const created = await service.create(actor, input);
  const changed = {
    ...data,
    person: { ...data.person, name: "Persona sintética corregida" },
    description: "Corrección sintética de consulta",
  };
  const outcomes = await Promise.allSettled([
    service.edit(actor, { id: created.id, expectedVersion: 1, data: changed }),
    service.edit(actor, { id: created.id, expectedVersion: 1, data }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const failure = outcomes.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.ok(code("CONFLICT")(failure.reason));
  const saved = await service.get(actor, created.id);
  assert.equal(saved.version, 2);
  assert.equal(saved.revisions.length, 2);
  assert.equal(saved.originalSnapshot.person.name, data.person.name);
  assert.equal(repository.contacts[0].person.name, data.person.name);
  assert.equal(saved.revisions[0].data.person.name, data.person.name);
  assert.equal(saved.data.person.name, changed.person.name);
});
test("password, inactivity and disabled gates protect every operation", async () => {
  const { service } = setup();
  for (const [patch, expected] of [
    [{ mustChangePassword: true }, "PASSWORD_CHANGE_REQUIRED"],
    [{ enabled: false }, "FORBIDDEN"],
    [{ verified: false }, "UNAUTHENTICATED"],
    [{ lastActivityAt: "2026-01-01T11:00:00Z" }, "SESSION_EXPIRED"],
    [{ lastActivityAt: "2026-01-01T12:01:00Z" }, "SESSION_EXPIRED"],
    [{ expiresAt: "2026-01-01T12:00:00Z" }, "SESSION_EXPIRED"],
  ] as const) {
    const blocked = { ...actor, ...patch };
    await assert.rejects(service.create(blocked, input), code(expected));
    await assert.rejects(
      service.edit(blocked, { id: "x", expectedVersion: 1, data }),
      code(expected),
    );
    await assert.rejects(service.get(blocked, "x"), code(expected));
    await assert.rejects(
      service.list(blocked, { page: 1, pageSize: 20 }),
      code(expected),
    );
  }
  assert.doesNotThrow(() =>
    authorize({ ...actor, lastActivityAt: "2026-01-01T11:00:00.001Z" }, now),
  );
});
test("validation rejects unknown fields, empty contacts and unapproved type; permits variable contacts", () => {
  for (const bad of [
    { ...data, status: "open" },
    { ...data, type: "Custom" },
    { ...data, person: { ...data.person, phones: [] } },
    { ...data, person: { ...data.person, phones: ["------"] } },
    { ...data, person: { ...data.person, emails: ["bad"] } },
    { ...data, person: { ...data.person, document: "abc" } },
  ])
    assert.throws(() => parseData(bad), code("VALIDATION"));
  const parsed = parseData({
    ...data,
    person: {
      ...data.person,
      phones: Array(12).fill("099000000"),
      emails: Array(12).fill("qa@example.invalid"),
    },
  });
  assert.equal(parsed.person.phones.length, 12);
  assert.equal(parsed.person.emails.length, 12);
});
test("combined history filters preserve composite parcel identity and paginate", async () => {
  const { service } = setup();
  await service.create(actor, input);
  await service.create(actor, {
    ...input,
    parcel: { ...input.parcel, locality: "OTRA-SINTETICA" },
    idempotencyKey: "request-b",
  });
  assert.equal((await service.list(actor, { page: 1, pageSize: 1 })).total, 2);
  const filtered = await service.list(actor, {
    page: 1,
    pageSize: 20,
    parcel: input.parcel,
    type: "General",
    from: "2026-01-01",
    to: "2026-01-02",
  });
  assert.equal(filtered.total, 1);
  await assert.rejects(
    service.list(actor, { page: 0, pageSize: 20 }),
    code("VALIDATION"),
  );
});
