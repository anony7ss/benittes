import type { ReactNode } from "react";
import { headers } from "next/headers";
import "@/styles/site.css";
import { Icon } from "@/components/public/Icon";
import { Mark } from "@/components/public/Mark";
import { SiteShell } from "@/components/public/SiteShell";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  // Read the per-request CSP nonce so Next.js can attach it to its page scripts.
  await headers();

  return (
    <SiteShell
      mark={<Mark />}
      menuIcon={<Icon name="list" />}
      whatsappIcon={<Icon name="whatsapp-logo" size={26} />}
    >
      {children}
    </SiteShell>
  );
}
