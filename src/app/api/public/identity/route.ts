import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhatsapp(value: unknown): string {
  const digits = asText(value).replace(/\D/g, "");
  if (!/^[1-9]\d{9,14}$/.test(digits)) return "";
  return digits.length <= 11 && !digits.startsWith("55") ? `55${digits}` : digits;
}

async function loadEstablishmentDetails(): Promise<Record<string, unknown>> {
  try {
    const { data } = await getServiceSupabase()
      .from("workshop_settings")
      .select("value")
      .eq("key", "estabelecimento")
      .maybeSingle();
    return asRecord(asRecord(data?.value).details);
  } catch {
    return {};
  }
}

export async function GET() {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  if (!url || !key) {
    return NextResponse.json({ identity: null }, noStore);
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [identityResult, establishment] = await Promise.all([
      supabase
        .from("site_content")
        .select("value")
        .eq("key", "identidade")
        .eq("enabled", true)
        .maybeSingle(),
      loadEstablishmentDetails(),
    ]);
    const { data, error } = identityResult;
    if (error) return NextResponse.json({ identity: null }, noStore);

    const identity = data?.value;
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      return NextResponse.json({ identity: null }, noStore);
    }

    // The public contact form in Settings is stored in workshop_settings,
    // while the site editor stores visual identity in site_content. Merge only
    // the explicitly public contact fields; never return the full settings row.
    const published = { ...asRecord(identity) };
    const name = asText(establishment.nome) || asText(published.nome);
    const whatsapp = normalizeWhatsapp(establishment.whatsapp) || normalizeWhatsapp(published.whatsapp);
    const email = asText(establishment.email) || asText(published.email);
    const instagram = asText(establishment.instagram) || asText(published.instagram);

    if (name) published.nome = name;
    if (whatsapp) published.whatsapp = whatsapp;
    if (email) published.email = email;
    if (instagram) published.instagram = instagram;

    return NextResponse.json({ identity: published }, noStore);
  } catch {
    return NextResponse.json({ identity: null }, noStore);
  }
}
