import type { ParcelRef } from "./contracts";

/** Group properties, never identities. Keep all source rows for future presentation.
 * The existing DTO contains no person identifier: matching names cannot be merged. */
export function groupParcelResults<T extends ParcelRef>(records: readonly T[]) {
  const groups = new Map<string, { key: string; records: T[]; addresses: string[] }>();
  for (const record of records) {
    const key = JSON.stringify([record.locality, record.parcel]);
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
