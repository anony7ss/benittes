"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

const CONFIRM_EVENT = "benittes:confirm-dialog";

export function confirmModal(options: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const event = new CustomEvent<PendingConfirm & { handled?: boolean }>(CONFIRM_EVENT, {
      detail: { ...options, resolve, handled: false },
    });
    window.dispatchEvent(event);
    if (!event.detail.handled) {
      resolve(window.confirm(options.message));
    }
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    const onConfirmRequest = (e: Event) => {
      const custom = e as CustomEvent<PendingConfirm & { handled?: boolean }>;
      if (!custom.detail) return;
      custom.detail.handled = true;
      setPending({
        title: custom.detail.title,
        message: custom.detail.message,
        confirmLabel: custom.detail.confirmLabel,
        cancelLabel: custom.detail.cancelLabel,
        danger: custom.detail.danger,
        resolve: custom.detail.resolve,
      });
    };
    window.addEventListener(CONFIRM_EVENT, onConfirmRequest);
    return () => window.removeEventListener(CONFIRM_EVENT, onConfirmRequest);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pending.resolve(false);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending]);

  if (!pending) return null;

  const close = (result: boolean) => {
    pending.resolve(result);
    setPending(null);
  };

  const isDanger = pending.danger !== false;

  return (
    <div
      className="admin-modal-backdrop"
      style={{ zIndex: 1200 }}
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="admin-modal admin-confirm-modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-head admin-confirm-modal-head">
          <div className="admin-confirm-modal-copy">
            <span className={isDanger ? "is-danger" : ""} aria-hidden="true">
              {isDanger ? <Trash2 size={17} /> : <AlertTriangle size={17} />}
            </span>
            <div>
              <h2 id="confirm-dialog-title">
                {pending.title || "Confirmar exclusão"}
              </h2>
              <p>{pending.message}</p>
            </div>
          </div>
          <button
            type="button"
            className="admin-icon-btn"
            onClick={() => close(false)}
            aria-label="Fechar"
          >
            <X size={15} />
          </button>
        </div>

        <div className="admin-modal-actions">
          <button type="button" className="admin-secondary" onClick={() => close(false)}>
            {pending.cancelLabel || "Cancelar"}
          </button>
          <button
            type="button"
            className="admin-primary"
            style={
              isDanger
                ? { background: "#dc2626", borderColor: "#dc2626", color: "#fff" }
                : undefined
            }
            onClick={() => close(true)}
            autoFocus
          >
            {pending.confirmLabel || "Excluir"}
          </button>
        </div>
      </div>
    </div>
  );
}
