import { createBrowserClient } from "@supabase/ssr";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { PanelPermissions } from "../admin/permissions";

export type { Session } from "@supabase/supabase-js";

export type PanelStatus = "novo" | "em_andamento" | "aguardando" | "concluido" | "cancelado";

export type PanelRecord = {
  id: string;
  module: string;
  title: string;
  status: PanelStatus | string;
  description: string | null;
  amount: number | null;
  customer_name: string | null;
  customer_email: string | null;
  phone: string | null;
  vehicle: string | null;
  details: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  message: string;
  status: "new" | "read" | "replied" | "archived";
  created_at: string;
};

export type PanelMember = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: "owner" | "manager" | "advisor" | "technician" | "finance" | string;
  role_name?: string;
  permissions?: PanelPermissions | null;
  active: boolean;
  created_at: string;
};

export type SiteContent = {
  key: string;
  value: Record<string, unknown>;
  enabled: boolean;
  updated_at: string;
};

export type AuditEntry = {
  id: string;
  actor_email: string | null;
  action: string;
  module: string;
  record_title: string | null;
  created_at: string;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(url && publishableKey);
let client: SupabaseClient | null = null;
let legacySessionMigration: Promise<void> | null = null;

function getClient() {
  if (!url || !publishableKey) throw new Error("O acesso ao painel ainda não foi configurado.");
  if (!client) {
    client = createBrowserClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
    });
  }
  return client;
}

async function migrateLegacyLocalStorageSession() {
  if (typeof window === "undefined" || !url) return;
  if (legacySessionMigration) return legacySessionMigration;

  try {
    const projectId = new URL(url).hostname.split(".")[0];
    const storageKey = `sb-${projectId}-auth-token`;
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;

    legacySessionMigration = (async () => {
      try {
        const legacy = JSON.parse(stored) as Partial<Session>;
        if (typeof legacy.access_token !== "string" || typeof legacy.refresh_token !== "string") {
          window.localStorage.removeItem(storageKey);
          return;
        }

        const supabase = getClient();
        const { data: current, error: readError } = await supabase.auth.getSession();
        if (readError) throw readError;

        if (!current.session) {
          const { error } = await supabase.auth.setSession({
            access_token: legacy.access_token,
            refresh_token: legacy.refresh_token,
          });
          if (error) throw error;
        }

        window.localStorage.removeItem(storageKey);
      } catch {
        // Keep the legacy value if migration fails temporarily; retry next load.
        legacySessionMigration = null;
      }
    })();

    return legacySessionMigration;
  } catch {
    return;
  }
}

export async function getSession() {
  const supabase = getClient();
  await migrateLegacyLocalStorageSession();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function subscribeSession(callback: (session: Session | null) => void) {
  const {
    data: { subscription },
  } = getClient().auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<{
  session: Session | null;
  requires2FA?: boolean;
  tempToken?: string;
  maskedPhone?: string;
}> {
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as {
    session?: Session | null;
    requires2FA?: boolean;
    tempToken?: string;
    maskedPhone?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || "Não foi possível entrar.");
  }
  if (json.requires2FA && json.tempToken) {
    return {
      session: null,
      requires2FA: true,
      tempToken: json.tempToken,
      maskedPhone: json.maskedPhone || "****",
    };
  }
  if (!json.session) {
    throw new Error(json.error || "Não foi possível entrar.");
  }
  const { data, error } = await getClient().auth.setSession({
    access_token: json.session.access_token,
    refresh_token: json.session.refresh_token,
  });
  if (error) throw error;
  return { session: data.session };
}

export async function verifyLogin2FA(payload: {
  email: string;
  password: string;
  tempToken: string;
  code: string;
}) {
  const res = await fetch("/api/admin/login/verify-2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { session?: Session | null; error?: string };
  if (!res.ok || !json.session) {
    throw new Error(json.error || "Código inválido.");
  }
  const { data, error } = await getClient().auth.setSession({
    access_token: json.session.access_token,
    refresh_token: json.session.refresh_token,
  });
  if (error) throw error;
  return data.session;
}

export async function resendLogin2FA(email: string, tempToken: string) {
  const res = await fetch("/api/admin/login/resend-2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, tempToken }),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(json.error || "Não foi possível reenviar o código.");
  }
}

export async function signOut() {
  const { error } = await getClient().auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email: string) {
  const redirectTo = `${window.location.origin}/painel/recuperar-senha/`;
  const { error } = await getClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function exchangeRecoveryCode() {
  const { data, error } = await getClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function updatePassword(password: string) {
  const { error } = await getClient().auth.updateUser({ password });
  if (error) throw error;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = await getSession().catch(() => null);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Erro na requisição (${res.status}).`);
  }
  return body;
}

function resolveResource(table: string, params: Record<string, string> = {}) {
  const rest = { ...params };
  if (table === "panel_records" && rest.module?.startsWith("eq.")) {
    const mod = rest.module.slice(3);
    delete rest.module;
    if (rest.order === "created_at.desc") delete rest.order;
    if (rest.limit === "500" || rest.limit === "200") delete rest.limit;
    return { resource: mod, query: rest };
  }
  const aliasMap: Record<string, string> = {
    contact_messages: "contacts",
    panel_members: "members",
    audit_logs: "audit",
    site_content: "content",
  };
  if (rest.order === "created_at.desc") delete rest.order;
  if (rest.limit === "500" || rest.limit === "200") delete rest.limit;
  return { resource: aliasMap[table] ?? table, query: rest };
}

export async function fetchMyMember() {
  const headers = await authHeaders();
  const res = await apiRequest<{ member: PanelMember | null }>("/api/admin/me", { headers });
  return res.member;
}

export async function fetchDashboard() {
  const headers = await authHeaders();
  return apiRequest<{
    messages: ContactMessage[];
    clients: PanelRecord[];
    appointments: PanelRecord[];
    workOrders: PanelRecord[];
    inventory: PanelRecord[];
    sales: PanelRecord[];
  }>("/api/admin/dashboard", { headers });
}

export async function fetchAlerts() {
  const headers = await authHeaders();
  return apiRequest<{
    messages: ContactMessage[];
    appointments: PanelRecord[];
    inventory: PanelRecord[];
    finance: PanelRecord[];
  }>("/api/admin/alerts", { headers });
}

export async function selectRows<T>(table: string, params: Record<string, string> = {}) {
  const { resource, query } = resolveResource(table, params);
  const qs = new URLSearchParams(query).toString();
  const endpoint = `/api/admin/${encodeURIComponent(resource)}${qs ? `?${qs}` : ""}`;
  const headers = await authHeaders();
  const body = await apiRequest<{ data?: T[] }>(endpoint, { headers });
  return body.data ?? [];
}

export async function insertRow<T>(table: string, value: Record<string, unknown>) {
  const resource =
    table === "panel_records" && typeof value.module === "string"
      ? value.module
      : resolveResource(table).resource;
  const endpoint = `/api/admin/${encodeURIComponent(resource)}`;
  const headers = await authHeaders();
  const body = await apiRequest<{ data?: T[] }>(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
  return body.data ?? [];
}

export async function updateRow<T>(table: string, id: string, value: Record<string, unknown>, idColumn = "id") {
  const { resource } = resolveResource(table);
  const qs = idColumn === "id" ? new URLSearchParams({ id }).toString() : new URLSearchParams({ id, idColumn }).toString();
  const endpoint = `/api/admin/${encodeURIComponent(resource)}?${qs}`;
  const headers = await authHeaders();
  const body = await apiRequest<{ data?: T[] }>(endpoint, {
    method: "PATCH",
    headers,
    body: JSON.stringify(value),
  });
  return body.data ?? [];
}

export async function deleteRow(table: string, id: string, idColumn = "id") {
  const { resource } = resolveResource(table);
  const qs = idColumn === "id" ? new URLSearchParams({ id }).toString() : new URLSearchParams({ id, idColumn }).toString();
  const endpoint = `/api/admin/${encodeURIComponent(resource)}?${qs}`;
  const headers = await authHeaders();
  await apiRequest<{ ok?: boolean }>(endpoint, {
    method: "DELETE",
    headers,
  });
}
