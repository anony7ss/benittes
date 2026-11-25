import type { Metadata } from "next";
import { LegalDocumentClient } from "@/components/public/LegalDocumentClient";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

export const metadata: Metadata = {
  title: LEGAL_DOCUMENTS.cookies.title,
  description: LEGAL_DOCUMENTS.cookies.subtitle,
};

export default function CookiesPage() {
  return <LegalDocumentClient docKey="cookies" />;
}
