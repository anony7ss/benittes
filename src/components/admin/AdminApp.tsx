"use client";

import { useEffect, useLayoutEffect, useState, type MouseEvent } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import "./admin.css";
import { findAdminPage, routeFor, canSeePage, type AdminPage } from "../../admin/navigation";
import {
  fetchMyMember,
  getSession,
  readStoredSession,
  signOut,
  subscribeSession,
  supabaseConfigured,
  type PanelMember,
  type Session,
} from "../../lib/supabase";
import { ProfilePhotoProvider } from "./ProfilePhoto";
import { AdminShell } from "./AdminShell";
import { ConfirmDialogHost } from "./ConfirmDialog";
import { LoginForm } from "./LoginForm";
import { AccountView } from "./views/AccountView";
import { AppointmentsView } from "./views/AppointmentsView";
import { ClientsView } from "./views/ClientsView";
import { ContactsView } from "./views/ContactsView";
import { DashboardView } from "./views/DashboardView";
import { FinanceView } from "./views/FinanceView";
import { InspectionsView } from "./views/InspectionsView";
import { InventoryView } from "./views/InventoryView";
import { QuotesView } from "./views/QuotesView";
import { PricesView } from "./views/PricesView";
import { ReportsView } from "./views/ReportsView";
import { SalesView } from "./views/SalesView";
import { ServicesView } from "./views/ServicesView";
import { SettingsView } from "./views/SettingsView";
import { TimeClockView } from "./views/TimeClockView";
import { VehiclesView } from "./views/VehiclesView";
import { WhatsAppBotView } from "./views/WhatsAppBotView";
import { WorkOrdersView } from "./views/WorkOrdersView";

const MEMBER_CACHE_PREFIX = "benittes_admin_member_";

function readCachedMember(userId: string | undefined): PanelMember | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(`${MEMBER_CACHE_PREFIX}${userId}`) ??
      window.sessionStorage.getItem(`${MEMBER_CACHE_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as PanelMember) : null;
  } catch {
    return null;
  }
}

function writeCachedMember(userId: string, member: PanelMember | null) {
  if (typeof window === "undefined") return;
  try {
    const key = `${MEMBER_CACHE_PREFIX}${userId}`;
    if (member) {
      const json = JSON.stringify(member);
      window.localStorage.setItem(key, json);
      window.sessionStorage.setItem(key, json);
    } else {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

function sectionFromPathname(pathname: string): string {
  return pathname.replace(/^\/painel\/?/, "").replace(/^\/+|\/+$/g, "");
}

function renderPageView(
  page: AdminPage,
  session: Session,
  member: PanelMember,
  onMemberUpdate: (next: PanelMember) => void,
) {
  switch (page.special) {
    case "dashboard":
      return <DashboardView />;
    case "contacts":
      return <ContactsView />;
    case "settings":
      return <SettingsView session={session} />;
    case "bot":
      return <WhatsAppBotView session={session} />;
    case "account":
      return <AccountView session={session} member={member} onMemberUpdate={onMemberUpdate} />;
    case "ponto":
      return <TimeClockView session={session} member={member} />;
  }

  switch (page.module) {
    case "work-orders":
      return <WorkOrdersView session={session} />;
    case "appointments":
      return <AppointmentsView session={session} />;
    case "quotes":
      return <QuotesView session={session} />;
    case "inspections":
      return <InspectionsView session={session} />;
    case "clients":
      return <ClientsView session={session} />;
    case "vehicles":
      return <VehiclesView session={session} />;
    case "services":
      return <ServicesView session={session} />;
    case "prices":
      return <PricesView session={session} />;
    case "inventory":
      return <InventoryView session={session} />;
    case "finance":
      return <FinanceView session={session} />;
    case "sales":
      return <SalesView session={session} />;
    case "reports":
      return <ReportsView />;
    default:
      return (
        <div className="admin-panel">
          <div className="admin-empty">
            <strong>Módulo não encontrado</strong>
            <p>A rota solicitada não possui visualização configurada.</p>
          </div>
        </div>
      );
  }
}

export function AdminApp({ section }: { section?: string }) {
  const [currentSection, setCurrentSection] = useState<string>(() =>
    (section ?? "").replace(/^\/+|\/+$/g, ""),
  );

  const cleanSection = currentSection.replace(/^\/+|\/+$/g, "");
  const page = findAdminPage(cleanSection);
  const isAuthPage = page?.special === "login" || page?.special === "recovery";

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [member, setMember] = useState<PanelMember | null>(null);
  const [memberChecked, setMemberChecked] = useState<boolean>(false);
  const [memberError, setMemberError] = useState<string>("");

  useLayoutEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/painel")) {
      setCurrentSection(sectionFromPathname(window.location.pathname));
    }
    const stored = readStoredSession();
    if (stored) {
      const cached = readCachedMember(stored.user.id);
      setSession(stored);
      setMember(cached);
      setMemberChecked(Boolean(cached));
      setAuthReady(true);
    } else if (!supabaseConfigured) {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      if (window.location.pathname.startsWith("/painel")) {
        setCurrentSection(sectionFromPathname(window.location.pathname));
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !page) return;
    document.title = page.label
      ? `${page.label} | Painel Benittes`
      : "Painel | Benittes Oficina Mecânica";
  }, [page]);

  useEffect(() => {
    if (!supabaseConfigured) return;

    let active = true;
    void getSession()
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setAuthReady(true);
      });

    const unsubscribe = subscribeSession((nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setMember(null);
      setMemberChecked(false);
      setMemberError("");
      return;
    }

    const cached = readCachedMember(session.user.id);
    if (cached) {
      setMember(cached);
      setMemberChecked(true);
    }

    let active = true;
    setMemberError("");

    void fetchMyMember()
      .then((found) => {
        if (!active) return;
        setMember(found);
        writeCachedMember(session.user.id, found);
      })
      .catch((reason: Error) => {
        if (!active) return;
        if (!cached) {
          setMember(null);
          setMemberError(reason.message);
        }
      })
      .finally(() => {
        if (!active) return;
        setMemberChecked(true);
      });

    return () => {
      active = false;
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthPage && !session) {
      window.location.replace(routeFor("login"));
    }
  }, [authReady, isAuthPage, session]);

  useEffect(() => {
    if (!authReady || !isAuthPage) return;
    if (session && member?.active) {
      window.location.replace(routeFor(""));
    }
  }, [authReady, isAuthPage, session, member]);

  function handleNavigationClick(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/painel")) return;
    if (href.startsWith("/painel/login") || href.startsWith("/painel/recuperar-senha")) return;

    const nextSection = sectionFromPathname(href);
    event.preventDefault();
    if (nextSection !== cleanSection) {
      window.history.pushState({}, "", href);
      setCurrentSection(nextSection);
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }

  async function handleSignOut() {
    const userId = session?.user.id;
    try {
      await signOut();
    } finally {
      if (userId) writeCachedMember(userId, null);
      setSession(null);
      setMember(null);
      window.location.assign(routeFor("login"));
    }
  }

  if (isAuthPage) {
    return (
      <div className="admin-root admin-login-light">
        <LoginForm recovery={page?.special === "recovery"} />
      </div>
    );
  }

  const activePage: AdminPage =
    page ?? {
      path: cleanSection,
      label: "Página não encontrada",
      group: "Operação",
      icon: "dashboard",
    };

  if (!authReady || (session && !member && !memberChecked)) {
    return <div className="admin-root" />;
  }

  if (!session) {
    return (
      <div className="admin-root admin-login-light">
        <LoginForm />
      </div>
    );
  }

  if (!member || !member.active) {
    return (
      <div className="admin-root">
        <main className="admin-login-page">
          <div className="admin-login-form">
            <p className="admin-kicker">BENITTES · ACESSO RESTRITO</p>
            <h1>Acesso pendente ou não autorizado</h1>
            <p className="admin-login-sub">
              {memberError ||
                "Sua conta está autenticada, mas ainda não possui um perfil ativo na equipe da oficina."}
            </p>
            <button
              type="button"
              className="admin-primary"
              style={{ width: "100%", height: 44 }}
              onClick={() => void handleSignOut()}
            >
              <LogOut size={16} /> Sair da conta
            </button>
          </div>
        </main>
      </div>
    );
  }

  const allowed = page ? canSeePage(member.role, page, member.permissions) : true;

  return (
    <div className="admin-root" onClick={handleNavigationClick}>
      <ProfilePhotoProvider key={session.user.id} session={session}>
        <AdminShell
          page={activePage}
          role={member.role}
          permissions={member.permissions}
          email={session.user.email ?? ""}
          fullName={member.full_name}
          onSignOut={() => void handleSignOut()}
        >
          {!page ? (
            <div className="admin-panel">
              <div className="admin-empty">
                <strong>Página não encontrada</strong>
                <p>O módulo solicitado não existe no painel.</p>
              </div>
            </div>
          ) : !allowed ? (
            <div className="admin-panel">
              <div className="admin-empty">
                <ShieldAlert size={24} style={{ marginBottom: 8 }} />
                <strong>Sem permissão para este módulo</strong>
                <p>Solicite acesso ao proprietário ou gerente da oficina.</p>
              </div>
            </div>
          ) : (
            renderPageView(page, session, member, (next) => {
              setMember(next);
              writeCachedMember(session.user.id, next);
            })
          )}
        </AdminShell>
      </ProfilePhotoProvider>
      <ConfirmDialogHost />
    </div>
  );
}

export default AdminApp;
