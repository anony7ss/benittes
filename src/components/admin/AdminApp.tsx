"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useState, type MouseEvent } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import "./admin.css";
import { findAdminPage, routeFor, canSeePage, type AdminPage } from "../../admin/navigation";
import {
  fetchMyMember,
  getAdminBootstrap,
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
const AccountView = dynamic(() => import("./views/AccountView").then((module) => module.AccountView));
const AppointmentsView = dynamic(() => import("./views/AppointmentsView").then((module) => module.AppointmentsView));
const ClientsView = dynamic(() => import("./views/ClientsView").then((module) => module.ClientsView));
const ContactsView = dynamic(() => import("./views/ContactsView").then((module) => module.ContactsView));
const DashboardView = dynamic(() => import("./views/DashboardView").then((module) => module.DashboardView));
const FinanceView = dynamic(() => import("./views/FinanceView").then((module) => module.FinanceView));
const GalleryView = dynamic(() => import("./views/GalleryView").then((module) => module.GalleryView));
const InspectionsView = dynamic(() => import("./views/InspectionsView").then((module) => module.InspectionsView));
const InventoryView = dynamic(() => import("./views/InventoryView").then((module) => module.InventoryView));
const QuotesView = dynamic(() => import("./views/QuotesView").then((module) => module.QuotesView));
const PricesView = dynamic(() => import("./views/PricesView").then((module) => module.PricesView));
const ReportsView = dynamic(() => import("./views/ReportsView").then((module) => module.ReportsView));
const SalesView = dynamic(() => import("./views/SalesView").then((module) => module.SalesView));
const ServicesView = dynamic(() => import("./views/ServicesView").then((module) => module.ServicesView));
const SettingsView = dynamic(() => import("./views/SettingsView").then((module) => module.SettingsView));
const TimeClockView = dynamic(() => import("./views/TimeClockView").then((module) => module.TimeClockView));
const VehiclesView = dynamic(() => import("./views/VehiclesView").then((module) => module.VehiclesView));
const WhatsAppBotView = dynamic(() => import("./views/WhatsAppBotView").then((module) => module.WhatsAppBotView));
const WorkOrdersView = dynamic(() => import("./views/WorkOrdersView").then((module) => module.WorkOrdersView));

function clearLegacyMemberCaches() {
  if (typeof window === "undefined") return;
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith("benittes_admin_member_")) storage.removeItem(key);
      }
    }
  } catch {
    // Existing browser storage is optional and is no longer used by the panel.
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
      return <WhatsAppBotView />;
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
    case "gallery":
      return <GalleryView />;
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
  const [hasClientNavigated, setHasClientNavigated] = useState(false);

  const cleanSection = currentSection.replace(/^\/+|\/+$/g, "");
  const page = findAdminPage(cleanSection);
  const isAuthPage = page?.special === "login" || page?.special === "recovery";
  const isRecoveryPage = page?.special === "recovery";

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [member, setMember] = useState<PanelMember | null>(null);
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);
  const [memberChecked, setMemberChecked] = useState<boolean>(false);
  const [memberError, setMemberError] = useState<string>("");

  useLayoutEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/painel")) {
      setCurrentSection(sectionFromPathname(window.location.pathname));
    }
    if (!supabaseConfigured) {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      if (window.location.pathname.startsWith("/painel")) {
        setHasClientNavigated(true);
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
    let authRevision = 0;
    const loadMember = (revision: number) => {
      void fetchMyMember()
        .then((found) => {
          if (!active || authRevision !== revision) return;
          setMember(found);
          setMemberError("");
        })
        .catch((reason: Error) => {
          if (!active || authRevision !== revision) return;
          setMember(null);
          setMemberError(reason.message);
        })
        .finally(() => {
          if (active && authRevision === revision) setMemberChecked(true);
        });
    };

    clearLegacyMemberCaches();
    const unsubscribe = subscribeSession((nextSession) => {
      authRevision += 1;
      const revision = authRevision;
      setSession(nextSession);
      setMember(null);
      setAvatarPhoto(null);
      setMemberError("");
      setMemberChecked(!nextSession);
      setAuthReady(true);
      if (nextSession) {
        setMemberChecked(false);
        loadMember(revision);
      }
    });

    const bootstrapRevision = authRevision;
    void getAdminBootstrap()
      .then(({ session: nextSession, member: nextMember, avatar: nextAvatar }) => {
        if (!active || authRevision !== bootstrapRevision) return;
        setSession(nextSession);
        setMember(nextMember);
        setAvatarPhoto(nextAvatar);
        setMemberError("");
        setMemberChecked(true);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active || authRevision !== bootstrapRevision) return;
        setSession(null);
        setMember(null);
        setAvatarPhoto(null);
        setMemberChecked(true);
        setAuthReady(true);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthPage && !session) {
      const loginRoute = routeFor("login");
      window.history.replaceState({}, "", loginRoute);
      setCurrentSection("login");
    }
  }, [authReady, isAuthPage, session]);

  useEffect(() => {
    if (!authReady || !isAuthPage) return;
    if (session && member?.active && !isRecoveryPage) {
      const homeRoute = routeFor("");
      window.history.replaceState({}, "", homeRoute);
      setCurrentSection("");
    }
  }, [authReady, isAuthPage, isRecoveryPage, session, member]);

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
      setHasClientNavigated(true);
      setCurrentSection(nextSection);
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      setSession(null);
      setMember(null);
      setAvatarPhoto(null);
      setMemberChecked(true);
      const loginRoute = routeFor("login");
      window.history.replaceState({}, "", loginRoute);
      setCurrentSection("login");
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
    <div
      className={`admin-root${hasClientNavigated ? " admin-navigation-transition" : ""}`}
      onClick={handleNavigationClick}
    >
      <ProfilePhotoProvider
        key={session.user.id}
        session={session}
        initialAvatar={avatarPhoto}
      >
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
            })
          )}
        </AdminShell>
      </ProfilePhotoProvider>
      <ConfirmDialogHost />
    </div>
  );
}

export default AdminApp;
