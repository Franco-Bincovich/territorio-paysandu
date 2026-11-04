import type {
  Consultation,
  ConsultationRepository,
  ConsultationTransaction,
  Contact,
  HistoryFilter,
  Receipt,
} from "../../src/domain/index";
/** Test-only adapter. Serialized transactions and snapshots model rollback semantics. */
export class MemoryRepository implements ConsultationRepository {
  records = new Map<string, Consultation>();
  contacts: Contact[] = [];
  receipts: Receipt[] = [];
  failContactInsert = false;
  private tail: Promise<unknown> = Promise.resolve();
  async transaction<T>(
    operation: (tx: ConsultationTransaction) => Promise<T>,
  ): Promise<T> {
    const execute = async () => {
      const records = structuredClone(this.records);
      const contacts = structuredClone(this.contacts);
      const receipts = structuredClone(this.receipts);
      const tx: ConsultationTransaction = {
        findReceipt: async (userId, key) =>
          receipts.find((r) => r.userId === userId && r.key === key) ?? null,
        insertReceipt: async (receipt) => {
          if (
            receipts.some(
              (r) => r.userId === receipt.userId && r.key === receipt.key,
            )
          )
            throw new Error("Duplicate receipt");
          receipts.push(structuredClone(receipt));
        },
        get: async (id) => structuredClone(records.get(id) ?? null),
        insert: async (record) => {
          if (records.has(record.id)) throw new Error("Duplicate record");
          records.set(record.id, structuredClone(record));
        },
        insertContact: async (contact) => {
          if (this.failContactInsert)
            throw new Error("Simulated contact failure");
          contacts.push(structuredClone(contact));
        },
        replace: async (record, version) => {
          if (records.get(record.id)?.version !== version) return false;
          records.set(record.id, structuredClone(record));
          return true;
        },
      };
      const result = await operation(tx);
      this.records = records;
      this.contacts = contacts;
      this.receipts = receipts;
      return structuredClone(result);
    };
    const pending = this.tail.then(execute);
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  async get(id: string) {
    return structuredClone(this.records.get(id) ?? null);
  }
  async list(filter: HistoryFilter) {
    const all = [...this.records.values()]
      .filter(
        (r) =>
          (!filter.parcel ||
            (r.parcel.locality === filter.parcel.locality &&
              r.parcel.parcel === filter.parcel.parcel)) &&
          (!filter.type || r.data.type === filter.type) &&
          (!filter.from ||
            Date.parse(r.createdAt) >= Date.parse(filter.from)) &&
          (!filter.to || Date.parse(r.createdAt) <= Date.parse(filter.to)),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
    return {
      records: structuredClone(
        all.slice(
          (filter.page - 1) * filter.pageSize,
          filter.page * filter.pageSize,
        ),
      ),
      total: all.length,
    };
  }
}
