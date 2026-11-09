"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { HistoryView, type HistoryReturnState } from "./territory-app";
import type { Parcel, ParcelImage } from "./contracts";
import { InstitutionalPeople } from "./institutional-people";
import { useSftpCatalogue,useSftpMedia } from './use-sftp-images';
export type ParcelTab = "record" | "images" | "contacts" | "consultations";
const parcelTabs: { key: ParcelTab; label: string }[] = [
  { key: "record", label: "Datos catastrales" },
  { key: "images", label: "Imágenes" },
  { key: "contacts", label: "Contactos" },
  { key: "consultations", label: "Consultas" },
];
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
  initialTab?: ParcelTab;
  onTabChange?: (tab: ParcelTab) => void;
  historyReturnState?: HistoryReturnState | null;
  onHistoryRemember?: (state: HistoryReturnState) => void;
  onHistoryRestored?: () => void;
}) {
  const [tab, setTab] = useState<ParcelTab>(initialTab);
  const recordContact = Object.entries(parcel.fields ?? {}).filter(([label]) =>
    /^(Titular|Documento|Teléfono|Correo|Vínculo)/.test(label),
  );
  const hasRecordContact = recordContact.some(([label]) => /^(Titular|Teléfono|Correo)/.test(label));
  const recordName = recordContact.find(([label]) => /^Titular/.test(label))?.[1] ?? "Contacto del expediente";
  const recordRelationship = recordContact.find(([label]) => /^Vínculo/.test(label))?.[1] ?? "Vínculo sin informar";
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
          <button className="btn primary" onClick={onCreate} disabled={parcel.readOnly}>
            + Registrar consulta
          </button>
          {parcel.readOnly && <p className="muted">El registro de consultas todavía no está habilitado.</p>}
        </div>
      </div>
      <div className="parcel-detail-grid">
        <section className="panel record-main">
          <div
            className="tabs"
            role="tablist"
            aria-label="Secciones del padrón"
          >
            {parcelTabs.map(({ key, label }, index) => (
              <button
                key={key}
                role="tab"
                id={`tab-${key}`}
                aria-controls={`panel-${key}`}
                aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1}
                className={tab === key ? "active" : ""}
                onClick={() => {
                  setTab(key);
                  onTabChange?.(key);
                }}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % parcelTabs.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + parcelTabs.length - 1) % parcelTabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = parcelTabs.length - 1;
                  else return;
                  event.preventDefault();
                  const selected = parcelTabs[next].key;
                  setTab(selected);
                  onTabChange?.(selected);
                  document.getElementById(`tab-${selected}`)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="tabbody"
            tabIndex={0}
          >
            {tab === "record" && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Información catastral</h2>
                  <span className="badge">Solo lectura</span>
                </div>
                {parcel.provenance && (
                  <p className="notice">{parcel.provenance}</p>
                )}
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
                  {(parcel.source === "institutional" ? [] : [
                    {
                      label: "Superficie de terreno",
                      original: "Terreno (texto original)",
                      value: parcel.originalLandArea,
                    },
                    {
                      label: "Superficie construida",
                      original: "Construida (texto original)",
                      value: parcel.originalBuiltArea,
                    },
                    {
                      label: "Superficie detectada",
                      original: "Detectada (texto original)",
                      value: parcel.detectedBuiltArea,
                    },
                  ])
                    .filter(
                      ({ original }) => !(original in (parcel.fields ?? {})),
                    )
                    .map(({ label, value }) => (
                      <div key={label}>
                        <dt>{label.replace(/ \(prototipo\)$/i, "")}</dt>
                        <dd>
                          {value == null
                            ? "No disponible"
                            : `${value.toLocaleString("es-UY")} m²`}
                        </dd>
                      </div>
                    ))}
                  {Object.entries(parcel.fields ?? {})
                    .filter(
                      ([label]) => !/^(Teléfono|Correo|Vínculo)/.test(label),
                    )
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{label.replace(/ \(prototipo\)$/i, "")}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            )}
            {tab === "images" && <ImageViewer images={parcel.images} padCod={parcel.padCod} />}
            {tab === "contacts" && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Contactos del padrón</h2>
                  <span className="badge">
                    {parcel.institutionalPeople?.length ?? parcel.contacts.length + Number(hasRecordContact)} contactos
                  </span>
                </div>
                {parcel.institutionalPeople && <InstitutionalPeople people={parcel.institutionalPeople} />}
                {hasRecordContact && (
                  <details className="contact record-contact">
                    <summary>
                      <span className="contact-name">{recordName}</span>
                      {recordContact.some(([label]) => /ficticio/i.test(label)) && (
                        <span className="badge">Datos ficticios</span>
                      )}
                      <span className="badge">{recordRelationship}</span>
                    </summary>
                    <dl className="data-grid">
                      {recordContact.filter(([label]) => !/^Vínculo/.test(label)).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label.replace(/ \(prototipo\)$/i, "")}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {parcel.provenance && <p className="meta">{parcel.provenance}</p>}
                  </details>
                )}
                {!parcel.institutionalPeople && (parcel.contacts.length === 0 && !hasRecordContact ? (
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
                          <summary>
                            <span className="contact-name">{c.name}</span>
                            <span className="badge">{c.relationship}</span>
                          </summary>
                          <dl>
                            <dt>Teléfonos</dt>
                            <dd>
                              {c.phones.length
                                ? c.phones.map((p, i) => (
                                    <p key={i}>{p} <span className="muted">· {c.phoneTypes?.[i] ?? "Sin clasificar"}</span></p>
                                  ))
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
                ))}
                <p className="muted">
                  {parcel.source === "institutional" ? "Estos contactos provienen de la fuente institucional y no se editan desde esta aplicación." : "Los contactos se agregan al registrar una nueva consulta."}
                </p>
              </section>
            )}
            {tab === "consultations" && (
              <div>
                {parcel.readOnly && !parcel.consultationsRead ? <p className="notice">El historial de la base propia todavía no está conectado a esta ficha institucional.</p> : <HistoryView
                  parcel={parcel}
                  onDetail={onDetail}
                  returnState={historyReturnState}
                  onRemember={onHistoryRemember}
                  onRestored={onHistoryRestored}
                />}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
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
export function ImageViewer({ images:initialImages,padCod }: { images: ParcelImage[];padCod?:string }) {
  const [index, setIndex] = useState(0),
    [zoom, setZoom] = useState(1),
    [failed, setFailed] = useState(""),
    [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const images=useSftpCatalogue(initialImages,padCod,retry);
  function resetView() {
    setZoom(1);
    stage.current?.scrollTo(0, 0);
  }
  const slots = (["historical", "survey"] as const).map(
    (kind) =>
      images.find((i) => i.kind === kind) ?? {
        kind,
        source: kind === "historical" ? "Google Earth" : "Relevamiento",
        unavailableReason: kind==='survey'?"Este padrón aún no registra imágenes de relevamiento":"Este padrón aún no registra imágenes históricas",
      },
  );
  const image = slots[index];
  const media=useSftpMedia(image,retry);
  const mediaUrl=image.provider==='sftp'?media.url:image.url;
  const title = index === 0 ? "Imagen histórica" : "Imagen de relevamiento";
  function next() {
    setIndex((i) => 1 - i);
    resetView();
  }
  const available = Boolean(mediaUrl) && failed !== image.url;
  const pdf=media.type==='application/pdf';
  const unavailable=media.error??(image.provider==='sftp'&&image.url&&!failed?'Cargando imagen…':image.unavailableReason??"La imagen no está disponible en este momento.");
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Imágenes del padrón</h2>
        <span className="badge">{index + 1} de 2</span>
      </div>
      <div className="image-preview">
        {available && pdf ? <iframe title={title} src={mediaUrl+'#toolbar=0'} sandbox="" style={{width:'100%',height:'100%',border:0}}/> : available ? (
          <img
            key={`${image.url}-${retry}`}
            src={mediaUrl ?? undefined}
            alt={title}
            onError={() => setFailed(image.url ?? "")}
          />
        ) : (
          <div className="empty">
            <h3>{title}</h3>
            <p>
              {unavailable}
            </p>
            {(image.url||image.provider==='sftp') && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setFailed("");
                  setRetry((value) => value + 1);
                }}
              >
                Reintentar imagen
              </button>
            )}
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
          dialog.current?.showModal();
          resetView();
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
          ref={stage}
          className="viewer-stage"
          tabIndex={0}
          role="region"
          aria-label="Imagen ampliada; usá las flechas para desplazar"
        >
          {available && pdf ? <iframe title={title} src={mediaUrl+'#toolbar=0'} sandbox="" style={{width:'100%',height:'100%',minHeight:'50vh',border:0}}/> : available ? (
            <div className="viewer-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img
                key={`${image.url}-${retry}`}
                src={mediaUrl ?? undefined}
                alt={title}
                onError={() => setFailed(image.url ?? "")}
              />
            </div>
          ) : (
            <p>{unavailable}</p>
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
          <button className="btn" onClick={resetView}>
            Restablecer
          </button>
        </div>
      </dialog>
    </section>
  );
}
