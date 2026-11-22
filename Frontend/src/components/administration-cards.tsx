"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { MODULES, accessChanges, moduleKeys, type AccessMatrix, type AccessSettings, type Module } from "../../../shared/module-access";
import { ROLES, ROLE_LABELS, type Role } from "../../../shared/permissions";
import { AdministrationView } from "./administration-view";
import { request, RequestError } from "./contracts";
import { useRequestScope } from "./use-request-scope";

function AdministrationCard({ title, children }: { title: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return <details className="panel administration-card" onToggle={event => {
    if (event.currentTarget.open) setOpened(true);
  }}>
    <summary>{title}</summary>
    {opened && <div className="administration-card-content">{children}</div>}
  </details>;
}

export function AdministrationCards({ onRequiresLogin, onPermissionsSaved }: {
  onRequiresLogin: () => void;
  onPermissionsSaved: () => void;
}) {
  return <section className="administration-cards">
    <h1>Administración</h1>
    <AdministrationCard title="Gestión de usuarios">
      <AdministrationView onRequiresLogin={onRequiresLogin} />
    </AdministrationCard>
    <AdministrationCard title="Gestión de permisos">
      <PermissionsMatrix onSaved={onPermissionsSaved} />
    </AdministrationCard>
  </section>;
}

const permissionsUrl = "/api/admin/permissions";

function PermissionsMatrix({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [draft, setDraft] = useState<AccessMatrix | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const requests = useRequestScope();
  const modified = !!settings && !!draft && accessChanges(settings.matrix, draft).length > 0;

  useEffect(() => {
    const operation = requests.begin();
    setBusy(true);
    setError("");
    setNotice("");
    request<AccessSettings>(permissionsUrl, { signal: operation.signal })
      .then(value => {
        if (!operation.isCurrent()) return;
        setSettings(value);
        setDraft(value.matrix);
        setStale(false);
      })
      .catch(error => {
        if (operation.isCurrent()) setError(error instanceof Error ? error.message : "No se pudieron cargar los permisos.");
      })
      .finally(() => {
        if (operation.isCurrent()) setBusy(false);
      });
  }, [reload, requests]);

  function toggle(role: Role, module: Module, checked: boolean) {
    setDraft(value => value && { ...value, [role]: { ...value[role], [module]: checked } });
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings?.writable || !draft || busy || stale || !modified) return;
    const operation = requests.begin();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<AccessSettings>(permissionsUrl, {
        method: "PATCH", body: JSON.stringify({ revision: settings.revision, matrix: draft }), signal: operation.signal,
      });
      if (!operation.isCurrent()) return;
      setSettings(result);
      setDraft(result.matrix);
      onSaved();
      setNotice("Permisos guardados.");
    } catch (error) {
      if (!operation.isCurrent()) return;
      setError(error instanceof Error ? error.message : "No se pudieron guardar los permisos.");
      if (error instanceof RequestError && ["VERSION_CONFLICT", "ADMIN_COMMIT_UNCERTAIN"].includes(error.code ?? ""))
        setStale(true);
    } finally {
      if (operation.isCurrent()) setBusy(false);
    }
  }

  return <>
    {busy && !settings && <p role="status">Cargando permisos…</p>}
    {error && <p role="alert" className="error">{error} {(!settings || stale) &&
      <button type="button" className="btn small" disabled={busy} onClick={() => setReload(value => value + 1)}>Volver a cargar</button>}</p>}
    {notice && <p role="status">{notice}</p>}
    {settings && draft && <form onSubmit={save}>
      {!settings.writable && <p className="notice">La edición de permisos no está disponible en esta instancia.</p>}
      <p className="muted">Las casillas habilitan el acceso a las solapas. Cada operación tiene sus propios permisos.</p>
      <fieldset className="permissions-fields" disabled={busy || stale || !settings.writable}>
        <div className="tablewrap" role="region" aria-label="Matriz de permisos" tabIndex={0}>
          <table className="admin-permissions-table">
            <thead><tr><th scope="col">Solapa</th>{ROLES.map(role => <th scope="col" key={role}>{ROLE_LABELS[role]}</th>)}</tr></thead>
            <tbody>{moduleKeys.map(module => <tr key={module}>
              <th scope="row">{MODULES[module]}</th>
              {ROLES.map(role => <td key={role}><input type="checkbox" aria-label={`${MODULES[module]} · ${ROLE_LABELS[role]}`}
                checked={draft[role][module]} disabled={module === "administration"}
                onChange={event => toggle(role, module, event.target.checked)} /></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="admin-modal-actions">
          <button type="button" className="btn" disabled={!modified} onClick={() => {
            setDraft(settings.matrix);
            setError("");
            setNotice("");
          }}>Cancelar</button>
          <button className="btn primary" disabled={!modified}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </fieldset>
    </form>}
  </>;
}
