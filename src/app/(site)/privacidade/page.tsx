import type { Metadata } from "next";
import { LegalDocumentClient } from "@/components/public/LegalDocumentClient";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

export const metadata: Metadata = {
  title: LEGAL_DOCUMENTS.privacidade.title,
  description: LEGAL_DOCUMENTS.privacidade.subtitle,
};

export default function PrivacidadePage() {
  return <LegalDocumentClient docKey="privacidade" />;
}
