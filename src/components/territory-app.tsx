"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ConsultationForm } from "./consultation-form";
import { ParcelView } from "./parcel-view";
import {
  request,
  RequestError,
  type Session,
  type Parcel,
  type ParcelRef,
  type Consultation,
  type ConsultationPage,
} from "./contracts";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "No se pudo completar la operación.";
export function TerritoryApp() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [screen, setScreen] = useState<
    "search" | "parcel" | "history" | "create" | "detail"
  >("search");
  const [parcel, setParcel] = useState<Parcel | null>(null),
    [detail, setDetail] = useState<Consultation | null>(null),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const lastActivity = useRef(Date.now());
  const loadSession = useCallback(async () => {
    try {
      const s = await request<Session>("/api/session");
      lastActivity.current = Date.now();
      setSession(s);
      setError("");
    } catch (e) {
      if (e instanceof RequestError && e.status === 401)
        setSession({ user: null, mustChangePassword: false, synthetic: true });
      else setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    const expired = () => {
      setSession(null);
      setParcel(null);
      setDetail(null);
      setScreen("search");
      setNotice("La sesión expiró. Ingresá nuevamente.");
    };
    window.addEventListener("territory-session-expired", expired);
    return () =>
      window.removeEventListener("territory-session-expired", expired);
  }, []);
  useEffect(() => {
    if (!session?.user) return;
    const activity = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) =>
      window.addEventListener(e, activity, { passive: true }),
    );
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= 3600000) {
        setSession(null);
        setParcel(null);
        setDetail(null);
        setNotice("La sesión se cerró por inactividad.");
        void request("/api/auth/logout", { method: "POST" }).catch(() => {});
      }
    }, 30000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, activity));
    };
  }, [session?.user]);
  async function openParcel(ref: ParcelRef) {
    setBusy(true);
    setError("");
    try {
      setParcel(
        await request<Parcel>(
          `/api/parcels/${encodeURIComponent(ref.locality)}/${encodeURIComponent(ref.parcel)}`,
        ),
      );
      setScreen("parcel");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function openDetail(id: string) {
    setBusy(true);
    setError("");
    try {
      setDetail(
        await request<Consultation>(
          `/api/consultations/${encodeURIComponent(id)}`,
        ),
      );
      setScreen("detail");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
      setSession(null);
      setParcel(null);
      setDetail(null);
      setScreen("search");
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="auth-wrap">
        <div className="panel" role="status">
          Verificando sesión…
        </div>
      </main>
    );
  if (!session?.user)
    return (
      <main className="auth-wrap">
        <section className="panel auth-card">
          <Brand />
          <p className="eyebrow">Acceso de colaboradores</p>
          <h1>Bienvenido</h1>
          <p className="muted">Ingresá con tu identidad autorizada.</p>
          {notice && <p role="status">{notice}</p>}
          {error && <ErrorBox text={error} />}
          <AuthForm onSuccess={loadSession} />
        </section>
      </main>
    );
  if (session.mustChangePassword)
    return (
      <main className="auth-wrap">
        <section className="panel auth-card">
          <Brand />
          <h1>Cambiá tu contraseña</h1>
          <p className="muted">
            Para habilitar las funciones, reemplazá la contraseña inicial por
            una contraseña personal.
          </p>
          <AuthForm changePassword onSuccess={loadSession} />
          <button className="btn" onClick={logout} disabled={busy}>
            Cerrar sesión
          </button>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Ir al contenido
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="org">
          <strong>Territorio Paysandú</strong>
          <small>Información territorial</small>
        </div>
        <p className="navlabel">ESPACIO DE TRABAJO</p>
        <nav aria-label="Principal" className="nav">
          <button
            className={screen === "search" ? "active" : ""}
            onClick={() => {
              setScreen("search");
              setError("");
            }}
          >
            ⌕ <span>Buscar padrón</span>
          </button>
          <button
            className={screen === "history" ? "active" : ""}
            onClick={() => {
              setScreen("history");
              setError("");
            }}
          >
            ☷ <span>Historial de consultas</span>
          </button>
        </nav>
        <div className="side-bottom">
          <div className="profile">
            <div className="avatar" aria-hidden="true">
              {session.user.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{session.user.username}</strong>
              <small>Colaborador</small>
            </div>
          </div>
          <button className="btn small logout" disabled={busy} onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span className="crumb">
            Territorio <span>/</span>{" "}
            <b>
              {screen === "search"
                ? "Búsqueda"
                : screen === "history"
                  ? "Consultas"
                  : "Ficha territorial"}
            </b>
          </span>
          {session.synthetic && (
            <span className="pill demo">
              <span className="dot" />
              Datos sintéticos · Prueba
            </span>
          )}
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {session.synthetic && (
            <p className="notice">
              Entorno de prueba: datos sintéticos, sin valor documental.
              Integraciones institucionales pendientes.
            </p>
          )}
          {error && <ErrorBox text={error} />}{" "}
          {busy && <p role="status">Cargando…</p>}
          {screen === "search" && <SearchView onOpen={openParcel} />}{" "}
          {screen === "parcel" && parcel && (
            <ParcelView
              parcel={parcel}
              onCreate={() => setScreen("create")}
              onDetail={openDetail}
              onBack={() => setScreen("search")}
            />
          )}{" "}
          {screen === "history" && <HistoryView onDetail={openDetail} />}{" "}
          {screen === "create" && parcel && (
            <section className="panel">
              <button className="back" onClick={() => setScreen("parcel")}>
                ← Volver a la ficha
              </button>
              <h1>Registrar consulta</h1>
              <p className="muted">
                {parcel.locality} · Padrón {parcel.parcel}
              </p>
              <ConsultationForm
                parcel={parcel}
                onSaved={async (c) => {
                  await openParcel(parcel);
                  setDetail(c);
                  setScreen("detail");
                }}
              />
            </section>
          )}{" "}
          {screen === "detail" && detail && (
            <section className="panel">
              <button className="back" onClick={() => setScreen("history")}>
                ← Volver al historial
              </button>
              <p className="eyebrow">
                Consulta · {detail.locality} / {detail.parcel}
              </p>
              <h1>{detail.type}</h1>
              <p className="muted">
                Registrada el{" "}
                {new Date(detail.createdAt).toLocaleDateString("es-UY")}
              </p>
              <ConsultationForm
                parcel={{
                  locality: detail.locality,
                  parcel: detail.parcel,
                  address: "",
                }}
                initial={detail}
                readOnly={detail.creatorUserId !== session.user.id}
                onSaved={setDetail}
              />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">
        T
      </div>
      <div>
        <div className="brand-name">
          Territorio
          <br />
          <span>Paysandú</span>
        </div>
        <small>Gestión territorial</small>
      </div>
    </div>
  );
}
export function ErrorBox({ text }: { text: string }) {
  return (
    <p className="error" role="alert">
      {text}
    </p>
  );
}
function AuthForm({
  changePassword = false,
  onSuccess,
}: {
  changePassword?: boolean;
  onSuccess: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError("");
    if (changePassword && f.get("password") !== f.get("confirm")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await request(changePassword ? "/api/auth/password" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(
          changePassword
            ? { password: f.get("password") }
            : { username: f.get("username"), password: f.get("password") },
        ),
      });
      e.currentTarget?.reset();
      await onSuccess();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {!changePassword && (
        <label className="field">
          Usuario
          <input
            name="username"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
      )}
      <label className="field">
        {changePassword ? "Nueva contraseña" : "Contraseña"}
        <input
          name="password"
          type="password"
          minLength={changePassword ? 12 : undefined}
          required
          autoComplete={changePassword ? "new-password" : "current-password"}
        />
      </label>
      {changePassword && (
        <label className="field">
          Repetir nueva contraseña
          <input
            name="confirm"
            type="password"
            minLength={12}
            required
            autoComplete="new-password"
          />
        </label>
      )}
      {changePassword && (
        <p className="muted">
          Usá al menos 12 caracteres. No reutilices la contraseña inicial.
        </p>
      )}
      {error && <ErrorBox text={error} />}
      <button className="btn primary" disabled={busy}>
        {busy
          ? "Verificando…"
          : changePassword
            ? "Guardar contraseña personal"
            : "Ingresar"}
      </button>
    </form>
  );
}
function SearchView({ onOpen }: { onOpen: (p: ParcelRef) => Promise<void> }) {
  const [results, setResults] = useState<ParcelRef[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResults(null);
    const query = new URLSearchParams();
    new FormData(e.currentTarget).forEach((v, k) =>
      query.set(k, String(v).trim()),
    );
    try {
      setResults(
        (await request<{ results: ParcelRef[] }>(`/api/search?${query}`))
          .results,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Información territorial</p>
        <h1>
          Encontrá la información
          <br />
          de cada padrón.
        </h1>
        <p>
          Buscá por localidad y padrón o por los datos exactos de una persona.
        </p>
      </section>
      <div className="search-pair">
        <section className="panel">
          <div className="panel-head">
            <h2>
              <span className="step">1</span>Por localidad y padrón
            </h2>
          </div>
          <form className="form-stack" onSubmit={search}>
            <label className="field">
              Localidad
              <input
                name="locality"
                required
                maxLength={120}
                placeholder="Localidad"
              />
            </label>
            <label className="field">
              Número de padrón
              <input
                name="parcel"
                required
                inputMode="numeric"
                pattern="[0-9]+"
                maxLength={20}
                placeholder="Número de padrón"
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Buscar padrón
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <span className="step">2</span>Por persona
            </h2>
          </div>
          <form className="form-stack" onSubmit={search}>
            <label className="field">
              Buscar mediante
              <select name="kind">
                <option value="name">Nombre exacto</option>
                <option value="ci">Cédula</option>
                <option value="rut">RUT</option>
              </select>
            </label>
            <label className="field">
              Dato de la persona
              <input
                name="q"
                required
                maxLength={200}
                placeholder="Ingresá el dato completo"
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Buscar persona
            </button>
            <p className="muted">Incluye todas las localidades.</p>
          </form>
        </section>
      </div>
      {busy && <p role="status">Buscando…</p>}
      {error && <ErrorBox text={error} />}{" "}
      {results !== null && (
        <section className="panel results" aria-live="polite">
          <h2>Resultados de búsqueda</h2>
          {results.length === 0 ? (
            <p className="empty">No se encontraron coincidencias.</p>
          ) : (
            <div className="padron-list">
              {results.map((p) => (
                <button
                  className="padron-card"
                  key={`${p.locality}/${p.parcel}`}
                  onClick={() => void onOpen(p)}
                >
                  <span>
                    <strong>
                      Padrón {p.parcel} · {p.locality}
                    </strong>
                    <small>{p.address}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
export function HistoryView({
  onDetail,
  parcel,
}: {
  onDetail: (id: string) => Promise<void>;
  parcel?: ParcelRef;
}) {
  const [data, setData] = useState<ConsultationPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(() =>
      !parcel && typeof window !== "undefined"
        ? (new URLSearchParams(window.location.search).get("historyFilters") ??
          "")
        : "",
    );
  const [page, setPage] = useState(() => {
    if (parcel || typeof window === "undefined") return 1;
    const n = Number(
      new URLSearchParams(window.location.search).get("historyPage"),
    );
    return Number.isInteger(n) && n > 0 ? n : 1;
  });
  useEffect(() => {
    if (!parcel) {
      const url = new URL(window.location.href);
      url.searchParams.set("historyFilters", query);
      url.searchParams.set("historyPage", String(page));
      window.history.replaceState(null, "", url);
    }
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    const params = new URLSearchParams(query);
    params.set("page", String(page));
    if (parcel) {
      params.set("locality", parcel.locality);
      params.set("parcel", parcel.parcel);
    }
    request<ConsultationPage>(`/api/consultations?${params}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [page, query, parcel?.locality, parcel?.parcel]);
  return (
    <section className="panel">
      <div className="intro">
        <div>
          <p className="eyebrow">Registro compartido</p>
          <h1>{parcel ? "Consultas del padrón" : "Historial de consultas"}</h1>
        </div>
      </div>
      <form
        className="filter-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new URLSearchParams();
          new FormData(e.currentTarget).forEach((v, k) => {
            if (v) q.set(k, String(v));
          });
          setQuery(q.toString());
          setPage(1);
        }}
      >
        {!parcel && (
          <>
            <label className="field">
              Localidad
              <input
                name="locality"
                defaultValue={new URLSearchParams(query).get("locality") ?? ""}
              />
            </label>
            <label className="field">
              Padrón
              <input
                name="parcel"
                inputMode="numeric"
                defaultValue={new URLSearchParams(query).get("parcel") ?? ""}
              />
            </label>
          </>
        )}
        <label className="field">
          Tipo
          <select
            name="type"
            defaultValue={new URLSearchParams(query).get("type") ?? ""}
          >
            <option value="">Todos</option>
            <option>General</option>
            <option>Reclamo</option>
            <option>Falta de documentación</option>
          </select>
        </label>
        <label className="field">
          Desde
          <input
            name="from"
            type="date"
            defaultValue={new URLSearchParams(query).get("from") ?? ""}
          />
        </label>
        <label className="field">
          Hasta
          <input
            name="to"
            type="date"
            defaultValue={new URLSearchParams(query).get("to") ?? ""}
          />
        </label>
        <button className="btn" disabled={busy}>
          Aplicar filtros
        </button>
      </form>
      {error && <ErrorBox text={error} />}{" "}
      {busy ? (
        <p role="status">Cargando consultas…</p>
      ) : (
        data && (
          <>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Localidad / Padrón</th>
                    <th>Tipo</th>
                    <th>Persona</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {new Date(c.createdAt).toLocaleDateString("es-UY")}
                      </td>
                      <td>
                        {c.locality} / {c.parcel}
                      </td>
                      <td>{c.type}</td>
                      <td>{c.person.name}</td>
                      <td>
                        <button
                          className="link"
                          onClick={() => void onDetail(c.id)}
                        >
                          Ver consulta
                          <span className="sr-only"> de {c.person.name}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.items.length === 0 && (
              <p className="empty">No hay consultas para estos filtros.</p>
            )}
            <div className="pagination">
              <button
                className="btn small"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} · {data.total} consultas
              </span>
              <button
                className="btn small"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}
