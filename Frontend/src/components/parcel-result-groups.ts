import type { ParcelRef } from "./contracts";

/** Institutional properties use PadCod; legacy records keep their composite key.
 * Keep all source rows. Never merge person identities by name. */
export function groupParcelResults<T extends ParcelRef>(records: readonly T[]) {
  const groups = new Map<string, { key: string; records: T[]; addresses: string[] }>();
  for (const record of records) {
    const key = record.padCod !== undefined ? JSON.stringify(["institutional", record.padCod]) : JSON.stringify([record.locality, record.parcel]);
    let group = groups.get(key);
    if (!group) {
      group = { key, records: [], addresses: [] };
      groups.set(key, group);
    }
    group.records.push(record);
    if (record.address?.trim() && !group.addresses.includes(record.address))
      group.addresses.push(record.address);
  }
  return [...groups.values()];
}
