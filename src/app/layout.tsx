import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/global.css";
import { oficina } from "@/config/oficina";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: {
    default: oficina.nome,
    template: `%s | ${oficina.nome}`,
  },
  description:
    "Conheça a Benittes Oficina Mecânica. Orientações de manutenção, fotografias e contato.",
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  icons: { icon: "/marca.svg" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
