import type { Metadata } from "next";
import { QuoteSheetClient } from "@/components/public/QuoteSheetClient";

export const metadata: Metadata = {
  title: "Ficha do Orçamento · Benittes Oficina Mecânica",
  description: "Aprove seu orçamento online e acompanhe o andamento do serviço em tempo real.",
  robots: { index: false, follow: false },
};

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <QuoteSheetClient token={token} />;
}
