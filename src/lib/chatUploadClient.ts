"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let uploadClient: SupabaseClient | null = null;

export function getChatUploadClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("O envio de arquivos ainda não está configurado.");
  if (!uploadClient) {
    uploadClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return uploadClient;
}
