import type { Metadata } from "next";
import { WorkshopTvClient } from "@/components/public/WorkshopTvClient";

export const metadata: Metadata = {
  title: "Painel de Serviços (TV) · Benittes Oficina Mecânica",
  robots: { index: false, follow: false },
};

export default function WorkshopTvPage() {
  return <WorkshopTvClient />;
}
