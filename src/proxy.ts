import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getAuthCookieOptions, hasAuthCookie } from "./lib/supabaseAuthCookie";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? " ws://localhost:* ws://127.0.0.1:* ws://192.168.0.103:*" : ""}`,
    "frame-src 'self' https://maps.google.com https://www.google.com",
    "media-src 'self' data: blob: https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabaseUrl = (
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || ""
  ).replace(/\/$/, "");
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  const pathname = request.nextUrl.pathname;
  const isAdminRequest =
    pathname === "/painel" ||
    pathname.startsWith("/painel/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/");

  if (isAdminRequest && supabaseUrl && publishableKey && hasAuthCookie(request)) {
    const supabase = createServerClient(supabaseUrl, publishableKey, {
      cookieOptions: getAuthCookieOptions(),
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          requestHeaders.set("cookie", request.cookies.toString());
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    });

    // Inspect expiry locally and refresh only near expiration. Protected API
    // routes still validate the user with Supabase before accessing panel data.
    try {
      const { data, error } = await supabase.auth.getSession();
      const expiresAt = data.session?.expires_at;
      const refreshWindow = Math.floor(Date.now() / 1000) + 120;
      if (error || !Number.isFinite(expiresAt) || (expiresAt ?? 0) <= refreshWindow) {
        await supabase.auth.getClaims().catch(() => undefined);
      }
    } catch {
      // Session refresh is best-effort; the protected route performs its own check.
    }
  }

  response.headers.set("Content-Security-Policy", policy);
  if (pathname.startsWith("/api/admin/")) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
