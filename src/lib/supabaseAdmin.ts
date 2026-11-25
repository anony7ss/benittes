import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

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
  const { url, anonKey, serviceRoleKey } = getSupabaseEnv();
  const key = serviceRoleKey || anonKey;
  if (!url || !key) throw new Error("Supabase não configurado no servidor.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requirePanelStaff(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const supabase = getUserSupabase(authHeader);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) return null;

  const { data: member } = await supabase
    .from("panel_members")
    .select("*")
    .eq("user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (!member) return null;
  return { user: userData.user, member, supabase };
}

export function normalizeBrPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 11 && !digits.startsWith("55") ? `55${digits}` : digits;
}
