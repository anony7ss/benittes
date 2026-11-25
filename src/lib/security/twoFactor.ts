import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseEnv } from "../supabaseAdmin";

export function hashTwoFactorCode(userId: string, code: string): string {
  const { serviceRoleKey } = getSupabaseEnv();
  const secret = process.env.TWO_FACTOR_HMAC_SECRET || process.env.RATE_LIMIT_HMAC_SECRET || serviceRoleKey;
  if (!secret || secret.length < 32) throw new Error("Two-factor signing key is not configured.");
  return createHmac("sha256", secret).update(`benittes-2fa\0${userId}\0${code}`).digest("hex");
}

export function safeHashEquals(left: unknown, right: string): boolean {
  if (typeof left !== "string" || !/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const AUTH_ERROR = "Não foi possível autenticar. Confira os dados e tente novamente.";
