import type { ReactNode } from "react";
import "@/styles/site.css";
import { Icon } from "@/components/public/Icon";
import { Mark } from "@/components/public/Mark";
import { SiteShell } from "@/components/public/SiteShell";

export default function SiteLayout({ children }: { children: ReactNode }) {
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
