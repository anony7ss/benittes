import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página não encontrada",
  description: "Volte ao início para continuar navegando.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="global-not-found">
      <div className="global-not-found__content">
        <Link className="global-not-found__brand" href="/" aria-label="Benittes — início">
          <img src="/benittes-logo.png" alt="Benittes Oficina Mecânica" width={1000} height={798} />
        </Link>
        <p className="global-not-found__eyebrow">Erro 404</p>
        <h1>Página não encontrada</h1>
        <p>O endereço pode ter mudado. Você pode continuar pela página inicial.</p>
        <Link className="global-not-found__link" href="/">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
