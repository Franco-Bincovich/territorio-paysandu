"use client";
import "./consultation-form.css";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { DESCRIPTION_MIN_LENGTH, DESCRIPTION_MAX_LENGTH, MAX_CONTACT_ENTRIES } from "@backend/domain";
import { useRequestScope } from "./use-request-scope";
import { OptionalDomicileSection } from "./optional-domicile-section";
import { isAbort } from "./request-scope";
import { request, type Consultation, type ParcelRef } from "./contracts";
import {
  fieldLabel,
  validateConsultationFields,
  type FieldErrors,
} from "./consultation-validation";
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
  const [phones, setPhones] = useState(
      initial?.person.phones.length ? initial.person.phones : [""],
    ),
    [emails, setEmails] = useState(
      initial?.person.emails.length ? initial.person.emails : [""],
    );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [fieldErrors, setFieldErrors] = useState<FieldErrors>({}),
    [validationAttempt, setValidationAttempt] = useState(0);
  const requestId = useRef<string | null>(null),
    summary = useRef<HTMLElement | null>(null);
  const idPrefix = useId();
  const [documentType, setDocumentType] = useState(initial?.person.documentType ?? "CI");
  const [phoneTypes, setPhoneTypes] = useState<string[]>(
    initial?.person.phones.length
      ? initial.person.phones.map((_, index) => initial.person.phoneTypes?.[index] ?? "")
      : [""],
  );
  const requests = useRequestScope();
  useEffect(() => {
    if (validationAttempt > 0) summary.current?.focus();
  }, [validationAttempt]);
  function clearContactErrors(kind: "phone" | "email") {
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${kind}-`)),
      ),
    );
  }
  const attrs = (key: string) => ({
    id: `${idPrefix}-${key}`,
    "aria-invalid": Boolean(fieldErrors[key]),
    "aria-describedby": fieldErrors[key]
      ? `${idPrefix}-${key}-error`
      : undefined,
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly || busy) return;
    const form = new FormData(e.currentTarget);
    setError("");
    setNotice("");
    const draft = {
      name: String(form.get("name") ?? ""),
      relationship: String(form.get("relationship") ?? ""),
      documentType: String(form.get("documentType") ?? ""),
      document: String(form.get("document") ?? ""),
      type: String(form.get("type") ?? ""),
      description: String(form.get("description") ?? ""),
      phones,
      phoneTypes,
      emails,
    };
    const errors = validateConsultationFields(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setValidationAttempt((n) => n + 1);
      return;
    }
    const operation = requests.begin();
    setBusy(true);
    requestId.current ??= crypto.randomUUID();
    const input = {
      locality: parcel.locality,
      parcel: parcel.parcel,
      type: draft.type,
      description: draft.description,
      person: {
        name: draft.name,
        documentType: draft.documentType,
        document: draft.document,
        relationship: draft.relationship,
        phones: phones.map((s) => s.trim()).filter(Boolean),
        phoneTypes: phoneTypes.filter((_, index) => phones[index]?.trim()),
        emails: emails.filter((s) => s.length > 0),
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
        {
          method: initial ? "PATCH" : "POST",
          body: JSON.stringify(input),
          signal: operation.signal,
        },
      );
      if (!operation.isCurrent()) return;
      setNotice("Consulta guardada correctamente.");
      requestId.current = null;
      await onSaved(saved);
    } catch (e) {
      if (operation.isCurrent() && !isAbort(e)) {
        setError(e instanceof Error ? e.message : "No se pudo guardar.");
        setValidationAttempt((n) => n + 1);
      }
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }
  return (
    <form className="form-stack consultation-form" onSubmit={submit} noValidate>
      {(Object.keys(fieldErrors).length > 0 || error) && (
        <section
          className="error"
          ref={summary}
          tabIndex={-1}
          aria-labelledby={`${idPrefix}-summary-title`}
        >
          <h2 id={`${idPrefix}-summary-title`}>Revisá la consulta</h2>
          {error && <p role="alert">{error}</p>}
          {Object.keys(fieldErrors).length > 0 && (
            <>
              <p>Corregí los siguientes campos antes de guardar:</p>
              <ul>
                {Object.entries(fieldErrors).map(([key, text]) => (
                  <li key={key}>
                    <a
                      href={`#${idPrefix}-${key}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`${idPrefix}-${key}`)?.focus();
                      }}
                    >
                      {fieldLabel(key)}: {text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <fieldset disabled={readOnly || busy}>
        <legend>Persona que realiza la consulta</legend>
        <div className="pair">
          <Field fieldKey="name" idPrefix={idPrefix} errors={fieldErrors}>
            <input
              {...attrs("name")}
              name="name"
              defaultValue={initial?.person.name}
              required
              maxLength={200}
            />
          </Field>
          <Field
            fieldKey="relationship"
            idPrefix={idPrefix}
            errors={fieldErrors}
          >
            <input
              {...attrs("relationship")}
              name="relationship"
              defaultValue={initial?.person.relationship}
              required
              maxLength={100}
              placeholder="Titular, familiar, representante…"
            />
          </Field>
        </div>
        <div className="pair">
          <Field
            fieldKey="documentType"
            idPrefix={idPrefix}
            errors={fieldErrors}
          >
            <select
              {...attrs("documentType")}
              name="documentType"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value as typeof documentType)}
            >
              <option value="CI">Cédula de identidad</option>
              <option value="RUT">RUT</option>
              <option value="Otros">Otros</option>
            </select>
          </Field>
          <Field fieldKey="document" idPrefix={idPrefix} errors={fieldErrors}>
            <input
              {...attrs("document")}
              name="document"
              defaultValue={initial?.person.document}
              required
              maxLength={30}
              inputMode={documentType === "Otros" ? "text" : "numeric"}
            />
          </Field>
        </div>
        <ContactFields
          kind="phone"
          phoneTypes={phoneTypes}
          setPhoneTypes={setPhoneTypes}
          type="tel"
          values={phones}
          setValues={(values) => {
            setPhones(values);
            clearContactErrors("phone");
          }}
          readOnly={readOnly}
          errors={fieldErrors}
          idPrefix={idPrefix}
        />
        <ContactFields
          kind="email"
          type="email"
          values={emails}
          setValues={(values) => {
            setEmails(values);
            clearContactErrors("email");
          }}
          readOnly={readOnly}
          errors={fieldErrors}
          idPrefix={idPrefix}
        />
        <OptionalDomicileSection />
      </fieldset>
      <fieldset disabled={readOnly || busy}>
        <legend>Datos de la consulta</legend>
        <Field fieldKey="type" idPrefix={idPrefix} errors={fieldErrors}>
          <select
            {...attrs("type")}
            name="type"
            defaultValue={initial?.type ?? "General"}
          >
            <option>General</option>
            <option>Reclamo</option>
            <option>Falta de documentación</option>
            <option>Declaracion voluntaria de metros</option>
          </select>
        </Field>
        <Field fieldKey="description" idPrefix={idPrefix} errors={fieldErrors}>
          <textarea
            {...attrs("description")}
            name="description"
            defaultValue={initial?.description}
            required
            minLength={DESCRIPTION_MIN_LENGTH}
            data-max-codepoints={DESCRIPTION_MAX_LENGTH}
            aria-describedby={[
              `${idPrefix}-description-hint`,
              fieldErrors.description ? `${idPrefix}-description-error` : null,
            ]
              .filter(Boolean)
              .join(" ")}
            rows={6}
          />
          <p id={`${idPrefix}-description-hint`} className="muted">
            Entre {DESCRIPTION_MIN_LENGTH} y{" "}
            {DESCRIPTION_MAX_LENGTH.toLocaleString("es-UY")} caracteres, sin
            contar espacios al principio y al final.
          </p>
        </Field>
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
function Field({
  fieldKey,
  idPrefix,
  errors,
  children,
}: {
  fieldKey: string;
  idPrefix: string;
  errors: FieldErrors;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={`${idPrefix}-${fieldKey}`}>{fieldLabel(fieldKey)}</label>
      {children}
      {errors[fieldKey] && (
        <span className="field-error" id={`${idPrefix}-${fieldKey}-error`}>
          {errors[fieldKey]}
        </span>
      )}
    </div>
  );
}
function ContactFields({
  kind,
  type,
  values,
  setValues,
  readOnly,
  errors,
  idPrefix,
  phoneTypes,
  setPhoneTypes,
}: {
  kind: "phone" | "email";
  type: string;
  values: string[];
  setValues: (v: string[]) => void;
  phoneTypes?: string[];
  setPhoneTypes?: (values: string[]) => void;
  readOnly: boolean;
  errors: FieldErrors;
  idPrefix: string;
}) {
  const label = kind === "phone" ? "teléfono" : "correo electrónico";
  return (
    <div className="form-stack">
      <p className="muted">Ingresá entre 1 y {MAX_CONTACT_ENTRIES} {kind === "phone" ? "teléfonos" : "correos electrónicos"}.</p>
      {values.map((value, index) => {
        const key = `${kind}-${index}`;
        return (
          <div className="repeat-field" key={index}>
            <Field fieldKey={key} idPrefix={idPrefix} errors={errors}>
              <input
                id={`${idPrefix}-${key}`}
                type={type}
                value={value}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={
                  errors[key] ? `${idPrefix}-${key}-error` : undefined
                }
                maxLength={kind === "email" ? 254 : 40}
                onChange={(e) =>
                  setValues(
                    values.map((v, i) => (i === index ? e.target.value : v)),
                  )
                }
              />
            </Field>
            {kind === "phone" && (
              <Field fieldKey={`phone-type-${index}`} idPrefix={idPrefix} errors={errors}>
                <select id={`${idPrefix}-phone-type-${index}`} required
                  value={phoneTypes?.[index] ?? ""}
                  aria-invalid={Boolean(errors[`phone-type-${index}`])}
                  aria-describedby={errors[`phone-type-${index}`] ? `${idPrefix}-phone-type-${index}-error` : undefined}
                  onChange={(event) => setPhoneTypes?.(values.map((_, i) => i === index ? event.target.value : phoneTypes?.[i] ?? ""))}>
                  <option value="">Seleccioná el tipo</option>
                  <option value="Fijo">Fijo</option>
                  <option value="Celular">Celular</option>
                </select>
              </Field>
            )}
            {!readOnly && values.length > 1 && (
              <button
                className="btn small"
                type="button"
                aria-label={`Quitar ${label} ${index + 1} del formulario`}
                onClick={() => {
                  setValues(values.filter((_, i) => i !== index));
                  if (kind === "phone") setPhoneTypes?.((phoneTypes ?? []).filter((_, i) => i !== index));
                }}
              >
                Quitar
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <button
          type="button"
          className="link"
          disabled={values.length >= MAX_CONTACT_ENTRIES}
          onClick={() => {
            if (values.length < MAX_CONTACT_ENTRIES) {
              setValues([...values, ""]);
              if (kind === "phone") setPhoneTypes?.([...(phoneTypes ?? []), ""]);
            }
          }}
        >
          + Agregar {label}
        </button>
      )}
    </div>
  );
}
