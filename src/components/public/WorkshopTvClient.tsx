"use client";

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import { CheckCircle2, Clock, Moon, RefreshCw, Sun, Tv, Wrench } from "lucide-react";
import "@/components/admin/admin.css";

type TvOrder = {
  id: string;
  reference: string;
  customer_name: string | null;
  vehicle_plate: string | null;
  status: string;
  updated_at: string;
};

type TvPayload = {
  inBox: TvOrder[];
  waiting: TvOrder[];
  ready: TvOrder[];
  updatedAt: string;
};

function firstName(name: string | null): string {
  if (!name) return "Cliente";
  return name.trim().split(/\s+/)[0] || "Cliente";
}

export function WorkshopTvClient() {
  const [data, setData] = useState<TvPayload>({
    inBox: [],
    waiting: [],
    ready: [],
    updatedAt: "",
  });
  const [clock, setClock] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("benittes-tv-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  function toggleTheme(event: ReactMouseEvent<HTMLButtonElement>) {
    const next: "light" | "dark" = theme === "dark" ? "light" : "dark";
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const applyTheme = () => {
      setTheme(next);
      try {
        window.localStorage.setItem("benittes-tv-theme", next);
      } catch {
        // ignore storage errors
      }
    };

    const docWithTransition = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };

    if (!docWithTransition.startViewTransition) {
      applyTheme();
      return;
    }

    const transition = docWithTransition.startViewTransition(() => {
      flushSync(applyTheme);
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 520,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // ignore
      });
  }

  const isDark = theme === "dark";
  const palette = isDark
    ? {
        bg: "#0d0d0c",
        ink: "#f7f7f2",
        muted: "#9b9b91",
        border: "#262623",
        colBg: "#151513",
        badgeBg: "#20201d",
        cardBg: "#1b1b18",
        cardBorder: "#2b2b27",
        btnBg: "#1c1c19",
        btnHover: "#262622",
        btnBorder: "#2e2e29",
      }
    : {
        bg: "#f4f4f0",
        ink: "#11110f",
        muted: "#6b6b63",
        border: "#e2e2dc",
        colBg: "#ffffff",
        badgeBg: "#f2f2ed",
        cardBg: "#fafaf7",
        cardBorder: "#e4e4de",
        btnBg: "#ffffff",
        btnHover: "#ecece6",
        btnBorder: "#d9d9d1",
      };

  const smoothTheme = "none";

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/public/tv", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as TvPayload;
      setData(json);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 15000);
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const clockTimer = window.setInterval(tick, 10000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  const columns = [
    {
      key: "waiting",
      title: "Na Fila / Aguardando",
      icon: Clock,
      accent: "#eab308",
      items: data.waiting,
      empty: "Nenhum veículo aguardando",
    },
    {
      key: "inBox",
      title: "No Box · Em Execução",
      icon: Wrench,
      accent: "#3b82f6",
      items: data.inBox,
      empty: "Box disponível no momento",
    },
    {
      key: "ready",
      title: "Prontos para Retirada",
      icon: CheckCircle2,
      accent: "#22c55e",
      items: data.ready,
      empty: "Nenhum veículo pronto ainda",
    },
  ] as const;

  return (
    <div
      className="tv-panel-root"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        boxSizing: "border-box",
        backgroundColor: palette.bg,
        color: palette.ink,
        padding: "20px clamp(20px, 3vw, 44px)",
        transition: smoothTheme,
      }}
    >
      <style>{`
        html:has(.tv-panel-root),
        body:has(.tv-panel-root) {
          margin: 0 !important;
          padding: 0 !important;
          background-color: ${palette.bg} !important;
        }
        .tv-panel-root {
          font-family: var(--font-sans, "Plus Jakarta Sans", Inter, system-ui, -apple-system, sans-serif);
        }
        .tv-header-actions { display: flex; align-items: center; gap: 10px; }
        .tv-columns {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 18px;
          align-items: stretch;
          min-width: 0;
        }
        @media (max-width: 640px) {
          .tv-panel-root { padding: 12px !important; }
          .tv-header {
            align-items: flex-start !important;
            flex-direction: column;
            gap: 12px !important;
            padding-bottom: 12px !important;
            margin-bottom: 12px !important;
          }
          .tv-brand { align-items: flex-start !important; gap: 10px !important; min-width: 0; }
          .tv-brand-logo { width: 36px !important; height: 36px !important; flex: 0 0 36px; }
          .tv-brand h1 { font-size: 16px !important; }
          .tv-brand span { font-size: 11px !important; }
          .tv-header-actions { width: 100%; flex-wrap: wrap; gap: 8px; }
          .tv-clock { margin-left: auto !important; font-size: 22px !important; }
          .tv-columns { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .tv-column { padding: 12px !important; }
          .tv-column h2 { font-size: 15px !important; }
          .tv-item { padding: 11px 12px !important; gap: 8px !important; }
          .tv-item-reference { font-size: 15px !important; }
        }
        .tv-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid ${palette.btnBorder};
          background-color: ${palette.btnBg};
          color: ${palette.ink};
          transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .tv-btn:hover:not(:disabled) {
          background-color: ${palette.btnHover};
          transform: translateY(-1px);
        }
        .tv-btn:active:not(:disabled) {
          transform: scale(0.96);
        }
        .tv-btn:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .tv-spin {
          animation: tvSpin 0.8s linear infinite;
        }
        @keyframes tvSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <header
        className="tv-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          paddingBottom: 18,
          marginBottom: 20,
          borderBottom: `1px solid ${palette.border}`,
          transition: smoothTheme,
        }}
      >
        <div className="tv-brand" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="admin-workspace-logo tv-brand-logo" style={{ width: 44, height: 44 }}>
            <img src="/benittes-logo.png" alt="Benittes Oficina Mecânica" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.15, color: palette.ink, transition: smoothTheme }}>
              Benittes Oficina Mecânica · Painel de Serviços
            </h1>
            <span style={{ fontSize: 13, color: palette.muted, display: "inline-flex", alignItems: "center", gap: 6, transition: smoothTheme }}>
              <Tv size={14} /> Atualização automática a cada 15s
            </span>
          </div>
        </div>

        <div className="tv-header-actions">
          <button
            type="button"
            className="tv-btn"
            onClick={(e) => toggleTheme(e)}
            title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? "Tema claro" : "Tema escuro"}
          </button>
          <button
            type="button"
            className="tv-btn"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "tv-spin" : undefined} /> Atualizar
          </button>
          <strong className="tv-clock" style={{ fontSize: 28, fontVariantNumeric: "tabular-nums", marginLeft: 4, color: palette.ink, transition: smoothTheme }}>
            {clock}
          </strong>
        </div>
      </header>

      <div
        className="tv-columns"
      >
        {columns.map((col) => {
          const Icon = col.icon;
          return (
            <section
              key={col.key}
              className="tv-column"
              style={{
                backgroundColor: palette.colBg,
                border: `1px solid ${palette.border}`,
                borderRadius: 8,
                padding: 18,
                boxSizing: "border-box",
                transition: smoothTheme,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 14,
                  marginBottom: 14,
                  borderBottom: `2px solid ${col.accent}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon size={20} style={{ color: col.accent }} />
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: palette.ink, transition: smoothTheme }}>
                    {col.title}
                  </h2>
                </div>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    padding: "2px 10px",
                    borderRadius: 999,
                    backgroundColor: palette.badgeBg,
                    color: col.accent,
                    transition: smoothTheme,
                  }}
                >
                  {col.items.length}
                </span>
              </div>

              {col.items.length === 0 ? (
                <div style={{ padding: "40px 12px", textAlign: "center", color: palette.muted, fontSize: 14, transition: smoothTheme }}>
                  {col.empty}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {col.items.map((item) => (
                    <div
                      key={item.id}
                      className="tv-item"
                      style={{
                        backgroundColor: palette.cardBg,
                        border: `1px solid ${palette.cardBorder}`,
                        borderRadius: 8,
                        padding: "14px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        transition: smoothTheme,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="tv-item-reference" style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: palette.ink, transition: smoothTheme }}>
                          {item.reference}
                        </div>
                        <div style={{ fontSize: 13.5, color: palette.muted, transition: smoothTheme }}>
                          Cliente: <strong style={{ color: palette.ink, transition: smoothTheme }}>{firstName(item.customer_name)}</strong>
                        </div>
                      </div>

                      {item.vehicle_plate && (
                        <div className="mercosul-plate" style={{ flexShrink: 0 }}>
                          <div className="mercosul-plate-top">BRASIL</div>
                          <div className="mercosul-plate-code">{item.vehicle_plate}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
