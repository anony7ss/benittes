import type { ReactNode } from "react";

const themeInitScript = `try{var d=localStorage.getItem('admin-theme')!=='light';document.documentElement.classList.toggle('dark',d);document.documentElement.style.backgroundColor=d?'#11110f':'#efefeb';}catch(e){document.documentElement.classList.add('dark');}`;

export default function PainelLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      {children}
    </>
  );
}
