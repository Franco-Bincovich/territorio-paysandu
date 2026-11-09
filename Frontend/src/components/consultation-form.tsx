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
  const submitting = useRef(false);
  const sentPayload = useRef('');
  const [writeAvailable,setWriteAvailable] = useState(!parcel.padCod);
  const [formValid,setFormValid] = useState(Boolean(initial));
  const maxContacts=parcel.padCod?5:MAX_CONTACT_ENTRIES;
  useEffect(() => {
    if (!parcel.padCod) return;
    const controller=new AbortController();
    request<{write:boolean}>('/api/consultations/capabilities',{signal:controller.signal})
      .then(c=>{if(!controller.signal.aborted)setWriteAvailable(c.write);})
      .catch(()=>{if(!controller.signal.aborted)setWriteAvailable(false);});
    return ()=>controller.abort();
  },[parcel.padCod]);
  const blocked=readOnly || !writeAvailable;
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
    if (blocked || submitting.current) return;
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
    const errors = validateConsultationFields(draft,maxContacts);
    if(parcel.padCod) phones.forEach((p,i)=>{if(p.trim().length>30)errors[`phone-${i}`]='Ingresá hasta 30 caracteres.';});
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setValidationAttempt((n) => n + 1);
      return;
    }
    const operation = requests.begin();
    submitting.current=true;
    setBusy(true);
    requestId.current ??= crypto.randomUUID();
    const input = {
      ...(parcel.padCod ? { padCod:parcel.padCod, address:Object.fromEntries(addressFields.map(([key])=>[key,String(form.get(`address-${key}`)??'').trim()]).filter(([,v])=>v)) } : {}),
      locality: parcel.locality,
      parcel: parcel.parcel,
      type: draft.type,
      description: draft.description,
      person: {
        ...(initial?.person.localPersonId ? {localPersonId:initial.person.localPersonId}:{}),
        name: draft.name,
        documentType: draft.documentType,
        document: draft.document,
        relationship: draft.relationship,
        phones: phones.map((s) => s.trim()).filter(Boolean),
        phoneTypes: phoneTypes.filter((_, index) => phones[index]?.trim()),
        emails: emails.filter((s) => s.length > 0),
      },
      version: initial?.version,
      idempotencyKey: initial ? undefined : requestId.current,
    };
    const fingerprint=JSON.stringify({...input,idempotencyKey:undefined});
    if(!initial && sentPayload.current && sentPayload.current!==fingerprint)input.idempotencyKey=crypto.randomUUID();
    if(!initial)requestId.current=input.idempotencyKey??null;
    sentPayload.current=fingerprint;
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
      setNotice(`Consulta ${saved.id} guardada correctamente.`);
      requestId.current = null;
      await onSaved(saved);
    } catch (e) {
      if (operation.isCurrent() && !isAbort(e)) {
        setError(e instanceof Error ? e.message : "No se pudo guardar.");
        setValidationAttempt((n) => n + 1);
      }
    } finally {
      submitting.current=false;
      if (operation.isCurrent()) setBusy(false);
    }
  }
  return (
    <form className="form-stack consultation-form" onSubmit={submit} noValidate onChange={event=>{
      const form=new FormData(event.currentTarget);
      const draft={name:String(form.get('name')??''),relationship:String(form.get('relationship')??''),documentType:String(form.get('documentType')??''),document:String(form.get('document')??''),type:String(form.get('type')??''),description:String(form.get('description')??''),phones:form.getAll('phone').map(String),phoneTypes:form.getAll('phoneType').map(String),emails:form.getAll('email').map(String)};
      setFormValid(!Object.keys(validateConsultationFields(draft,maxContacts)).length && (!parcel.padCod || draft.phones.every(p=>p.trim().length<=30)));
    }}>
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
      <fieldset disabled={blocked || busy}>
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
          maxEntries={maxContacts}
          phoneMaxLength={parcel.padCod?30:40}
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
          maxEntries={maxContacts}
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
        <OptionalDomicileSection>{parcel.padCod && <div className="pair">
          {addressFields.map(([key,label,max])=><label className="field" key={key}>{label}
            <input name={`address-${key}`} maxLength={max} defaultValue={initial?.address?.[key]??''}/>
          </label>)}
          <p className="muted">Domicilio de la persona; puede ser distinto al del inmueble.</p>
        </div>}</OptionalDomicileSection>
      </fieldset>
      <fieldset disabled={blocked || busy}>
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
          Al registrar se conserva una copia de los datos declarados. El vínculo declarado no confirma titularidad institucional.
        </p>
      )}
      {readOnly && (
        <p className="notice">
          Solo el colaborador que creó esta consulta puede editarla.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!writeAvailable && <p role="status" className="notice">El guardado de consultas no está habilitado o el modelo no está verificado.</p>}
      {!readOnly && (
        <button className="btn primary" disabled={busy || blocked || !formValid}>
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
const addressFields = [
  ['CALLE','Calle',250],['NUMERO','Número',50],['BARRIO','Barrio',250],['LOCALIDAD','Localidad',250],
  ['DEPARTAMENTO','Departamento',150],['CODIGO_POSTAL','Código postal',50],['PH','PH',50],['BLOCK','Block',50],
  ['DEPTO','Apartamento',50],['PUERTA','Puerta',50],['DOMICILIO_COMPLETO','Domicilio completo',1000],
  ['REFERENCIA','Referencia',150],['SECTOR','Sector',50],['MANZANA','Manzana',50],['LOTE','Lote',50],
] as const;
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
  maxEntries,
  phoneMaxLength=40,
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
  maxEntries:number;
  phoneMaxLength?:number;
}) {
  const label = kind === "phone" ? "teléfono" : "correo electrónico";
  return (
    <div className="form-stack">
      <p className="muted">Ingresá entre 1 y {maxEntries} {kind === "phone" ? "teléfonos" : "correos electrónicos"}.</p>
      {values.map((value, index) => {
        const key = `${kind}-${index}`;
        return (
          <div className="repeat-field" key={index}>
            <Field fieldKey={key} idPrefix={idPrefix} errors={errors}>
              <input
                name={kind}
                id={`${idPrefix}-${key}`}
                type={type}
                value={value}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={
                  errors[key] ? `${idPrefix}-${key}-error` : undefined
                }
                maxLength={kind === "email" ? 254 : phoneMaxLength}
                onChange={(e) =>
                  setValues(
                    values.map((v, i) => (i === index ? e.target.value : v)),
                  )
                }
              />
            </Field>
            {kind === "phone" && (
              <Field fieldKey={`phone-type-${index}`} idPrefix={idPrefix} errors={errors}>
                <select name="phoneType" id={`${idPrefix}-phone-type-${index}`} required
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
          disabled={values.length >= maxEntries}
          onClick={() => {
            if (values.length < maxEntries) {
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
