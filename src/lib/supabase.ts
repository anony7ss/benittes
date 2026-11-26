import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PanelPermissions } from "../admin/permissions";

export type Session = { user: { id: string; email?: string | null } };
export type AdminBootstrap = { session: Session | null; member: PanelMember | null };

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
const RECOVERY_COOKIE_NAME = "benittes-recovery";
let legacyClient: SupabaseClient | null = null;
let recoveryClient: SupabaseClient | null = null;
let bootstrapRequest: Promise<AdminBootstrap> | null = null;
const sessionListeners = new Set<(session: Session | null) => void>();

function toSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { session?: { user?: { id?: unknown; email?: unknown } | null } | null };
  const user = payload.session?.user;
  if (!user || typeof user.id !== "string") return null;
  return {
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
    },
  };
}

function toPanelMember(value: unknown, userId: string): PanelMember | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PanelMember>;
  if (row.user_id !== userId || typeof row.role !== "string" || typeof row.active !== "boolean") return null;

  return {
    user_id: userId,
    email: typeof row.email === "string" ? row.email : "",
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    role: row.role,
    role_name: typeof row.role_name === "string" ? row.role_name : row.role,
    permissions: row.permissions ?? null,
    active: row.active,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function publishSession(session: Session | null) {
  for (const listener of sessionListeners) listener(session);
}

function browserCookieOptions(name: string) {
  return {
    name,
    path: "/",
    sameSite: "lax" as const,
    secure: window.location.protocol === "https:",
  };
}

function getLegacyClient() {
  if (!url || !publishableKey) throw new Error("O acesso ao painel ainda não foi configurado.");
  if (!legacyClient) {
    const projectId = new URL(url).hostname.split(".")[0];
    legacyClient = createBrowserClient(url, publishableKey, {
      isSingleton: false,
      cookieOptions: browserCookieOptions(`sb-${projectId}-auth-token`),
      auth: { autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce", persistSession: true },
    });
  }
  return legacyClient;
}

function getRecoveryClient() {
  if (!url || !publishableKey) throw new Error("O acesso ao painel ainda não foi configurado.");
  if (!recoveryClient) {
    recoveryClient = createBrowserClient(url, publishableKey, {
      isSingleton: false,
      cookieOptions: browserCookieOptions(RECOVERY_COOKIE_NAME),
      auth: { autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", persistSession: true },
    });
  }
  return recoveryClient;
}

function expireBrowserCookieFamily(prefix: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const names = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .filter((name) => name === prefix || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}-`));
  for (const name of names) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

function clearLegacySessionRemnants() {
  if (typeof window === "undefined" || !url) return;
  try {
    const projectId = new URL(url).hostname.split(".")[0];
    window.localStorage.removeItem(`sb-${projectId}-auth-token`);
    expireBrowserCookieFamily(`sb-${projectId}-auth-token`);
  } catch {
    // The HttpOnly cookie remains the only active session even if cleanup is blocked.
  }
}

async function migrateLegacySession(): Promise<Session | null> {
  if (typeof window === "undefined" || !url || !publishableKey) return null;

  let projectId = "";
  let refreshToken = "";
  let storageKey = "";
  try {
    projectId = new URL(url).hostname.split(".")[0];
    storageKey = `sb-${projectId}-auth-token`;
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const stored = JSON.parse(raw) as { refresh_token?: unknown; currentSession?: { refresh_token?: unknown } };
      const storedToken = stored.refresh_token ?? stored.currentSession?.refresh_token;
      if (typeof storedToken === "string") refreshToken = storedToken;
    }
  } catch {
    // A malformed legacy value is ignored; the cookie migration can still run.
  }

  if (!refreshToken) {
    try {
      const { data, error } = await getLegacyClient().auth.getSession();
      if (!error && data.session?.refresh_token) refreshToken = data.session.refresh_token;
    } catch {
      // There may be no legacy cookie on this browser.
    }
  }
  if (!refreshToken) return null;

  const response = await fetch("/api/admin/session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = (await response.json().catch(() => ({}))) as { session?: unknown; error?: string };
  if (response.status === 401) {
    clearLegacySessionRemnants();
    return null;
  }
  if (!response.ok) return null;
  const session = toSession(body);
  if (!session) return null;

  try {
    if (storageKey) window.localStorage.removeItem(storageKey);
  } catch {
    // The new HttpOnly session is already active; inaccessible storage is harmless.
  }
  if (projectId) expireBrowserCookieFamily(`sb-${projectId}-auth-token`);
  return session;
}

async function requestServerSession() {
  return fetch("/api/admin/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
}

async function loadServerBootstrap(): Promise<AdminBootstrap> {
  let response = await requestServerSession();
  if (response.status === 401) {
    const migratedSession = await migrateLegacySession();
    if (!migratedSession) return { session: null, member: null };
    response = await requestServerSession();
  }

  const body = (await response.json().catch(() => ({}))) as {
    session?: unknown;
    member?: unknown;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || "Não foi possível verificar sua sessão.");
  const session = toSession(body);
  if (!session) {
    clearLegacySessionRemnants();
    return { session: null, member: null };
  }

  clearLegacySessionRemnants();
  return { session, member: toPanelMember(body.member, session.user.id) };
}

export async function getAdminBootstrap(): Promise<AdminBootstrap> {
  if (!supabaseConfigured || typeof window === "undefined") return { session: null, member: null };
  if (bootstrapRequest) return bootstrapRequest;

  bootstrapRequest = loadServerBootstrap()
    .finally(() => {
      bootstrapRequest = null;
    });
  return bootstrapRequest;
}

export function subscribeSession(callback: (session: Session | null) => void) {
  sessionListeners.add(callback);
  return () => sessionListeners.delete(callback);
}

export async function signIn(email: string, password: string): Promise<{
  session: Session | null;
  requires2FA?: boolean;
  tempToken?: string;
  maskedPhone?: string;
}> {
  const res = await fetch("/api/admin/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as {
    session?: unknown;
    requires2FA?: boolean;
    tempToken?: string;
    maskedPhone?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || "Não foi possível entrar.");
  if (json.requires2FA && json.tempToken) {
    return { session: null, requires2FA: true, tempToken: json.tempToken, maskedPhone: json.maskedPhone || "****" };
  }
  const session = toSession(json);
  if (!session) throw new Error(json.error || "Não foi possível entrar.");
  publishSession(session);
  return { session };
}

export async function verifyLogin2FA(payload: {
  email: string;
  password: string;
  tempToken: string;
  code: string;
}) {
  const res = await fetch("/api/admin/login/verify-2fa", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { session?: unknown; error?: string };
  const session = toSession(json);
  if (!res.ok || !session) throw new Error(json.error || "Código inválido.");
  publishSession(session);
  return session;
}

export async function resendLogin2FA(email: string, tempToken: string) {
  const res = await fetch("/api/admin/login/resend-2fa", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, tempToken }),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(json.error || "Não foi possível reenviar o código.");
}

export async function signOut() {
  const response = await fetch("/api/admin/session", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Não foi possível encerrar a sessão.");
  publishSession(null);
}

export async function requestPasswordReset(email: string) {
  const redirectTo = `${window.location.origin}/painel/recuperar-senha/`;
  const { error } = await getRecoveryClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function exchangeRecoveryCode() {
  const { data, error } = await getRecoveryClient().auth.getSession();
  if (error) throw error;
  if (!data.session?.refresh_token) return null;

  const response = await fetch("/api/admin/session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: data.session.refresh_token }),
  });
  const body = (await response.json().catch(() => ({}))) as { session?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error || "Não foi possível validar o link de recuperação.");
  const session = toSession(body);
  if (!session) throw new Error("Não foi possível validar o link de recuperação.");

  expireBrowserCookieFamily(RECOVERY_COOKIE_NAME);
  publishSession(session);
  return session;
}

export async function updatePassword(password: string) {
  const response = await fetch("/api/admin/account/password", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Não foi possível atualizar a senha.");
}

async function authHeaders(): Promise<Record<string, string>> {
  return { "Content-Type": "application/json" };
}

async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
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
