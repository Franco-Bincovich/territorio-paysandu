"use client";
import { Children, useId, type ReactNode } from "react";
import "./package-4-visual.css";

/** Presentation slot only. It has no fields, form state or serialization. */
export function OptionalDomicileSection({ children }: { children?: ReactNode }) {
  const titleId = useId();
  const hasFields = Children.toArray(children).length > 0;
  return (
    <section className="optional-domicile" aria-labelledby={titleId}>
      <div className="panel-head">
        <h3 id={titleId}>Domicilio</h3>
        <span className="badge">Opcional</span>
      </div>
      {hasFields ? children : (
        <p className="muted">Disponible próximamente. No es necesario completarlo para registrar la consulta.</p>
      )}
    </section>
  );
}
