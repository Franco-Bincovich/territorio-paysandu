"use client";

import { useEffect, useState } from "react";
import type { NotificationLot, NotificationLotPage, NotificationLotSummary } from "@backend/domain/notification-lots";
import { request } from "./contracts";
import { isAbort } from "./request-scope";
import { useRequestScope } from "./use-request-scope";

const listUrl = "/api/notification-lots";
const lotUrl = (id: NotificationLot["id"]) => `${listUrl}/${encodeURIComponent(id)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "No se pudieron cargar los lotes.";

export function NotificationLotsView({ canDownload }: { canDownload: boolean }) {
  const [lots, setLots] = useState<NotificationLotSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<NotificationLotSummary | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<NotificationLotPage | null>(null);
  const [detailError, setDetailError] = useState("");
  const listRequest = useRequestScope();
  const detailRequest = useRequestScope();

  useEffect(() => {
    const operation = listRequest.begin();
    request<{ lots: NotificationLotSummary[] }>(listUrl, { signal: operation.signal })
      .then(response => { if (operation.isCurrent()) setLots(response.lots); })
      .catch(error => { if (operation.isCurrent() && !isAbort(error)) setListError(errorText(error)); });
  }, [listRequest]);

  useEffect(() => {
    if (!selected) return;
    const operation = detailRequest.begin();
    request<NotificationLotPage>(`${lotUrl(selected.id)}?page=${page}`, { signal: operation.signal })
      .then(response => { if (operation.isCurrent()) setDetail(response); })
      .catch(error => { if (operation.isCurrent() && !isAbort(error)) setDetailError(errorText(error)); });
  }, [selected, page, detailRequest]);

  function selectPage(lot: NotificationLotSummary, nextPage: number) {
    if (selected?.id === lot.id && page === nextPage) return;
    detailRequest.cancel();
    setDetail(null);
    setDetailError("");
    setSelected(lot);
    setPage(nextPage);
  }

  return (
    <section className="panel">
      <h1>Lotes</h1>
      <p>Padrones asignados a cada lote. La pertenencia no indica autorización para notificar.</p>
      {listError && <p role="alert">{listError}</p>}
      {!lots && !listError && <p role="status">Cargando lotes…</p>}
      {lots && (
        <ul className="padron-list">
          {lots.map(lot => (
            <li key={lot.id}>
              <button className="padron-card" type="button" aria-pressed={selected?.id === lot.id}
                onClick={() => selectPage(lot, 1)}>
                <strong>{lot.label}</strong>
                <span>{lot.total} filas · {lot.uniqueParcels} padrones únicos</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section aria-labelledby="notification-lot-heading">
          <h2 id="notification-lot-heading">{selected.label}</h2>
          {canDownload && <a className="btn" href={`${lotUrl(selected.id)}/export`} download>Descargar Excel</a>}
          {detailError && <p role="alert">{detailError}</p>}
          {!detail && !detailError && <p role="status">Cargando padrones…</p>}
          {detail && (
            <>
              <p>{detail.total} filas · {detail.uniqueParcels} padrones únicos</p>
              {detail.unmatched > 0 && <p className="notice">{detail.unmatched} filas sin referencia catastral completa.</p>}
              {detail.total === 0 ? <p>No hay filas asignadas.</p> : (
                <>
                  <div className="tablewrap">
                    <table>
                      <caption className="sr-only">Padrones asignados a {selected.label}</caption>
                      <thead><tr><th scope="col">Localidad</th><th scope="col">Nº de padrón</th><th scope="col">PadCod</th></tr></thead>
                      <tbody>
                        {detail.rows.map((row, index) => (
                          <tr key={`${detail.page}-${index}`}>
                            <td>{row.locality ?? "Sin localidad"}</td>
                            <td>{row.parcel ?? "—"}</td>
                            <td>{row.padCod ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <nav aria-label="Páginas del lote">
                    <button type="button" className="btn" disabled={page <= 1}
                      onClick={() => selectPage(selected, page - 1)}>Anterior</button>
                    <span> Página {detail.page} de {Math.ceil(detail.total / detail.pageSize)} </span>
                    <button type="button" className="btn" disabled={page * detail.pageSize >= detail.total}
                      onClick={() => selectPage(selected, page + 1)}>Siguiente</button>
                  </nav>
                </>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
