import { NextRequest } from "next/server";
import { getAdminSession, migrateAdminSession, signOutAdminSession } from "../../../../lib/adminSessionApi";

export async function GET(request: NextRequest) {
  return getAdminSession(request);
}

/**
 * Exchanges a prior browser-readable session for the server-managed cookie.
 * This is only used once when migrating sessions created by older site builds
 * or completing the password-recovery PKCE flow.
 */
export async function POST(request: NextRequest) {
  return migrateAdminSession(request);
}

export async function DELETE(request: NextRequest) {
  return signOutAdminSession(request);
}
