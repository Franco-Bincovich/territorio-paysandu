"use client";

import { useEffect, useState } from "react";
import type { NotificationLot, NotificationLotPreview, NotificationLotSummary } from "@backend/domain/notification-lots";
import { request } from "./contracts";
import { isAbort } from "./request-scope";
import { useRequestScope } from "./use-request-scope";
import "./notification-lots.css";

const listUrl = "/api/notification-lots";
const lotUrl = (id: NotificationLot["id"]) => `${listUrl}/${encodeURIComponent(id)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "No se pudieron cargar los lotes.";

export function NotificationLotsView({ canDownload }: { canDownload: boolean }) {
  const [lots, setLots] = useState<NotificationLotSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<NotificationLotSummary | null>(null);
  const [detail, setDetail] = useState<NotificationLotPreview | null>(null);
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
    request<NotificationLotPreview>(lotUrl(selected.id), { signal: operation.signal })
      .then(response => { if (operation.isCurrent()) setDetail(response); })
      .catch(error => { if (operation.isCurrent() && !isAbort(error)) setDetailError(errorText(error)); });
  }, [selected, detailRequest]);

  function selectLot(lot: NotificationLotSummary) {
    if (selected?.id === lot.id) return;
    detailRequest.cancel();
    setDetail(null);
    setDetailError("");
    setSelected(lot);
  }

  return (
    <section className="panel notification-lots">
      <div className="intro">
        <div>
          <h1>Lotes</h1>
          <p className="muted">Padrones asignados a cada lote. La pertenencia no indica autorización para notificar.</p>
        </div>
      </div>
      {listError && <p role="alert">{listError}</p>}
      {!lots && !listError && <p role="status">Cargando lotes…</p>}
      {lots && (
        <ul className="padron-list">
          {lots.map(lot => (
            <li key={lot.id}>
              <button className="padron-card" type="button" aria-pressed={selected?.id === lot.id}
                onClick={() => selectLot(lot)}>
                <strong>{lot.label}</strong>
                <small className="muted">{lot.total} filas · {lot.uniqueParcels} padrones únicos</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section className="notification-lot-detail" aria-labelledby="notification-lot-heading">
          <div className="panel-head">
            <div>
              <h2 id="notification-lot-heading">{selected.label}</h2>
              {detail && <p className="muted">{detail.total} filas · {detail.uniqueParcels} padrones únicos</p>}
            </div>
            <div className="notification-lot-actions">
              {canDownload && <a className="btn primary" href={`${lotUrl(selected.id)}/export`} download>Descargar Excel</a>}
              {detail && <p className="muted">Mostrando {detail.rows.length} de {detail.total} filas</p>}
            </div>
          </div>
          {detailError && <p role="alert">{detailError}</p>}
          {!detail && !detailError && <p role="status">Cargando padrones…</p>}
          {detail && (
            <>
              {detail.unmatched > 0 && <p className="notice">{detail.unmatched} filas sin referencia catastral completa.</p>}
              {detail.total === 0 ? <p>No hay filas asignadas.</p> : (
                <div key={selected.id} className="tablewrap" role="region"
                  aria-label={`Vista previa de ${selected.label}`} tabIndex={0}>
                  <table className="notification-lot-table">
                    <thead><tr>{detail.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
                    <tbody>
                      {detail.rows.map((row, index) => (
                        <tr key={index}>
                          {row.map((cell, columnIndex) => <td key={columnIndex}>{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
