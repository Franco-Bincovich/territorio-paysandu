"use client";
import { useEffect, useId, useRef } from "react";
import "./parcel-classification-notice.css";

export function ParcelClassificationNotice({ open, onDismiss, returnFocus }: {
  open: boolean;
  onDismiss: () => void;
  returnFocus: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="classification-notice"
      aria-labelledby={titleId} aria-describedby={messageId}
      onKeyDown={(event) => {
        // The notice has one interactive control; keep forward/backward Tab on it.
        if (event.key === "Tab") {
          event.preventDefault();
          dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
      onClose={() => {
        onDismiss();
        if (returnFocus?.isConnected) returnFocus.focus();
      }}>
      <h2 id={titleId}>Información del padrón</h2>
      <p id={messageId}>Este tipo de padrón aún no ha sido relevado.</p>
      <button type="button" className="btn primary" autoFocus
        onClick={() => dialog.current?.close()}>Entendido</button>
    </dialog>
  );
}
