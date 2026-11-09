import type { InstitutionalPerson } from "@backend/domain/institutional";

export function InstitutionalPeople({ people }: { people: readonly InstitutionalPerson[] }) {
  return <>
    <p className="notice">Vínculos y medios institucionales · Solo lectura.</p>
    {!people.length && <p className="empty">No hay vínculos institucionales informados.</p>}
    <div className="contact-list">
      {people.map((person, index) => <details className="contact" key={person.personId ?? `unresolved-${index}`}>
        <summary><span className="contact-name">{person.name}</span>
          <span className="badge">{person.links.map(l => l.relationship).join(" · ")}</span></summary>
        {person.links.map((link, linkIndex) => <div key={`${link.conCod}-${linkIndex}`}>
          <dl className="data-grid">
            <div><dt>Vínculo</dt><dd>{link.relationship}{link.relCod ? ` · ${link.relCod}` : ""}</dd></div>
            <div><dt>Prioridad del vínculo</dt><dd>{link.priority ?? "No informada"} · Priorizado: {link.prioritized ?? "No informado"}</dd></div>
            <div><dt>Prioridad de contacto</dt><dd>{link.contactPriority ?? "No informada"} · Priorizado: {link.contactPrioritized ?? "No informado"}</dd></div>
            <div><dt>Documento</dt><dd>{link.documentType ?? "Tipo no informado"} · {link.documentOriginal ?? link.documentNormalized ?? "No informado"}</dd></div>
            <div><dt>Validez del documento</dt><dd>{link.documentValid ?? "No informada"}{link.documentState ? ` · ${link.documentState}` : ""}</dd></div>
          </dl>
          {(!["CI", "RUT"].includes(link.documentType ?? "") || link.documentValid !== "SI") &&
            <p className="notice">Documento sin validación confirmada como CI/RUT. Revisar los datos institucionales.</p>}
        </div>)}
        <dl>
          {[{ type: "CELULAR", label: "Teléfonos celulares" }, { type: "FIJO", label: "Teléfonos fijos" }, { type: "MAIL", label: "Correos electrónicos" }].map(({ type, label }) =>
            <div key={type}><dt>{label}</dt><dd>{person.media.filter(m => m.type === type).map(m => <p key={m.value}>{m.value}</p>)}
              {!person.media.some(m => m.type === type) && "Sin informar"}</dd></div>)}
          {person.media.filter(m => !["CELULAR", "FIJO", "MAIL"].includes(m.type)).map(m =>
            <div key={`${m.type}:${m.value}`}><dt>Medio · código {m.type}</dt><dd>{m.value}</dd></div>)}
        </dl>
      </details>)}
    </div>
  </>;
}
