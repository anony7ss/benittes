import type { Metadata } from "next";
import Link from "next/link";
import { Intro } from "@/components/public/Intro";

export const metadata: Metadata = {
  title: "Página não encontrada",
  description: "Volte ao início para continuar navegando.",
  robots: { index: false, follow: false },
};

export default function SiteNotFound() {
  return (
    <section className="wrap page">
      <Intro
        label="Erro 404"
        title="Página não encontrada"
        desc="O endereço pode ter mudado. Você pode continuar pela página inicial."
      />
      <Link className="btn blue" href="/">
        Voltar ao início
      </Link>
    </section>
  );
}
