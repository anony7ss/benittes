import type { ReactNode } from "react";
import { headers } from "next/headers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-ext-400.css";
import "@fontsource/poppins/latin-400-italic.css";
import "@fontsource/poppins/latin-ext-400-italic.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-ext-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-ext-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/poppins/latin-ext-700.css";
import "@/styles/site.css";
import { Icon } from "@/components/public/Icon";
import { Mark } from "@/components/public/Mark";
import { SiteShell } from "@/components/public/SiteShell";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  // Read the per-request CSP nonce so Next.js can attach it to its page scripts.
  await headers();

  return (
    <>
      <SiteShell
        mark={<Mark />}
        menuIcon={<Icon name="list" />}
        whatsappIcon={<Icon name="whatsapp-logo" size={26} />}
      >
        {children}
      </SiteShell>
      <SpeedInsights />
    </>
  );
}
