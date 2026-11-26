import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { hasModulePermission, normalizePanelPermissions, type PanelPermissions } from "../admin/permissions";
import { getAuthCookieOptions } from "./supabaseAuthCookie";

export function getSupabaseEnv() {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  return { url, anonKey, serviceRoleKey };
}

export function getUserSupabase(authHeader: string | null) {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) throw new Error("Supabase não configurado no servidor.");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
  });
}

export function getServiceSupabase() {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const key = serviceRoleKey;
  if (!url || !key) throw new Error("Supabase não configurado no servidor.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requirePanelStaff(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) return null;

  // Keep accepting bearer tokens for older clients while the site migrates to
  // the server-managed HttpOnly session cookie.
  const supabase = token
    ? getUserSupabase(authHeader)
    : createServerClient(url, anonKey, {
        cookieOptions: getAuthCookieOptions(),
        auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
        cookies: {
          getAll: () => request.cookies.getAll(),
          // Proxy refreshes sessions and persists rotated cookies before the
          // route handler runs. This request-scoped client only verifies them.
          setAll: () => {},
        },
      });
  const { data: userData, error: userErr } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();
  if (userErr || !userData.user) return null;

  const { data: member } = await supabase
    .from("panel_members")
    .select(
      "user_id,email,full_name,role,active,created_at,updated_at,phone,two_factor_enabled,role_config:panel_roles!panel_members_role_fkey(name,permissions)",
    )
    .eq("user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (!member) return null;
  const { role_config: roleConfigValue, ...memberData } = member;
  const roleConfig = roleConfigValue as { name?: string | null; permissions?: unknown } | null;
  const permissions = normalizePanelPermissions(roleConfig?.permissions);
  return {
    user: userData.user,
    member: { ...memberData, role_name: roleConfig?.name ?? member.role, permissions },
    supabase,
  };
}

export function isPanelOwnerOrManager(member: { role?: unknown } | null | undefined): boolean {
  return member?.role === "owner" || member?.role === "manager";
}

export function hasPanelPermission(
  member: { role?: unknown; permissions?: PanelPermissions | null } | null | undefined,
  module: string,
  access: "read" | "write" = "read",
): boolean {
  if (member?.role === "owner") return true;
  return hasModulePermission(member?.permissions, module, access);
}

export function normalizeBrPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 11 && !digits.startsWith("55") ? `55${digits}` : digits;
}
