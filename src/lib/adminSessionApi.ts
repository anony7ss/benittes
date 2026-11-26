import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  clientAddress,
  enforceRateLimits,
  invalidOriginResponse,
  isSameOriginRequest,
  readBoundedJson,
  rateLimitedResponse,
} from "./security/http";
import { getServiceSupabase, getSupabaseEnv, requirePanelStaff } from "./supabaseAdmin";
import {
  clearSupabaseAuthCookies,
  createSupabaseCookieClient,
  writeSupabaseAuthCookie,
} from "./supabaseAuthCookie";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" },
  });
}

function publicSession(user: { id: string; email?: string | null }) {
  return { user: { id: user.id, email: user.email ?? null } };
}

export async function getAdminSession(request: NextRequest) {
  try {
    const staff = await requirePanelStaff(request);
    if (!staff) return privateJson({ session: null, error: "Sem sessão ativa." }, 401);
    return privateJson({ session: publicSession(staff.user) });
  } catch {
    return privateJson({ error: "Autenticação temporariamente indisponível." }, 503);
  }
}

/** Exchanges a legacy browser-readable session for the server-managed cookie. */
export async function migrateAdminSession(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();

  const parsed = await readBoundedJson<{ refresh_token?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const refreshToken = typeof parsed.value?.refresh_token === "string" ? parsed.value.refresh_token : "";
  if (!refreshToken || refreshToken.length > 4096 || /[\r\n]/.test(refreshToken)) {
    return privateJson({ error: "Sessão inválida." }, 401);
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "session-migration-ip", subject: clientAddress(request), maxHits: 20, windowSeconds: 900 },
    ]))) return rateLimitedResponse();

    const { url, anonKey } = getSupabaseEnv();
    if (!url || !anonKey) return privateJson({ error: "Autenticação temporariamente indisponível." }, 503);
    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session?.user) return privateJson({ error: "Sessão inválida." }, 401);

    const service = getServiceSupabase();
    const { data: member, error: memberError } = await service
      .from("panel_members")
      .select("user_id")
      .eq("user_id", data.session.user.id)
      .eq("active", true)
      .maybeSingle();
    if (memberError) return privateJson({ error: "Autenticação temporariamente indisponível." }, 503);
    if (!member) return privateJson({ error: "Sessão inválida." }, 401);

    const response = privateJson({ session: publicSession(data.session.user) });
    await writeSupabaseAuthCookie(request, response, data.session, url, anonKey);
    return response;
  } catch {
    return privateJson({ error: "Autenticação temporariamente indisponível." }, 503);
  }
}

export async function signOutAdminSession(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();

  const { url, anonKey } = getSupabaseEnv();
  const response = privateJson({ ok: true });
  if (url && anonKey) {
    try {
      const supabase = createSupabaseCookieClient(request, url, anonKey, response);
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Cookie clearing must complete even when Supabase is unavailable.
    }
  }
  clearSupabaseAuthCookies(request, response, url);
  return response;
}
