"use client";
import "./consultation-history.css";
import "./platform-modules.css";
import { AdministrationView } from "./administration-view";
import { AdministrativeAuditView } from "./administrative-audit-view";
import { ExpedientesView } from "./expedientes-view";
import { hasCapability } from "../../../shared/permissions";
import { CollaboratorMenu } from "./collaborator-menu";
import { AuditSnapshot } from "./audit-snapshot";
import {
  useCallback,
  useEffect,
  useRef,
  useId,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { ConsultationForm } from "./consultation-form";
import {ParcelImageCache,parcelImageIdentity} from './parcel-image-cache';
import { ParcelView, type ParcelTab } from "./parcel-view";
import { ParcelClassificationNotice } from "./parcel-classification-notice";
import { ParcelSearchResults } from "./parcel-search-results";
import { NotificationLotsView } from "./notification-lots-view";
import { CartographicLogin } from "./cartographic-login";
import { requiresClassificationNotice, type ParcelSearchResult } from "./parcel-classification";
import {
  request,
  RequestError,
  type Session,
  type Parcel,
  type ParcelRef,
  type Consultation,
  type ConsultationPage,
} from "./contracts";
import { useRequestScope } from "./use-request-scope";
import { isAbort } from "./request-scope";
import { historyDate } from "./display-date";
export type HistoryReturnState = {
  query: string;
  page: number;
  windowX: number;
  windowY: number;
  tableX: number;
  tableY: number;
  consultationId: string;
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "No se pudo completar la operación.";
export function TerritoryApp() {
  const selectedImages=useRef<ParcelImageCache|null>(null);
  useEffect(()=>()=>selectedImages.current?.dispose(),[]);
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const role = session?.user?.role;
  const canAccessConsultations = hasCapability(role ?? "collaborator", "consultations.read");
  const [screen, setScreen] = useState<
    "search" | "parcel" | "history" | "create" | "detail" | "settings" | "notificationLots" | "administration" | "expedientes"
  >("search");
  const [parcel, setParcel] = useState<Parcel | null>(null),
    [detail, setDetail] = useState<Consultation | null>(null),
    [busy, setBusy] = useState(false);
  const [checkingParcelConsultations, setCheckingParcelConsultations] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const navigationPanel = useRef<HTMLElement>(null);
  const navigationWasOpen = useRef(false);
  const topbarRef = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (navigationOpen) {
      navigationPanel.current?.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
    } else if (navigationWasOpen.current) {
      const toggle = navigationToggle.current;
      if (toggle?.getClientRects().length) toggle.focus();
    }
    navigationWasOpen.current = navigationOpen;
  }, [navigationOpen]);
  useEffect(() => {
    if (!navigationOpen) return;
    const mobile = matchMedia("(max-width: 800px)");
    const closeOnDesktop = () => { if (!mobile.matches) setNavigationOpen(false); };
    mobile.addEventListener("change", closeOnDesktop);
    return () => mobile.removeEventListener("change", closeOnDesktop);
  }, [navigationOpen]);
  const [detailOrigin, setDetailOrigin] = useState<"history" | "parcel">(
    "history",
  );
  const [parcelTab, setParcelTab] = useState<ParcelTab>("record");
  const globalHistoryReturn = useRef<HistoryReturnState | null>(null);
  const parcelHistoryReturn = useRef<HistoryReturnState | null>(null);
  const [restoreHistory, setRestoreHistory] = useState<
    "global" | "parcel" | null
  >(null);
  const rememberGlobalHistory = useCallback((state: HistoryReturnState) => {
    globalHistoryReturn.current = state;
  }, []);
  const rememberParcelHistory = useCallback((state: HistoryReturnState) => {
    parcelHistoryReturn.current = state;
  }, []);
  const finishHistoryRestore = useCallback(() => setRestoreHistory(null), []);
  const lastActivity = useRef(Date.now());
  const navigationRequests = useRequestScope();
  const authRequests = useRequestScope();
  const [loggingOut, setLoggingOut] = useState(false);
  const clearSession = useCallback(
    (text: string) => {
      selectedImages.current?.dispose();selectedImages.current=null;
      navigationRequests.cancel();
      authRequests.cancel();
      globalHistoryReturn.current = null;
      parcelHistoryReturn.current = null;
      setRestoreHistory(null);
      setSession(null);
      setNavigationOpen(false);
      setParcel(null);
      setDetail(null);
      setScreen("search");
      setError("");
      setBusy(false);
      setNotice(text);
      const url = new URL(window.location.href);
      url.searchParams.delete("historyFilters");
      url.searchParams.delete("historyPage");
      window.history.replaceState(null, "", url);
    },
    [navigationRequests, authRequests],
  );
  function navigate(
    next: typeof screen,
    restore: "global" | "parcel" | null = null,
  ) {
    selectedImages.current?.dispose();selectedImages.current=null;
    setNavigationOpen(false);
    setRestoreHistory(restore);
    navigationRequests.cancel();
    setBusy(false);
    setError("");
    setScreen(next);
  }
  const loadSession = useCallback(async () => {
    const operation = authRequests.begin();
    try {
      const s = await request<Session>("/api/session", {
        signal: operation.signal,
      });
      if (!operation.isCurrent()) return;
      lastActivity.current = Date.now();
      navigationRequests.cancel();
      selectedImages.current?.dispose();selectedImages.current=null;
      setParcel(null);
      setDetail(null);
      setScreen("search");
      setBusy(false);
      setSession(s);
      setNotice("");
      setError("");
    } catch (e) {
      if (!operation.isCurrent() || isAbort(e)) return;
      if (e instanceof RequestError && e.status === 401)
        setSession({ user: null, mustChangePassword: false, synthetic: true });
      else setError(message(e));
    } finally {
      if (operation.isCurrent()) setLoading(false);
    }
  }, [authRequests, navigationRequests]);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    const expired = () => clearSession("La sesión expiró. Ingresá nuevamente.");
    window.addEventListener("territory-session-expired", expired);
    return () =>
      window.removeEventListener("territory-session-expired", expired);
  }, [clearSession]);
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
        clearSession("Sesión bloqueada por inactividad.");
        setLoggingOut(true);
        void request("/api/auth/logout", { method: "POST" })
          .then(() => setNotice("La sesión se cerró por inactividad."))
          .catch(() =>
            setError(
              "No se pudo confirmar el cierre remoto. Volvé a intentar cerrar sesión.",
            ),
          )
          .finally(() => setLoggingOut(false));
      }
    }, 30000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, activity));
    };
  }, [session?.user, clearSession]);
  async function openParcel(
    ref: ParcelRef,
    tab: "record" | "consultations" = "record",
    restore = false,
  ) {
    selectedImages.current?.dispose();
    const images=ref.padCod&&session?.institutional?new ParcelImageCache(parcelImageIdentity(ref)):null;
    selectedImages.current=images;
    // Selected reference only. The authenticated image endpoint independently
    // rechecks institutional eligibility; preparation never blocks the record.
    if(images&&ref.padCod)void images.preload(ref.padCod).catch(()=>{});
    const operation = navigationRequests.begin();
    setBusy(true);
    setError("");
    try {
      const record = request<Parcel>(
        `/api/parcels/${encodeURIComponent(ref.locality)}/${encodeURIComponent(ref.parcel)}${ref.padCod ? `?padCod=${encodeURIComponent(ref.padCod)}` : ""}`,
        { signal: operation.signal },
      );
      const checkConsultations = () =>
        request<{ read: boolean; write: boolean }>("/api/consultations/capabilities", { signal: operation.signal })
          .catch(() => ({ read: false, write: false }));
      const capability = session?.institutional && canAccessConsultations ? checkConsultations() : undefined;
      const result = await record;
      if (!operation.isCurrent()){images?.dispose();return;}
      const institutional = result.source === "institutional";
      setRestoreHistory(restore ? "parcel" : null);
      if (!restore) {
        parcelHistoryReturn.current = null;
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      setCheckingParcelConsultations(institutional && canAccessConsultations);
      setParcel(institutional ? { ...result, consultationsRead: false, readOnly: true } : result);
      setParcelTab(tab);
      setScreen("parcel");
      if (institutional && canAccessConsultations) {
        void (capability ?? checkConsultations()).then(({ read, write }) => {
          if (!operation.isCurrent()) return;
          setParcel({ ...result, consultationsRead: read, readOnly: !write });
          setCheckingParcelConsultations(false);
        });
      }
    } catch (e) {
      images?.dispose();if(selectedImages.current===images)selectedImages.current=null;
      if (operation.isCurrent() && !isAbort(e)) setError(message(e));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }
  async function openDetail(id: string) {
    const operation = navigationRequests.begin();
    setBusy(true);
    setError("");
    try {
      const result = await request<Consultation>(
        `/api/consultations/${encodeURIComponent(id)}`,
        { signal: operation.signal },
      );
      if (!operation.isCurrent()) return;
      setDetail(result);
      setDetailOrigin(screen === "parcel" ? "parcel" : "history");
      selectedImages.current?.dispose();selectedImages.current=null;
      setScreen("detail");
    } catch (e) {
      if (operation.isCurrent() && !isAbort(e)) setError(message(e));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }
  async function loadOlderHistory() {
    if(!detail?.historyPagination?.nextBeforeVersion)return;
    const current=detail,operation=navigationRequests.begin();setBusy(true);setError('');
    try {
      const older=await request<Consultation>(`/api/consultations/${encodeURIComponent(current.id)}?historyBefore=${encodeURIComponent(current.historyPagination!.nextBeforeVersion!)}&historyPageSize=20`,{signal:operation.signal});
      if(!operation.isCurrent())return;
      if(older.version!==current.version){setError('La consulta cambió. Volvé a abrirla antes de continuar con el historial.');return;}
      setDetail(latest=>!latest||latest.id!==current.id||latest.version!==current.version?latest:{...latest,history:[...(latest.history??[]),...(older.history??[]).filter(h=>!latest.history?.some(old=>old.version===h.version))],historyPagination:older.historyPagination});
    }catch(e){if(operation.isCurrent()&&!isAbort(e))setError(message(e));}
    finally{if(operation.isCurrent())setBusy(false);}
  }
  async function logout() {
    clearSession("Cerrando sesión…");
    setLoggingOut(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
      setNotice("Sesión cerrada.");
    } catch {
      setNotice("");
      setError(
        "No se pudo confirmar el cierre remoto. Volvé a intentar cerrar sesión.",
      );
    } finally {
      setLoggingOut(false);
    }
  }
  useEffect(() => {
    if (session?.user && !session.mustChangePassword)
      document.getElementById("main")?.focus({ preventScroll: screen === "parcel" });
  }, [screen, session?.user?.id, session?.mustChangePassword]);
  if (loading)
    return (
      <main className="auth-wrap auth-map">
        <div className="panel" role="status">
          Verificando sesión…
        </div>
      </main>
    );
  if (!session?.user)
    return (
      <CartographicLogin>
        <section className="panel auth-card">
          <Brand />
          <p className="eyebrow">Acceso de colaboradores</p>
          <h1>Bienvenido</h1>
          <p className="muted">Ingresá con tu identidad autorizada.</p>
          {notice && <p role="status">{notice}</p>}
          {error && <ErrorBox text={error} />}
          <AuthForm onSuccess={loadSession} disabled={loggingOut} />
          {error.includes("cierre remoto") && (
            <button className="btn" onClick={logout} disabled={loggingOut}>
              Reintentar cierre de sesión
            </button>
          )}
        </section>
      </CartographicLogin>
    );
  if (session.mustChangePassword)
    return (
      <main className="auth-wrap auth-map">
        <section className="panel auth-card">
          <Brand />
          <h1>Cambiá tu contraseña</h1>
          <p className="muted">
            Para habilitar las funciones, reemplazá la contraseña inicial por
            una contraseña personal.
          </p>
          <AuthForm changePassword onSuccess={loadSession} />
          <button className="btn" onClick={logout} disabled={loggingOut}>
            Cerrar sesión
          </button>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <a className="skip" href="#main" inert={navigationOpen}>
        Ir al contenido
      </a>
      <aside
        id="workspace-navigation"
        ref={navigationPanel}
        className={`sidebar${navigationOpen ? " open" : ""}`}
        role={navigationOpen ? "dialog" : undefined}
        aria-modal={navigationOpen || undefined}
        aria-label={navigationOpen ? "Menú principal" : undefined}
        onKeyDown={(event) => {
          if (!navigationOpen) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setNavigationOpen(false);
          } else if (event.key === "Tab") {
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && event.target === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && event.target === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          type="button"
          className="btn mobile-menu"
          onClick={() => setNavigationOpen(false)}
        >
          Cerrar menú
        </button>
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
              navigate("search");
            }}
          >
            ⌕ <span>Buscar padrón</span>
          </button>
          {canAccessConsultations && (
            <button
              className={screen === "history" ? "active" : ""}
              onClick={() => navigate("history")}
            >
              ☷ <span>Historial de consultas</span>
            </button>
          )}
          {session.notificationLots?.consult && (
            <button
              className={screen === "notificationLots" ? "active" : ""}
              onClick={() => navigate("notificationLots")}
            >
              ▤ <span>Lotes</span>
            </button>
          )}
          {hasCapability(role, "expedientes.read") && (
            <button className={screen === "expedientes" ? "active" : ""} onClick={() => navigate("expedientes")}>
              ▱ <span>Expedientes</span>
            </button>
          )}
          {hasCapability(role, "users.manage") && (
            <button className={screen === "administration" ? "active" : ""} onClick={() => navigate("administration")}>
              ⚙ <span>Administración</span>
            </button>
          )}
        </nav>
      </aside>
      <div className="main-wrap" inert={navigationOpen}>
        <header className="topbar" ref={topbarRef}>
          <button
            ref={navigationToggle}
            type="button"
            className="btn mobile-menu"
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationOpen(!navigationOpen)}
          >
            Menú
          </button>
          <span className="crumb">
            Territorio <span>/</span>{" "}
            <b>
              {screen === "administration"
                ? "Administración"
                : screen === "expedientes"
                ? "Expedientes"
                : screen === "settings"
                ? "Configuración"
                : screen === "search"
                  ? "Búsqueda"
                  : screen === "history"
                    ? "Consultas"
                    : screen === "notificationLots"
                      ? "Lotes"
                      : "Ficha territorial"}
            </b>
          </span>
          {session.synthetic && (
            <span className="pill">
              <span className="dot" />
              Datos sintéticos
            </span>
          )}
          <CollaboratorMenu key={screen} username={session.user.username} role={session.user.role} loggingOut={loggingOut} onLogout={logout} onSettings={() => navigate("settings")}/>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {session.synthetic && (
            <p className="notice">
              Datos sintéticos y referencias autorizadas. Información sin validación
              institucional.
            </p>
          )}
          {error && <ErrorBox text={error} />}{" "}
          {busy && <p role="status">Cargando…</p>}
          {screen === "administration" && hasCapability(role, "users.manage") && (
            <AdministrationModule onRequiresLogin={() => clearSession("Los cambios requieren iniciar sesión nuevamente.")} />
          )}
          {screen === "expedientes" && hasCapability(role, "expedientes.read") && (
            <section className="panel"><h1>Expedientes</h1><ExpedientesView role={role} /></section>
          )}
          {screen === "settings" && (
            <section className="panel auth-card">
              <h1>Configuración</h1>
              <h2>Cambiar contraseña</h2>
              <AuthForm
                changePassword
                onSuccess={loadSession}
                disabled={loggingOut}
              />
            </section>
          )}
          {screen === "search" && <SearchView onOpen={openParcel} institutional={session.institutional} topbarRef={topbarRef} />}{" "}
          {screen === "notificationLots" && session.notificationLots?.consult && (
            <NotificationLotsView canDownload={session.notificationLots.download} />
          )}
          {screen === "parcel" && parcel && (
            <ParcelView
              key={parcel.padCod ?? `${parcel.locality}/${parcel.parcel}`}
              parcel={parcel}
              consultationsLoading={checkingParcelConsultations}
              selectedImageCache={selectedImages.current??undefined}
              initialTab={parcelTab}
              historyReturnState={
                restoreHistory === "parcel" ? parcelHistoryReturn.current : null
              }
              onHistoryRemember={rememberParcelHistory}
              onHistoryRestored={finishHistoryRestore}
              onTabChange={setParcelTab}
              onCreate={() => { if (!parcel.readOnly) navigate("create"); }}
              onDetail={openDetail}
              onBack={() => navigate("search")}
            />
          )}{" "}
          {screen === "history" && canAccessConsultations && (
            <HistoryView
              onDetail={openDetail}
              returnState={
                restoreHistory === "global" ? globalHistoryReturn.current : null
              }
              onRemember={rememberGlobalHistory}
              onRestored={finishHistoryRestore}
            />
          )}{" "}
          {screen === "create" && parcel && canAccessConsultations && (
            <section className="panel">
              <button className="back" onClick={() => navigate("parcel")}>
                ← Volver a la ficha
              </button>
              <h1>Registrar consulta</h1>
              <p className="muted">
                {parcel.locality} · Padrón {parcel.parcel}
              </p>
              <ConsultationForm
                parcel={parcel}
                readOnly={parcel.readOnly}
                onSaved={(c) => {
                  setDetail(c);
                  setDetailOrigin("parcel");
                  navigate("detail");
                }}
              />
            </section>
          )}{" "}
          {screen === "detail" && detail && canAccessConsultations && (
            <section className="panel consultation-detail">
              <button
                className="back"
                onClick={() => {
                  if (detailOrigin === "parcel" && parcel)
                    void openParcel(parcel, "consultations", true);
                  else navigate("history", "global");
                }}
              >
                {detailOrigin === "parcel"
                  ? "← Volver a las consultas del padrón"
                  : "← Volver al historial"}
              </button>
              <p className="eyebrow">
                Consulta · {detail.locality} / {detail.parcel}
              </p>
              <h1>{detail.type}</h1>
              <p className="muted">
                Consulta {detail.id} · Registrada el <time dateTime={detail.createdAt}>{historyDate(detail.createdAt)}</time> · {detail.creatorUsername ?? detail.creatorUserId}
              </p>
              <ConsultationForm
                key={`${detail.id}-${detail.version}`}
                parcel={{
                  padCod: detail.padCod,
                  locality: detail.locality,
                  parcel: detail.parcel,
                  address: "",
                }}
                initial={detail}
                readOnly={!(detail.canEdit ?? (session.user.provider !== "mariadb" && detail.creatorUserId === session.user.id))}
                onSaved={setDetail}
              />
              {detail.isHistorical && <p className="notice">Esta consulta es histórica. Las correcciones se conservan en su presentación y no reemplazan los contactos ni el domicilio personal vigentes.</p>}
              {detail.history && <section className="form-stack consultation-versions" aria-label="Historial de modificaciones">
                <h2>Historial de modificaciones</h2>
                {detail.history.map(h => <details className="audit-version" key={h.version}>
                  <summary><strong>Versión {h.version}</strong><time dateTime={h.at}>{historyDate(h.at)}</time><span>{h.operation==='CREACION'?'Registro':'Corrección'}</span><span>{h.byUsername??h.by}</span></summary>
                  <div className="audit-comparison">
                    <section><h3>Datos anteriores</h3>{h.before ? <AuditSnapshot value={h.before} comparison={h.after}/> : <p className="muted">Esta es la primera versión registrada.</p>}</section>
                    <section><h3>Datos de esta versión</h3><AuditSnapshot value={h.after} comparison={h.before??undefined}/></section>
                  </div>
                </details>)}
                {detail.historyPagination?.nextBeforeVersion&&<button className="btn" type="button" disabled={busy} onClick={()=>void loadOlderHistory()}>Ver versiones anteriores</button>}
              </section>}
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
      <img
        className="paysandu-logo"
        src="/paysandu-original.png"
        alt="Paysandú Tierra Heroica"
        width={341}
        height={308}
      />
      <div>
        <div className="brand-name">
          Paysand<span>ú</span>
        </div>
        <small>Gobierno departamental</small>
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
function PasswordField({
  label,
  name,
  minLength,
  autoComplete,
  disabled,
}: {
  label: string;
  name: string;
  minLength?: number;
  autoComplete: string;
  disabled: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          minLength={minLength}
          required
          autoComplete={autoComplete}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="none"
        />
        <button
          type="button"
          className="btn small"
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          aria-controls={id}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible(!visible)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="m3 3 18 18" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
function AuthForm({
  changePassword = false,
  onSuccess,
  disabled = false,
}: {
  changePassword?: boolean;
  onSuccess: () => Promise<void>;
  disabled?: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const requests = useRequestScope();
  useEffect(() => {
    if (error && !busy && !changePassword) {
      form.current?.querySelector<HTMLInputElement>('input[name="password"]')?.focus({ preventScroll: true });
    }
  }, [error, busy, changePassword]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || disabled) return;
    const operation = requests.begin();
    const formElement = e.currentTarget;
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
        signal: operation.signal,
        body: JSON.stringify(
          changePassword
            ? { password: f.get("password") }
            : { username: f.get("username"), password: f.get("password") },
        ),
      });
      if (!operation.isCurrent()) return;
      formElement.reset();
      await onSuccess();
    } catch (e) {
      if (operation.isCurrent() && !isAbort(e)) setError(message(e));
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }
  return (
    <form ref={form} className="form-stack" onSubmit={submit}>
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
      <PasswordField
        label={changePassword ? "Nueva contraseña" : "Contraseña"}
        name="password"
        minLength={changePassword ? 12 : undefined}
        autoComplete={changePassword ? "new-password" : "current-password"}
        disabled={busy || disabled}
      />
      {changePassword && (
        <PasswordField
          label="Repetir nueva contraseña"
          name="confirm"
          minLength={12}
          autoComplete="new-password"
          disabled={busy || disabled}
        />
      )}
      {changePassword && (
        <p className="muted">
          Usá al menos 12 caracteres. No reutilices la contraseña inicial.
        </p>
      )}
      {error && <ErrorBox text={error} />}
      <button className="btn primary" disabled={busy || disabled}>
        {busy
          ? "Verificando…"
          : changePassword
            ? "Guardar contraseña personal"
            : "Ingresar"}
      </button>
    </form>
  );
}
function SearchView({ onOpen, institutional, topbarRef }: {
  onOpen: (p: ParcelRef) => Promise<void>;
  institutional?: boolean;
  topbarRef: RefObject<HTMLElement | null>;
}) {
  const [municipalCode, setMunicipalCode] = useState("");
  const [locality, setLocality] = useState("");
  const [parcelNumber, setParcelNumber] = useState("");
  const [formError, setFormError] = useState<{ method: "parcel" | "person"; text: string } | null>(null);
  const [people, setPeople] = useState<import("./contracts").PersonCandidate[]>([]);
  const [ambiguity, setAmbiguity] = useState(false);
  const [unidentified, setUnidentified] = useState(0);
  const lastPersonQuery = useRef<URLSearchParams | null>(null);
  const [results, setResults] = useState<ParcelSearchResult[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requests = useRequestScope();
  const [classificationNoticeOpen, setClassificationNoticeOpen] = useState(false);
  const [nameSearch, setNameSearch] = useState(false);
  const searchSubmitter = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingResultScroll = useRef<(() => boolean) | null>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();
  const useMunicipalCode = institutional && !!municipalCode.trim();
  const useLocality = !!(locality || parcelNumber.trim());
  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);
  useEffect(() => {
    const heading = headingRef.current;
    if (busy || error || classificationNoticeOpen || results === null || !heading || !pendingResultScroll.current?.()) return;

    pendingResultScroll.current = null;
    const headerHeight = topbarRef.current?.getBoundingClientRect().height ?? 0;
    const top = window.scrollY + heading.getBoundingClientRect().top - headerHeight - 12;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [busy, classificationNoticeOpen, error, results, topbarRef]);
  function parcelQuery() {
    const code = municipalCode.trim();
    const number = parcelNumber.trim();
    if (useMunicipalCode) {
      if (!/^\d+$/.test(code) || Number(code) < 1 || Number(code) > 2147483647) {
        throw new Error("Ingresá un código municipal entre 1 y 2147483647.");
      }
      return new URLSearchParams({ padCod: code });
    }
    if (!locality || !number) throw new Error("Seleccioná una localidad e ingresá el número de padrón.");
    if (!/^\d{1,20}$/.test(number)) throw new Error("Ingresá un número de padrón de hasta 20 dígitos.");
    return new URLSearchParams({ locality, parcel: number });
  }
  async function search(e: FormEvent<HTMLFormElement>, method: "parcel" | "person") {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget);
    const operation = requests.begin();
    pendingResultScroll.current = null;
    setBusy(true);
    setError("");
    setFormError(null);
    setResults(null);
    setPeople([]); setAmbiguity(false); setUnidentified(0);
    setClassificationNoticeOpen(false);
    lastPersonQuery.current = null;
    let query: URLSearchParams;
    try {
      const q = String(data.get("q") ?? "").trim();
      if (method === "person" && !q) throw new Error("Ingresá el dato de la persona.");
      query = method === "parcel" ? parcelQuery() : new URLSearchParams({ kind: String(data.get("kind")), q });
    } catch (error) {
      setFormError({ method, text: message(error) });
      setBusy(false);
      return;
    }
    setNameSearch(query.get("kind") === "name");
    if (method === "person") lastPersonQuery.current = query;
    try {
      const result = await request<{ results: ParcelSearchResult[]; people?: import("./contracts").PersonCandidate[];
        requiresDisambiguation?: boolean; unidentifiedMatches?: number }>(
        `/api/search?${query}`,
        { signal: operation.signal },
      );
      if (operation.isCurrent()) {
        setResults(result.results);
        setPeople(result.people ?? []); setAmbiguity(result.requiresDisambiguation ?? false);
        setUnidentified(result.unidentifiedMatches ?? 0);
        pendingResultScroll.current = operation.isCurrent;
        if (method === "parcel" && result.results.some((record) => requiresClassificationNotice(record.classification))) {
          searchSubmitter.current = submitter instanceof HTMLElement ? submitter : null;
          setClassificationNoticeOpen(true);
        }
      }
    } catch (e) {
      if (operation.isCurrent() && !isAbort(e)) {
        if (e instanceof RequestError && e.status === 400) setFormError({ method, text: message(e) });
        else setError(message(e));
      }
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }
  async function choosePerson(personId: string) {
    if (!lastPersonQuery.current) return;
    const query = new URLSearchParams(lastPersonQuery.current);
    query.set("personId", personId);
    const operation = requests.begin();
    pendingResultScroll.current = null;
    setBusy(true); setError(""); setResults(null);
    try {
      const result = await request<{ results: ParcelSearchResult[]; people: import("./contracts").PersonCandidate[];
        requiresDisambiguation: boolean; unidentifiedMatches: number }>(`/api/search?${query}`, { signal: operation.signal });
      if (!operation.isCurrent()) return;
      setResults(result.results); setPeople(result.people); setAmbiguity(result.requiresDisambiguation); setUnidentified(result.unidentifiedMatches);
      pendingResultScroll.current = operation.isCurrent;
    } catch (e) { if (operation.isCurrent() && !isAbort(e)) setError(message(e)); }
    finally { if (operation.isCurrent()) setBusy(false); }
  }
  return (
    <>
      <section className="hero">
        <div className="art" aria-hidden="true">
          <div className="art-map">
            <div className="plot" />
          </div>
          <div className="pin">
            <svg
              className="i"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div className="art-caption">
            <span className="dot" />
            Una mirada sobre el territorio
          </div>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Información territorial</p>
          <h1>El territorio, en un solo lugar.</h1>
          <p>
            {institutional
              ? "Buscá por código municipal, por localidad y padrón, o por los datos exactos de una persona."
              : "Buscá por localidad y padrón o por los datos exactos de una persona."}
          </p>
        </div>
      </section>
      <div className="search-pair">
        <section className="panel">
          <div className="panel-head">
            <h2>
              <span className="step">1</span>Por padrón
            </h2>
          </div>
          <form className={institutional ? "search-grid municipal-search-grid" : "search-grid"}
            onSubmit={event => void search(event, "parcel")} noValidate>
            {institutional && <label className="field">
              Código municipal
              <input name="padCod" inputMode="numeric" value={municipalCode}
                onChange={event => { setMunicipalCode(event.target.value); setFormError(null); }}
                disabled={useLocality} aria-describedby={formError?.method === "parcel" ? errorId : undefined} />
            </label>}
            <label className="field">
              Localidad
              <select name="locality" value={locality} disabled={useMunicipalCode}
                onChange={event => { setLocality(event.target.value); setFormError(null); }}
                aria-describedby={formError?.method === "parcel" ? errorId : undefined}>
                <option value="">Seleccioná una localidad</option>
                <option value="Paysandú">Paysandú</option>
                <option value="Paysandú Chacras">Paysandú Chacras</option>
              </select>
            </label>
            <label className="field">
              Padrón
              <input
                name="parcel"
                inputMode="numeric"
                maxLength={20}
                placeholder="Número de padrón"
                value={parcelNumber}
                disabled={useMunicipalCode}
                onChange={event => { setParcelNumber(event.target.value); setFormError(null); }}
                aria-describedby={formError?.method === "parcel" ? errorId : undefined}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Buscar padrón
            </button>
            {formError?.method === "parcel" && <p className="error search-form-error" id={errorId} ref={formErrorRef}
              role="alert" tabIndex={-1}>{formError.text}</p>}
          </form>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <span className="step">2</span>Por persona
            </h2>
          </div>
          <form className="search-grid" onSubmit={event => void search(event, "person")} onChange={() => setFormError(null)} noValidate>
            <label className="field">
              Buscar mediante
              <select name="kind">
                <option value="name">{institutional ? "Nombre completo" : "Nombre exacto"}</option>
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
                aria-describedby={formError?.method === "person" ? errorId : undefined}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Buscar persona
            </button>
            {formError?.method === "person" && <p className="error search-form-error" id={errorId} ref={formErrorRef}
              role="alert" tabIndex={-1}>{formError.text}</p>}
            <p className="muted">Incluye todas las localidades.</p>
          </form>
        </section>
      </div>
      <ParcelClassificationNotice open={classificationNoticeOpen}
        onDismiss={() => setClassificationNoticeOpen(false)} returnFocus={searchSubmitter.current} />
      <ParcelSearchResults results={results} busy={busy} error={error} headingRef={headingRef}
        nameSearch={nameSearch} onOpen={onOpen} people={people}
        requiresDisambiguation={ambiguity} unidentifiedMatches={unidentified} onChoosePerson={choosePerson} />
    </>
  );
}
function AdministrationModule({ onRequiresLogin }: { onRequiresLogin: () => void }) {
  const [audit, setAudit] = useState(false);
  return <>
    <div className="administration-navigation" role="group" aria-label="Secciones de Administración">
      <button className="btn" aria-pressed={!audit} onClick={() => setAudit(false)}>Usuarios</button>
      <button className="btn" aria-pressed={audit} onClick={() => setAudit(true)}>Auditoría</button>
    </div>
    {audit
      ? <section className="panel"><AdministrativeAuditView /></section>
      : <AdministrationView onRequiresLogin={onRequiresLogin} />}
  </>;
}

export function HistoryView({
  onDetail,
  parcel,
  returnState,
  onRemember,
  onRestored,
}: {
  onDetail: (id: string) => Promise<void>;
  parcel?: ParcelRef;
  returnState?: HistoryReturnState | null;
  onRemember?: (state: HistoryReturnState) => void;
  onRestored?: () => void;
}) {
  const [data, setData] = useState<ConsultationPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(
      () =>
        returnState?.query ??
        (!parcel && typeof window !== "undefined"
          ? (new URLSearchParams(window.location.search).get(
              "historyFilters",
            ) ?? "")
          : ""),
    );
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(() => {
    if (returnState) return returnState.page;
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
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    const params = new URLSearchParams(query);
    params.set("page", String(page));
    if (parcel) {
      if (parcel.padCod) params.set('padCod', parcel.padCod);
      params.set("locality", parcel.locality);
      params.set("parcel", parcel.parcel);
    }
    request<ConsultationPage>(`/api/consultations?${params}`, {
      signal: controller.signal,
    })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active && !isAbort(e)) setError(message(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, query, parcel?.locality, parcel?.parcel, parcel?.padCod]);
  useEffect(() => {
    if (!returnState || !data || busy) return;
    const frame = requestAnimationFrame(() => {
      if (returnState.query === query && returnState.page === page) {
        const table = tableRef.current;
        const button = Array.from(
          table?.querySelectorAll<HTMLButtonElement>(
            "button[data-consultation-id]",
          ) ?? [],
        ).find(
          (node) => node.dataset.consultationId === returnState.consultationId,
        );
        button?.focus({ preventScroll: true });
        if (table) {
          table.scrollLeft = returnState.tableX;
          table.scrollTop = returnState.tableY;
        }
        window.scrollTo({
          left: returnState.windowX,
          top: returnState.windowY,
          behavior: "instant",
        });
      }
      onRestored?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [returnState, data, busy, query, page, onRestored]);
  function detailFromHistory(id: string) {
    onRemember?.({
      query,
      page,
      windowX: window.scrollX,
      windowY: window.scrollY,
      tableX: tableRef.current?.scrollLeft ?? 0,
      tableY: tableRef.current?.scrollTop ?? 0,
      consultationId: id,
    });
    void onDetail(id);
  }
  return (
    <section className="panel consultation-history">
      <div className="intro">
        <div>
          <p className="eyebrow">Registro compartido</p>
          <h1>{parcel ? "Consultas del padrón" : "Historial de consultas"}</h1>
        </div>
      </div>
      <form
        className="filter-grid consultation-filters"
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
            <option>Declaracion voluntaria de metros</option>
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
            <div
              className="tablewrap"
              ref={tableRef}
              role="region"
              aria-label="Listado de consultas"
              tabIndex={0}
            >
              <table role="table">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Localidad / Padrón</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Persona</th>
                    <th scope="col">Creador</th>
                    <th scope="col">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Fecha"><time dateTime={c.createdAt}>{historyDate(c.createdAt)}</time></td>
                      <td data-label="Localidad / Padrón">
                        {c.locality} / {c.parcel}
                      </td>
                      <td data-label="Tipo">{c.type}</td>
                      <td data-label="Persona">{c.person.name}</td>
                      <td data-label="Creador">{c.creatorUsername??c.creatorUserId}</td>
                      <td data-label="Detalle">
                        <button
                          className="btn small history-open"
                          data-consultation-id={c.id}
                          onClick={() => detailFromHistory(c.id)}
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
