"use client";
import { useId, useMemo } from "react";
import type { ParcelRef } from "./contracts";
import { groupParcelResults } from "./parcel-result-groups";
import "./package-4-visual.css";

export function ParcelSearchResults({ results, busy, error, nameSearch, onOpen }: {
  results: readonly ParcelRef[] | null;
  busy: boolean;
  error: string;
  nameSearch: boolean;
  onOpen: (parcel: ParcelRef) => Promise<void>;
}) {
  const headingId = useId();
  const groups = useMemo(() => groupParcelResults(results ?? []), [results]);
  if (!busy && !error && results === null) return null;
  return (
    <section className="panel results search-results" aria-labelledby={headingId}>
      <h2 id={headingId}>Resultados de búsqueda</h2>
      {busy ? (
        <p role="status" className="search-results-status">Buscando…</p>
      ) : error ? (
        <div className="error search-results-status" role="alert">
          <p>No se pudo completar la búsqueda.</p>
          <p>{error}</p>
          <p>Revisá los datos y volvé a buscar.</p>
        </div>
      ) : groups.length === 0 ? (
        <p className="empty" role="status">No se encontraron coincidencias.</p>
      ) : (
        <>
          <p role="status" className="muted search-results-status">
            {groups.length} {groups.length === 1 ? "padrón encontrado" : "padrones encontrados"}
            {results && results.length > groups.length ? ` · ${results.length} coincidencias recibidas` : ""}.
          </p>
          {nameSearch && (results?.length ?? 0) > 1 && (
            <p className="notice">Una coincidencia de nombre puede corresponder a personas distintas. Cada padrón se abre por separado.</p>
          )}
          <div className="search-results-scroll" role="region" aria-label="Padrones encontrados" tabIndex={0}>
            <ul className="padron-list search-results-list">
              {groups.map((group) => {
                const parcel = group.records[0];
                return (
                  <li key={group.key}>
                    <button type="button" className="padron-card" onClick={() => void onOpen(parcel)}>
                      <span className="search-result-content">
                        <span className="search-result-title">
                          <span className="search-result-label">Padrón</span>{" "}
                          <span className="search-result-value">{parcel.parcel}</span>
                        </span>
                        <span className="search-result-details">
                          <span>
                            <span className="search-result-label">Localidad</span>
                            <span className="search-result-value">{parcel.locality}</span>
                          </span>
                          <span>
                            <span className="search-result-label">Domicilio del inmueble</span>
                            {group.addresses.length ? group.addresses.map((address) => (
                              <span className="search-result-value" key={address}>{address}</span>
                            )) : <span className="search-result-value">No informado</span>}
                          </span>
                        </span>
                        {group.records.length > 1 && <span className="muted">{group.records.length} coincidencias para este padrón</span>}
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
