"use client";
import { useRef, useState, type FormEvent } from "react";
import { request, type Consultation, type ParcelRef } from "./contracts";
export function ConsultationForm({
  parcel,
  initial,
  readOnly = false,
  onSaved,
}: {
  parcel: ParcelRef;
  initial?: Consultation;
  readOnly?: boolean;
  onSaved: (c: Consultation) => void | Promise<void>;
}) {
  const [phones, setPhones] = useState(initial?.person.phones ?? [""]),
    [emails, setEmails] = useState(initial?.person.emails ?? [""]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const form = new FormData(e.currentTarget);
    setError("");
    setNotice("");
    setBusy(true);
    requestId.current ??= crypto.randomUUID();
    const input = {
      locality: parcel.locality,
      parcel: parcel.parcel,
      type: form.get("type"),
      description: form.get("description"),
      person: {
        name: form.get("name"),
        documentType: form.get("documentType"),
        document: form.get("document"),
        relationship: form.get("relationship"),
        phones: phones.map((s) => s.trim()).filter(Boolean),
        emails: emails.map((s) => s.trim()).filter(Boolean),
      },
      ...(initial
        ? { version: initial.version }
        : { idempotencyKey: requestId.current }),
    };
    try {
      const saved = await request<Consultation>(
        initial
          ? `/api/consultations/${encodeURIComponent(initial.id)}`
          : "/api/consultations",
        { method: initial ? "PATCH" : "POST", body: JSON.stringify(input) },
      );
      setNotice("Consulta guardada correctamente.");
      requestId.current = null;
      await onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack consultation-form" onSubmit={submit}>
      <fieldset disabled={readOnly || busy}>
        <legend>Persona que realiza la consulta</legend>
        <div className="pair">
          <label className="field">
            Nombre completo
            <input
              name="name"
              defaultValue={initial?.person.name}
              required
              maxLength={200}
            />
          </label>
          <label className="field">
            Vínculo con el padrón
            <input
              name="relationship"
              defaultValue={initial?.person.relationship}
              required
              maxLength={100}
              placeholder="Titular, familiar, representante…"
            />
          </label>
        </div>
        <div className="pair">
          <label className="field">
            Tipo de documento
            <select
              name="documentType"
              defaultValue={initial?.person.documentType ?? "CI"}
            >
              <option value="CI">Cédula de identidad</option>
              <option value="RUT">RUT</option>
            </select>
          </label>
          <label className="field">
            Documento
            <input
              name="document"
              defaultValue={initial?.person.document}
              required
              maxLength={30}
              inputMode="numeric"
            />
          </label>
        </div>
        <ContactFields
          label="Teléfono"
          type="tel"
          values={phones}
          setValues={setPhones}
          readOnly={readOnly}
        />
        <ContactFields
          label="Correo electrónico"
          type="email"
          values={emails}
          setValues={setEmails}
          readOnly={readOnly}
        />
      </fieldset>
      <fieldset disabled={readOnly || busy}>
        <legend>Datos de la consulta</legend>
        <label className="field">
          Tipo
          <select name="type" defaultValue={initial?.type ?? "General"}>
            <option>General</option>
            <option>Reclamo</option>
            <option>Falta de documentación</option>
          </select>
        </label>
        <label className="field">
          Descripción
          <textarea
            name="description"
            defaultValue={initial?.description}
            required
            minLength={1}
            maxLength={5000}
            rows={6}
          />
        </label>
      </fieldset>
      {!initial && (
        <p className="notice">
          Al registrar se conserva una copia histórica de los datos y se agrega
          un contacto nuevo al padrón. Los contactos existentes se conservan.
        </p>
      )}
      {readOnly && (
        <p className="notice">
          Solo el colaborador que creó esta consulta puede editarla.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!readOnly && (
        <button className="btn primary" disabled={busy}>
          {busy
            ? "Guardando…"
            : initial
              ? "Guardar corrección"
              : "Registrar consulta"}
        </button>
      )}
    </form>
  );
}
function ContactFields({
  label,
  type,
  values,
  setValues,
  readOnly,
}: {
  label: string;
  type: string;
  values: string[];
  setValues: (v: string[]) => void;
  readOnly: boolean;
}) {
  return (
    <div className="form-stack">
      {values.map((value, index) => (
        <div className="repeat-field" key={index}>
          <label className="field">
            {label} {index + 1}
            <input
              type={type}
              value={value}
              required={index === 0}
              maxLength={type === "email" ? 254 : 40}
              onChange={(e) =>
                setValues(
                  values.map((v, i) => (i === index ? e.target.value : v)),
                )
              }
            />
          </label>
          {!readOnly && index > 0 && (
            <button
              className="btn small"
              type="button"
              aria-label={`Quitar ${label.toLowerCase()} ${index + 1} del formulario`}
              onClick={() => setValues(values.filter((_, i) => i !== index))}
            >
              Quitar
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="link"
          onClick={() => setValues([...values, ""])}
        >
          + Agregar {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
