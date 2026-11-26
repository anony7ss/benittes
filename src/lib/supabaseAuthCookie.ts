import { createServerClient } from "@supabase/ssr";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

export const AUTH_COOKIE_NAME = "benittes-session";

export function getAuthCookieOptions() {
  return {
    name: AUTH_COOKIE_NAME,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 400 * 24 * 60 * 60,
  };
}

export function hasAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name === AUTH_COOKIE_NAME || name.startsWith(`${AUTH_COOKIE_NAME}.`));
}

export function createSupabaseCookieClient(
  request: NextRequest,
  url: string,
  publishableKey: string,
  response?: NextResponse,
) {
  return createServerClient(url, publishableKey, {
    cookieOptions: getAuthCookieOptions(),
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        if (response) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        }
      },
    },
  });
}

export async function writeSupabaseAuthCookie(
  request: NextRequest,
  response: NextResponse,
  session: Pick<SupabaseSession, "access_token" | "refresh_token">,
  url: string,
  publishableKey: string,
) {
  const supabase = createSupabaseCookieClient(request, url, publishableKey, response);
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
}

export function clearSupabaseAuthCookies(
  request: NextRequest,
  response: NextResponse,
  projectUrl?: string,
) {
  const options = getAuthCookieOptions();
  const { name: _name, ...cookieOptions } = options;
  const names = new Set(
    request.cookies
      .getAll()
      .map(({ name }) => name)
      .filter((name) => name === AUTH_COOKIE_NAME || name.startsWith(`${AUTH_COOKIE_NAME}.`)),
  );
  names.add(AUTH_COOKIE_NAME);

  if (projectUrl) {
    try {
      const projectId = new URL(projectUrl).hostname.split(".")[0];
      const legacyName = `sb-${projectId}-auth-token`;
      for (const { name } of request.cookies.getAll()) {
        if (name === legacyName || name.startsWith(`${legacyName}.`)) names.add(name);
      }
      names.add(legacyName);
    } catch {
      // Ignore an invalid optional project URL while still clearing our cookie.
    }
  }

  for (const name of names) {
    response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
}
