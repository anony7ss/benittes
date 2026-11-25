"use client";

import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Car,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  DollarSign,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Package,
  Pin,
  Receipt,
  Settings,
  ShoppingBag,
  Sun,
  UserCog,
  Wrench,
  X,
} from "lucide-react";
import { adminPages, canSeePage, routeFor, type AdminPage } from "../../admin/navigation";
import { useProfilePhoto } from "./ProfilePhoto";
import { NotificationCenter } from "./NotificationCenter";

const iconMap: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  agenda: CalendarDays,
  orders: ClipboardList,
  quotes: Receipt,
  inspections: ClipboardCheck,
  clients: ContactRound,
  vehicles: Car,
  services: Wrench,
  inventory: Package,
  contacts: MessageSquareText,
  finance: DollarSign,
  sales: ShoppingBag,
  reports: BarChart3,
  bot: Bot,
  settings: Settings,
  account: UserCog,
};

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  advisor: "Consultor",
  technician: "Técnico",
  finance: "Financeiro",
};

export function AdminShell({
  page,
  role,
  email,
  fullName,
  onSignOut,
  children,
}: {
  page: AdminPage;
  role: string;
  email: string;
  fullName?: string | null;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [pinned, setPinned] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsCount, setNotificationsCount] = useState(0);
  const { avatarUrl } = useProfilePhoto();

  useLayoutEffect(() => {
    try {
      const isDark = localStorage.getItem("admin-theme") !== "light";
      setDarkMode(isDark);
      setPinned(localStorage.getItem("admin-sidebar-pinned") === "1");
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.style.backgroundColor = isDark ? "#11110f" : "#efefeb";
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    const syncGliders = () => {
      document.querySelectorAll<HTMLElement>(".admin-filter-pills").forEach((bar) => {
        const active = bar.querySelector<HTMLElement>(".admin-pill.active");
        if (!active) {
          bar.style.setProperty("--pill-o", "0");
          return;
        }
        bar.style.setProperty("--pill-x", `${active.offsetLeft}px`);
        bar.style.setProperty("--pill-y", `${active.offsetTop}px`);
        bar.style.setProperty("--pill-w", `${active.offsetWidth}px`);
        bar.style.setProperty("--pill-h", `${active.offsetHeight}px`);
        bar.style.setProperty("--pill-o", "1");
      });
    };

    const rafSync = () => requestAnimationFrame(syncGliders);
    rafSync();

    const observer = new MutationObserver(rafSync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("resize", rafSync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", rafSync);
    };
  }, [page]);

  useEffect(() => {
    let lastOrigin: { x: number; y: number } | null = null;

    const recordOrigin = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const trigger = target?.closest<HTMLElement>("button, a, [role='button']");
      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        lastOrigin = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      } else {
        lastOrigin = { x: event.clientX, y: event.clientY };
      }
    };

    const animateModal = (backdrop: HTMLElement) => {
      if (backdrop.dataset.animated === "1") return;
      backdrop.dataset.animated = "1";

      const modal = backdrop.querySelector<HTMLElement>(".admin-modal");
      backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 240,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      });

      if (!modal) return;
      const rect = modal.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = lastOrigin ? lastOrigin.x - centerX : 0;
      const dy = lastOrigin ? lastOrigin.y - centerY : 18;

      modal.animate(
        [
          {
            opacity: 0,
            transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.76)`,
          },
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(1)",
          },
        ],
        {
          duration: 340,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      );
    };

    const modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains("admin-modal-backdrop")) {
            requestAnimationFrame(() => animateModal(node));
          } else {
            node.querySelectorAll<HTMLElement>(".admin-modal-backdrop").forEach((el) => {
              requestAnimationFrame(() => animateModal(el));
            });
          }
        }
      }
    });

    document.addEventListener("pointerdown", recordOrigin, true);
    modalObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("pointerdown", recordOrigin, true);
      modalObserver.disconnect();
    };
  }, []);

  function toggleTheme(event?: React.MouseEvent<HTMLButtonElement>) {
    const next = !darkMode;
    const applyDomTheme = () => {
      document.documentElement.classList.toggle("dark", next);
      document.documentElement.style.backgroundColor = next ? "#11110f" : "#efefeb";
      try {
        localStorage.setItem("admin-theme", next ? "dark" : "light");
      } catch {
        // ignore storage errors
      }
    };

    const rect = event?.currentTarget?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : 36;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight - 40;
    const maxRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const docWithVT = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };

    if (typeof docWithVT.startViewTransition === "function") {
      try {
        const transition = docWithVT.startViewTransition(() => {
          flushSync(() => {
            setDarkMode(next);
          });
          applyDomTheme();
        });
        void transition.ready
          .then(() => {
            document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${maxRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 620,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                pseudoElement: "::view-transition-new(root)",
              },
            );
          })
          .catch(() => {});
        return;
      } catch {
        // fallback below
      }
    }

    // Fallback circular wave overlay for browsers without View Transitions
    const wave = document.createElement("div");
    wave.style.position = "fixed";
    wave.style.left = `${x}px`;
    wave.style.top = `${y}px`;
    wave.style.width = `${maxRadius * 2}px`;
    wave.style.height = `${maxRadius * 2}px`;
    wave.style.marginLeft = `${-maxRadius}px`;
    wave.style.marginTop = `${-maxRadius}px`;
    wave.style.borderRadius = "50%";
    wave.style.pointerEvents = "none";
    wave.style.zIndex = "9999";
    wave.style.background = next ? "#11110f" : "#efefeb";
    wave.style.transform = "scale(0)";
    document.body.appendChild(wave);

    const expand = wave.animate(
      [{ transform: "scale(0)" }, { transform: "scale(1)" }],
      { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    );
    expand.onfinish = () => {
      setDarkMode(next);
      applyDomTheme();
      const fade = wave.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 240, easing: "ease-out", fill: "forwards" },
      );
      fade.onfinish = () => wave.remove();
    };
  }

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem("admin-sidebar-pinned", next ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }

  const visiblePages = useMemo(
    () =>
      adminPages.filter(
        (item) => item.group !== "Acesso" && canSeePage(role, item),
      ),
    [role],
  );

  const groups = useMemo(() => {
    const order: AdminPage["group"][] = ["Operação", "Oficina", "Comercial", "Sistema"];
    return order
      .map((group) => ({
        group,
        items: visiblePages.filter((item) => item.group === group),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [visiblePages]);

  const mobileLinks = useMemo(
    () =>
      visiblePages.filter((p) =>
        ["", "agenda", "ordens-de-servico", "clientes"].includes(p.path),
      ),
    [visiblePages],
  );

  const displayName = fullName?.trim() || email;

  return (
    <div className="admin-shell">
      <div
        className={`admin-mobile-scrim ${mobileOpen ? "visible" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={`admin-sidebar ${mobileOpen ? "mobile-open" : ""} ${pinned ? "pinned" : ""}`}
        aria-label="Navegação da oficina"
      >
        <div className="admin-workspace-wrap">
          <div className="admin-workspace-card" title="Benittes Oficina">
            <div className="admin-workspace-logo">
              <img src="/benittes-logo.png" alt="Benittes" />
            </div>
            <div className="admin-workspace-text">
              <strong>Benittes Oficina</strong>
            </div>
            {mobileOpen ? (
              <button
                type="button"
                className="admin-sidebar-btn"
                onClick={() => setMobileOpen(false)}
                aria-label="Fechar menu"
              >
                <X size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="admin-sidebar-btn"
                onClick={togglePin}
                title={pinned ? "Desafixar menu" : "Fixar menu aberto"}
                aria-label={pinned ? "Desafixar menu" : "Fixar menu aberto"}
                style={{ color: pinned ? "var(--admin-orange)" : undefined }}
              >
                <Pin size={15} />
              </button>
            )}
          </div>
        </div>

        <nav className="admin-sidebar-nav">
          {groups.map((group, idx) => (
            <div key={group.group} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {idx > 0 && <div className="admin-nav-divider" />}
              {group.items.map((item) => {
                const Icon = iconMap[item.icon] ?? LayoutDashboard;
                const active = item.path === page.path;
                return (
                  <a
                    key={item.path}
                    href={routeFor(item.path)}
                    className={`admin-nav-item ${active ? "active" : ""}`}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-active-indicator"
                        className="admin-active-bar"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon size={18} />
                    <span className="admin-nav-label-text">{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}

          <div className="admin-nav-divider" />
          <a href="/" target="_blank" rel="noopener noreferrer" className="admin-nav-item" title="Abrir o site">
            <ExternalLink size={17} />
            <span className="admin-nav-label-text">Abrir o site</span>
          </a>
        </nav>

        <div className="admin-sidebar-footer">
          <a
            href={routeFor("conta")}
            className="admin-user-pill"
            onClick={() => setMobileOpen(false)}
            title="Gerenciar Conta & Equipe"
          >
            <span className="admin-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} />
              ) : (
                displayName.slice(0, 1).toUpperCase()
              )}
            </span>
            <div className="admin-user-copy">
              <strong>{displayName}</strong>
              <small>{roleLabels[role] ?? role}</small>
            </div>
          </a>

          <div className="admin-sidebar-actions">
            <button
              type="button"
              className="admin-sidebar-btn"
              onClick={() => setNotificationsOpen(true)}
              title="Central de Notificações"
              aria-label="Abrir central de notificações"
            >
              <Bell size={16} />
              {notificationsCount > 0 && <span className="admin-bell-dot" />}
            </button>

            <button
              type="button"
              className="admin-sidebar-btn"
              onClick={(e) => toggleTheme(e)}
              title={darkMode ? "Mudar para tema claro" : "Mudar para tema escuro"}
              aria-label="Alternar tema"
            >
              <motion.span
                key={darkMode ? "sun" : "moon"}
                initial={{ rotate: -90, scale: 0.55, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                style={{ display: "inline-grid", placeItems: "center" }}
              >
                {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              </motion.span>
            </button>

            <button
              type="button"
              className="admin-sidebar-btn logout"
              onClick={onSignOut}
              title="Sair do painel"
              aria-label="Sair do painel"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-mobile-head">
          <button
            type="button"
            className="admin-icon-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            style={{ borderRadius: 8 }}
          >
            <Menu size={17} />
          </button>

          <span className="admin-mobile-brand">Benittes</span>

          <button
            type="button"
            className="admin-icon-btn"
            onClick={() => setNotificationsOpen(true)}
            aria-label="Notificações"
            style={{ position: "relative", borderRadius: 8 }}
          >
            <Bell size={16} />
            {notificationsCount > 0 && <span className="admin-bell-dot" />}
          </button>
        </header>

        <main key={page.path} className="admin-page">
          {children}
        </main>

        <nav className="admin-mobile-nav" aria-label="Navegação rápida">
          {mobileLinks.map((item) => {
            const Icon = iconMap[item.icon] ?? LayoutDashboard;
            return (
              <a
                key={item.path}
                href={routeFor(item.path)}
                className={item.path === page.path ? "active" : ""}
              >
                <Icon size={18} />
                <span>
                  {item.path === ""
                    ? "Início"
                    : item.path === "ordens-de-servico"
                      ? "OS"
                      : item.label}
                </span>
              </a>
            );
          })}
          <button type="button" onClick={() => setMobileOpen(true)}>
            <Menu size={18} />
            <span>Mais</span>
          </button>
        </nav>
      </div>

      <NotificationCenter
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onTotalChange={setNotificationsCount}
      />
    </div>
  );
}
