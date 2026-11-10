import type { InstitutionalPerson } from "@backend/domain/institutional";

export function InstitutionalPeople({ people }: { people: readonly InstitutionalPerson[] }) {
  return <>
    <p className="notice">Vínculos y medios institucionales · Solo lectura.</p>
    {!people.length && <p className="empty">No hay vínculos institucionales informados.</p>}
    <div className="contact-list institutional-contacts">
      {people.map((person, index) => <details className="contact" key={person.personId ?? `unresolved-${index}`}>
        <summary><span className="contact-name">{person.name}</span>
          <span className="badge">{person.links.map(l => l.relationship).join(" · ")}</span></summary>
        {person.links.map((link, linkIndex) => <div key={`${link.conCod}-${linkIndex}`}>
          <dl className="data-grid">
            <div><dt>Vínculo</dt><dd>{link.relationship}</dd></div>
            <div><dt>Documento</dt><dd>{link.documentType ?? "Tipo no informado"} · {link.documentOriginal ?? link.documentNormalized ?? "No informado"}</dd></div>
          </dl>
          {(!["CI", "RUT"].includes(link.documentType ?? "") || link.documentValid !== "SI") &&
            <p className="notice">Documento sin validación confirmada como CI/RUT. Revisar los datos institucionales.</p>}
        </div>)}
        <dl className="contact-media">
          {[{ type: "CELULAR", label: "Teléfonos celulares" }, { type: "FIJO", label: "Teléfonos fijos" }, { type: "MAIL", label: "Correos electrónicos" }].map(({ type, label }) =>
            <div key={type} className={type === "MAIL" ? "contact-emails" : "contact-phones"}><dt>{label}</dt><dd>{person.media.filter(m => m.type === type).map(m => <p key={m.value}>{m.value}</p>)}
              {!person.media.some(m => m.type === type) && "Sin informar"}</dd></div>)}
          {person.media.filter(m => !["CELULAR", "FIJO", "MAIL"].includes(m.type)).map(m =>
            <div key={`${m.type}:${m.value}`}><dt>Otro medio de contacto</dt><dd>{m.value}</dd></div>)}
        </dl>
      </details>)}
    </div>
  </>;
}
