"use client";

import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type AdminActionMenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};

export function AdminActionMenu({
  actions,
  label = "Ações do registro",
}: {
  actions: AdminActionMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setPosition(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setPosition(null);
        triggerRef.current?.focus();
      }
    };
    const onScroll = () => {
      setOpen(false);
      setPosition(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function toggleMenu() {
    if (open) {
      setOpen(false);
      setPosition(null);
      return;
    }

    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const separators = actions.filter((action) => action.separatorBefore).length;
    const estimatedHeight = Math.min(actions.length * 36 + separators * 8 + 14, window.innerHeight - 16);
    const spaceBelow = window.innerHeight - bounds.bottom;
    const spaceAbove = bounds.top;
    const placement = spaceBelow >= estimatedHeight
      ? "below"
      : spaceAbove >= estimatedHeight
        ? "above"
        : spaceBelow >= spaceAbove ? "below" : "above";
    const top = placement === "below"
      ? Math.min(bounds.bottom + 6, window.innerHeight - estimatedHeight - 8)
      : Math.max(8, bounds.top - estimatedHeight - 6);
    const left = Math.min(Math.max(8, bounds.right - 204), window.innerWidth - 212);

    setPosition({ top: Math.max(8, top), left: Math.max(8, left), placement });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="admin-icon-btn admin-row-actions-trigger"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggleMenu}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && position && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="admin-row-actions-menu"
          role="menu"
          aria-label={label}
          data-placement={position.placement}
          style={{ top: position.top, left: position.left }}
        >
          {actions.map((action, index) => (
            <div className="admin-row-actions-entry" key={`${action.label}-${index}`} role="none">
              {action.separatorBefore && <div className="admin-row-actions-divider" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={action.destructive ? "is-danger" : undefined}
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  setPosition(null);
                  action.onSelect();
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            </div>
          ))}
        </div>,
        document.querySelector(".admin-root") ?? document.body,
      )}
    </>
  );
}
