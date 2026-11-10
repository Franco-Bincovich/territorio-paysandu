"use client";
import { useEffect, useId, useRef, useState } from 'react';
import './collaborator-menu.css';

export function CollaboratorMenu({ username, loggingOut, onLogout, onSettings }: {
  username: string; loggingOut: boolean; onLogout: () => void | Promise<void>; onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();
  function close(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    (focusLast.current ? items.at(-1) : items[0])?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="collaborator-menu" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'Tab' && open) close(true);
      if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    <button ref={trigger} type="button" className="collaborator-trigger" aria-label={`Cuenta de ${username}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={loggingOut}
      onClick={() => { focusLast.current = false; setOpen(value => !value); }} onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); } }}>
      <span className="collaborator-avatar" aria-hidden="true">{Array.from(username).slice(0, 2).join('').toUpperCase()}</span>
      <span className="collaborator-identity"><strong title={username}>{username}</strong><small>Colaborador</small></span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div ref={menu} id={id} role="menu" aria-label="Acciones del colaborador" className="collaborator-dropdown">
      <div role="presentation" className="collaborator-menu-heading"><strong>{username}</strong><small>Colaborador</small></div>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { close(); onSettings(); }}>Configuración</button>
      <button type="button" role="menuitem" tabIndex={-1} disabled={loggingOut} onClick={() => { close(); void onLogout(); }}>Cerrar sesión</button>
    </div>}
  </div>;
}
