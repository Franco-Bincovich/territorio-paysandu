"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth-wrap">
      <section className="panel auth-card" role="alert">
        <p className="eyebrow">Territorio Paysandú</p>
        <h1>No se pudo mostrar la pantalla</h1>
        <p className="muted">
          Intentá cargarla nuevamente. Si el problema continúa, contactá al
          responsable técnico.
        </p>
        <button className="btn primary" onClick={reset}>
          Volver a intentar
        </button>
        <a className="btn" href="/">
          Volver al inicio
        </a>
      </section>
    </main>
  );
}
