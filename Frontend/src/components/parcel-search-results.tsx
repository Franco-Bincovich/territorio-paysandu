"use client";
import { useId, useMemo } from "react";
import type { ParcelRef, PersonCandidate } from "./contracts";
import { groupParcelResults } from "./parcel-result-groups";
import "./package-4-visual.css";

export function ParcelSearchResults({ results, busy, error, nameSearch, onOpen, people = [],
  requiresDisambiguation = false, unidentifiedMatches = 0, onChoosePerson }: {
  results: readonly ParcelRef[] | null;
  busy: boolean;
  error: string;
  nameSearch: boolean;
  onOpen: (parcel: ParcelRef) => Promise<void>;
  people?: readonly PersonCandidate[];
  requiresDisambiguation?: boolean;
  unidentifiedMatches?: number;
  onChoosePerson?: (personId: string) => Promise<void>;
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
      ) : requiresDisambiguation ? (
        <>
          <p className="notice" role="status">Hay varias personas con coincidencia exacta. Seleccioná una antes de mostrar sus padrones.</p>
          <ul className="padron-list">
            {people.map(person => <li key={person.personId}>
              <button type="button" className="padron-card" onClick={() => void onChoosePerson?.(person.personId)}>
                <span className="search-result-content"><strong>{person.name}</strong>
                  <span>{person.documentType ?? "Tipo no informado"}: {person.document ?? "Documento no informado"}</span>
                  <span>{person.parcelCount} padrones vinculados</span>
                </span><span className="search-result-open" aria-hidden="true">→</span>
              </button>
            </li>)}
          </ul>
        </>
      ) : groups.length === 0 ? (
        <p className="empty" role="status">No se encontraron coincidencias.</p>
      ) : (
        <>
          <p role="status" className="muted search-results-status">
            {groups.length} {groups.length === 1 ? "padrón encontrado" : "padrones encontrados"}
            {results && results.length > groups.length ? ` · ${results.length} coincidencias recibidas` : ""}.
          </p>
          {nameSearch && !people.length && (results?.length ?? 0) > 1 && (
            <p className="notice">Una coincidencia de nombre puede corresponder a personas distintas. Cada padrón se abre por separado.</p>
          )}
          <div className="search-results-scroll" role="region" aria-label="Padrones encontrados" tabIndex={0}>
            <ul className="padron-list search-results-list">
              {groups.map((group) => {
                const parcel = group.records[0];
                return (
                  <li key={group.key}>
                    <button type="button" className="padron-card" onClick={() => void onOpen(parcel)}>
                      <span className={`search-result-content${parcel.matchedPeople?.length?' has-people':''}`}>
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
                        {!!parcel.matchedPeople?.length && <span className="search-result-people">{parcel.matchedPeople.map((person, index) => (
                          <span className="search-result-details" key={`${person.personId ?? "unresolved"}-${index}`}>
                            <span>{person.name}</span>
                            {person.document && <span>{person.documentType ?? "Tipo sin informar"}: {person.document}</span>}
                            {person.links?.map((link, i) => <span key={`${link.conCod}-${i}`}>Vínculo: {link.relationship}</span>)}
                          </span>
                        ))}</span>}
                      </span>
                      <span className="search-result-open" aria-hidden="true">→</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      {!busy && !error && unidentifiedMatches > 0 && <p className="notice">Hay vínculos sin identificador de persona. No se atribuyen a otra persona por nombre o documento.</p>}
    </section>
  );
}
