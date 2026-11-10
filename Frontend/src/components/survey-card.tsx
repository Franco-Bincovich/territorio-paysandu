import type { SurveyInformation } from "@backend/domain/institutional";
const states: Record<string, string> = {
  SIN_RELEVAR: "Sin relevar", RELEVADO_CON_DIFERENCIA: "Relevado con diferencia",
  RELEVADO_DIFERENCIA_NEGATIVA: "Relevado con diferencia negativa",
  RELEVADO_SIN_DIFERENCIA: "Relevado sin diferencia", PENDIENTE_VALIDACION: "Pendiente de validación",
};
export function surveyArea(value: string | null, signed = false): string {
  if (value === null) return "Sin datos";
  const negative = value.startsWith("-");
  const [whole, fraction] = value.replace(/^-/, "").split(".");
  const zero = /^0+$/.test(whole + fraction);
  const sign = zero ? "" : negative ? "−" : signed ? "+" : "";
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction} m²`;
}
export function SurveyCard({ survey }: { survey?: SurveyInformation }) {
  const data = survey?.status === "available" ? survey : null;
  const difference = data?.difference ?? null;
  const direction = difference === null ? null : /^-?0+\.00$/.test(difference) ? "Sin diferencia" : difference.startsWith("-") ? "Diferencia negativa" : "Diferencia positiva";
  return <section className="panel survey-card" aria-label="Información relevada">
    <div className="panel-head"><h2>Información relevada</h2><span className="badge">Solo lectura</span></div>
    {!data ? <p className="notice" role={survey?.status === "absent" ? undefined : "status"}>
      {survey?.status === "absent" ? "Este padrón no tiene registro de relevamiento." : "No se pudo obtener la información relevada. Volvé a abrir la ficha para reintentar."}
    </p> : <dl className="data-grid">
      <div><dt>Fecha de relevamiento</dt><dd>{data.date ? data.date.split("-").reverse().join("/") : "Sin datos"}</dd></div>
      <div><dt>Superficie detectada (m²)</dt><dd>{surveyArea(data.detectedArea)}</dd></div>
      <div><dt>Diferencia calculada (m²)</dt><dd>{surveyArea(difference, true)}{direction && <> <span className="badge">{direction}</span></>}</dd></div>
      <div><dt>Estado del relevamiento</dt><dd>{data.state === null ? "Sin datos" : Object.hasOwn(states, data.state) ? states[data.state] : "Estado no reconocido"}</dd></div>
    </dl>}
  </section>;
}
