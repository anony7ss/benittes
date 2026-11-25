import type { Metadata } from "next";
import { LegalDocumentClient } from "@/components/public/LegalDocumentClient";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

export const metadata: Metadata = {
  title: LEGAL_DOCUMENTS.termos.title,
  description: LEGAL_DOCUMENTS.termos.subtitle,
};

export default function TermosPage() {
  return <LegalDocumentClient docKey="termos" />;
}
