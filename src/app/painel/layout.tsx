import type { ReactNode } from "react";
import { headers } from "next/headers";

const themeInitScript = `try{var d=localStorage.getItem('admin-theme')!=='light';document.documentElement.classList.toggle('dark',d);document.documentElement.style.backgroundColor=d?'#11110f':'#efefeb';}catch(e){document.documentElement.classList.add('dark');}`;

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      {children}
    </>
  );
}
