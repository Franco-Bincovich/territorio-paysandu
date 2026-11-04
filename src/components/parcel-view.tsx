"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { HistoryView, type HistoryReturnState } from "./territory-app";
import type { Parcel, ParcelImage } from "./contracts";
export function ParcelView({
  parcel,
  onCreate,
  onDetail,
  onBack,
  initialTab = "record",
  onTabChange,
  historyReturnState,
  onHistoryRemember,
  onHistoryRestored,
}: {
  parcel: Parcel;
  onCreate: () => void;
  onDetail: (id: string) => Promise<void>;
  onBack: () => void;
  initialTab?: "record" | "consultations";
  onTabChange?: (tab: "record" | "consultations") => void;
  historyReturnState?: HistoryReturnState | null;
  onHistoryRemember?: (state: HistoryReturnState) => void;
  onHistoryRestored?: () => void;
}) {
  const [tab, setTab] = useState<"record" | "consultations">(initialTab);
  return (
    <>
      <button className="back" onClick={onBack}>
        ← Volver a la búsqueda
      </button>
      <div className="record-heading">
        <div>
          <p className="eyebrow">Ficha territorial</p>
          <h1>Padrón {parcel.parcel}</h1>
          <p className="muted">
            {parcel.locality} · {parcel.address}
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onCreate}>
            + Registrar consulta
          </button>
        </div>
      </div>
      <div className="tabs" aria-label="Secciones de la ficha">
        <button
          id="tab-record"
          aria-controls="panel-record"
          aria-pressed={tab === "record"}
          className={tab === "record" ? "active" : ""}
          onClick={() => {
            setTab("record");
            onTabChange?.("record");
          }}
        >
          Datos del padrón
        </button>
        <button
          id="tab-consultations"
          aria-controls="panel-consultations"
          aria-pressed={tab === "consultations"}
          className={tab === "consultations" ? "active" : ""}
          onClick={() => {
            setTab("consultations");
            onTabChange?.("consultations");
          }}
        >
          Consultas
        </button>
      </div>
      {tab === "record" ? (
        <div
          id="panel-record"
          role="region"
          aria-labelledby="tab-record"
          className="record-layout"
        >
          <section className="panel">
            <div className="panel-head">
              <h2>Información catastral</h2>
              <span className="badge">Solo lectura</span>
            </div>
            {parcel.provenance && <p className="notice">{parcel.provenance}</p>}
            <dl className="data-grid">
              <div>
                <dt>Localidad</dt>
                <dd>{parcel.locality}</dd>
              </div>
              <div>
                <dt>Padrón</dt>
                <dd>{parcel.parcel}</dd>
              </div>
              <div>
                <dt>Domicilio</dt>
                <dd>{parcel.address}</dd>
              </div>
              {Object.entries(parcel.fields ?? {}).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="surface-grid">
              <Surface
                label="Superficie de terreno"
                value={parcel.originalLandArea}
                source={
                  parcel.provenance
                    ? "Prototipo · No verificado"
                    : "Original · Catastro"
                }
              />
              <Surface
                label="Superficie construida"
                value={parcel.originalBuiltArea}
                source={
                  parcel.provenance
                    ? "Prototipo · No verificado"
                    : "Original · Catastro"
                }
              />
              <Surface
                label="Superficie detectada"
                value={parcel.detectedBuiltArea}
                source={
                  parcel.provenance
                    ? "Prototipo · No verificado"
                    : "Relevamiento"
                }
              />
            </div>
          </section>
          <div className="record-images">
            <ImageViewer images={parcel.images} />
          </div>
          <section className="panel">
            <div className="panel-head">
              <h2>Contactos del padrón</h2>
              <span className="badge">{parcel.contacts.length} contactos</span>
            </div>
            {parcel.contacts.length === 0 ? (
              <p className="empty">No hay contactos disponibles.</p>
            ) : (
              <div className="contact-list">
                {[...parcel.contacts]
                  .sort(
                    (a, b) =>
                      Number(b.relationship.toLowerCase() === "titular") -
                      Number(a.relationship.toLowerCase() === "titular"),
                  )
                  .map((c) => (
                    <details className="contact" key={c.id}>
                      <summary>{c.name}</summary>
                      <p>
                        <span className="badge">{c.relationship}</span>
                      </p>
                      <dl>
                        <dt>Teléfonos</dt>
                        <dd>
                          {c.phones.length
                            ? c.phones.map((p, i) => <p key={i}>{p}</p>)
                            : "Sin informar"}
                        </dd>
                        <dt>Correos electrónicos</dt>
                        <dd>
                          {c.emails.length
                            ? c.emails.map((p, i) => <p key={i}>{p}</p>)
                            : "Sin informar"}
                        </dd>
                      </dl>
                    </details>
                  ))}
              </div>
            )}
            <p className="muted">
              Los contactos se agregan al registrar una nueva consulta.
            </p>
          </section>
        </div>
      ) : (
        <div
          id="panel-consultations"
          role="region"
          aria-labelledby="tab-consultations"
        >
          <HistoryView
            parcel={parcel}
            onDetail={onDetail}
            returnState={historyReturnState}
            onRemember={onHistoryRemember}
            onRestored={onHistoryRestored}
          />
        </div>
      )}
    </>
  );
}
function Surface({
  label,
  value,
  source,
}: {
  label: string;
  value?: number | null;
  source: string;
}) {
  return (
    <div className="surface">
      <small>{label}</small>
      <strong>
        {value == null
          ? "No disponible"
          : `${value.toLocaleString("es-UY")} m²`}
      </strong>
      <span className="meta">{source}</span>
    </div>
  );
}
function trapViewerFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
  const first = controls[0],
    last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog)
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === dialog)
  ) {
    event.preventDefault();
    first.focus();
  }
}
function ImageViewer({ images }: { images: ParcelImage[] }) {
  const [index, setIndex] = useState(0),
    [zoom, setZoom] = useState(1),
    [failed, setFailed] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const slots = (["historical", "survey"] as const).map(
    (kind) =>
      images.find((i) => i.kind === kind) ?? {
        kind,
        source: kind === "historical" ? "Google Earth" : "Relevamiento",
        unavailableReason: "Imagen no disponible.",
      },
  );
  const image = slots[index];
  const title = index === 0 ? "Imagen histórica" : "Imagen de relevamiento";
  function next() {
    setIndex((i) => 1 - i);
    setZoom(1);
  }
  const available = Boolean(image.url) && failed !== image.url;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Imágenes del padrón</h2>
        <span className="badge">{index + 1} de 2</span>
      </div>
      <div className="image-preview">
        {available ? (
          <img
            src={image.url ?? undefined}
            alt={title}
            onError={() => setFailed(image.url ?? "")}
          />
        ) : (
          <div className="empty">
            <h3>{title}</h3>
            <p>
              {image.unavailableReason ??
                "La imagen no está disponible en este momento."}
            </p>
          </div>
        )}
      </div>
      <div className="viewer-tools">
        <button
          className="btn small"
          onClick={next}
          aria-label="Ver otra imagen"
        >
          ← Anterior
        </button>
        <strong>{title}</strong>
        <button className="btn small" onClick={next}>
          Siguiente →
        </button>
      </div>
      <p className="meta">Fuente: {image.source}</p>
      {image.kind === "survey" &&
      Object.keys(image.metadata ?? {}).length > 0 ? (
        <dl className="data-grid">
          {Object.entries(image.metadata ?? {}).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="meta">Sin información de metadatos</p>
      )}
      <button
        className="btn"
        ref={opener}
        disabled={!available}
        onClick={() => {
          setZoom(1);
          dialog.current?.showModal();
        }}
      >
        Ampliar imagen
      </button>
      <dialog
        ref={dialog}
        className="viewer-dialog"
        onClose={() => {
          if (opener.current && !opener.current.disabled)
            opener.current.focus();
          else document.getElementById("main")?.focus();
        }}
        aria-label="Visualizador de imágenes"
        onKeyDown={trapViewerFocus}
      >
        <header className="panel-head">
          <h2>{title}</h2>
          <button className="btn small" onClick={() => dialog.current?.close()}>
            Cerrar
          </button>
        </header>
        <div
          className="viewer-stage"
          tabIndex={0}
          role="region"
          aria-label="Imagen ampliada; usá las flechas para desplazar"
        >
          {available ? (
            <img
              src={image.url ?? undefined}
              alt={title}
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              onError={() => setFailed(image.url ?? "")}
            />
          ) : (
            <p>Imagen no disponible.</p>
          )}
        </div>
        <div className="viewer-tools">
          <button className="btn" onClick={next}>
            Cambiar imagen
          </button>
          <button
            className="btn"
            onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            disabled={zoom <= 1}
            aria-label="Alejar"
          >
            −
          </button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            className="btn"
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            disabled={zoom >= 3}
            aria-label="Acercar"
          >
            +
          </button>
          <button className="btn" onClick={() => setZoom(1)}>
            Restablecer
          </button>
        </div>
      </dialog>
    </section>
  );
}
