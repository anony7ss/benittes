"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bell, CalendarDays, MessageSquareText, Package, AlertTriangle, X, ArrowUpRight } from "lucide-react";
import { fetchAlerts } from "../../lib/supabase";
import { routeFor } from "../../admin/navigation";
import { SkeletonList } from "./Skeletons";

type AlertItem = {
  id: string;
  kind: "agenda" | "message" | "stock" | "finance";
  title: string;
  subtitle: string;
  href: string;
};

export function NotificationCenter({
  open,
  onClose,
  onTotalChange,
}: {
  open: boolean;
  onClose: () => void;
  onTotalChange: (count: number) => void;
}) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!open && hasLoadedRef.current) return;
    let active = true;
    async function load() {
      try {
        const { messages, appointments, inventory, finance } = await fetchAlerts();

        if (!active) return;
        const today = new Date().toISOString().slice(0, 10);
        const lowStock = inventory.filter((row) => {
          const qty = Number((row.details as Record<string, unknown>)?.quantity ?? 0);
          const min = Number((row.details as Record<string, unknown>)?.minimum_stock ?? 0);
          return min > 0 && qty <= min;
        });
        const overdue = finance.filter((row) => {
          const d = row.details as Record<string, unknown>;
          return d?.tipo === "receber" && !d?.paid_at && row.status !== "concluido" && row.status !== "cancelado" && String(d?.due_at ?? "") < today;
        });

        const next: AlertItem[] = [
          ...messages.map((m) => ({
            id: `msg-${m.id}`,
            kind: "message" as const,
            title: `Nova mensagem de ${m.name}`,
            subtitle: m.message.slice(0, 72),
            href: routeFor("contatos"),
          })),
          ...appointments.map((a) => ({
            id: `apt-${a.id}`,
            kind: "agenda" as const,
            title: `Agendamento: ${a.title}`,
            subtitle: `${a.customer_name || "Cliente"} · ${a.vehicle || "Veículo"}`,
            href: routeFor("agenda"),
          })),
          ...lowStock.slice(0, 4).map((p) => ({
            id: `stk-${p.id}`,
            kind: "stock" as const,
            title: `Estoque baixo: ${p.title}`,
            subtitle: `Disponível: ${String((p.details as Record<string, unknown>)?.quantity ?? 0)} un.`,
            href: routeFor("estoque"),
          })),
          ...overdue.slice(0, 4).map((f) => ({
            id: `fin-${f.id}`,
            kind: "finance" as const,
            title: `Vencimento em atraso: ${f.title}`,
            subtitle: `${f.customer_name || "Cliente"} · venc. ${String((f.details as Record<string, unknown>)?.due_at ?? "")}`,
            href: routeFor("financeiro"),
          })),
        ];

        setItems(next);
        onTotalChange(next.length);
      } catch {
        if (active) {
          setItems([]);
          onTotalChange(0);
        }
      } finally {
        if (active) {
          hasLoadedRef.current = true;
          setHasLoaded(true);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [open, onTotalChange]);

  if (!open) return null;

  return (
    <motion.div
      className="admin-drawer-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.aside
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Central de notificações"
        initial={{ opacity: 0, x: 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="admin-modal-head" style={{ marginBottom: 4 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Bell size={18} /> Notificações
            </h2>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="Fechar notificações">
            <X size={16} />
          </button>
        </div>

        {!hasLoaded && <SkeletonList rows={3} />}

        {hasLoaded && items.length === 0 && (
          <div className="admin-empty" style={{ minHeight: 220 }}>
            <strong>Tudo em dia na oficina</strong>
            <p>Nenhum alerta de agenda, estoque baixo, vencimento ou mensagem pendente.</p>
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <a
              key={item.id}
              href={item.href}
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: 12,
                borderRadius: 6,
                border: "1px solid var(--admin-line)",
                background: "var(--admin-soft)",
              }}
            >
              <div className={`admin-stat-icon ${item.kind === "stock" || item.kind === "finance" ? "orange" : "blue"}`}>
                {item.kind === "message" && <MessageSquareText size={15} />}
                {item.kind === "agenda" && <CalendarDays size={15} />}
                {item.kind === "stock" && <Package size={15} />}
                {item.kind === "finance" && <AlertTriangle size={15} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13, display: "block" }}>{item.title}</strong>
                <span style={{ fontSize: 12, color: "var(--admin-muted)", display: "block", marginTop: 2 }}>
                  {item.subtitle}
                </span>
              </div>
              <ArrowUpRight size={15} style={{ color: "var(--admin-muted)", flexShrink: 0 }} />
            </a>
          ))}
        </div>
      </motion.aside>
    </motion.div>
  );
}
