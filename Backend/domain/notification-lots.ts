export const notificationLots = [
  { id: "LOTE_INICIAL_47", label: "Lote 1" },
  { id: "E2-P03", label: "Lote 2" },
  { id: "E2-P04", label: "Lote 3" },
] as const;

export type NotificationLot = typeof notificationLots[number];
export type NotificationLotSummary = NotificationLot & { total: number; uniqueParcels: number };
export type NotificationLotCapabilities = { consult: boolean; download: boolean };
export type NotificationLotRow = {
  padCod: string | null;
  locality: string | null;
  parcel: string | null;
  hasParcel: boolean;
};
export type NotificationLotPage = {
  rows: NotificationLotRow[];
  total: number;
  uniqueParcels: number;
  unmatched: number;
  page: number;
  pageSize: number;
};
