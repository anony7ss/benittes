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

const themeInitScript = `try{var d=localStorage.getItem('admin-theme')==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.backgroundColor=d?'#11110f':'#efefeb';}catch(e){document.documentElement.classList.remove('dark');document.documentElement.style.backgroundColor='#efefeb';}`;

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      {children}
      <SpeedInsights />
    </>
  );
}
