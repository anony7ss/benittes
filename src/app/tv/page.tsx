import type { Metadata } from "next";
import { connection } from "next/server";
import { WorkshopTvClient } from "@/components/public/WorkshopTvClient";

export const metadata: Metadata = {
  title: "Painel de Serviços (TV) · Benittes Oficina Mecânica",
  robots: { index: false, follow: false },
};

export default async function WorkshopTvPage() {
  // This route uses a per-request CSP nonce from proxy.ts. Rendering it at
  // request time lets Next attach that nonce to its hydration scripts.
  await connection();
  return <WorkshopTvClient />;
}
