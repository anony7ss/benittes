import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/public/Icon";
import { Intro } from "@/components/public/Intro";
import { guias } from "@/config/oficina";

export function generateStaticParams() {
  return guias.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guia = guias.find((g) => g.slug === slug);
  if (!guia) return {};
  return { title: guia.nome, description: guia.resumo };
}

export default async function GuiaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guia = guias.find((g) => g.slug === slug);
  if (!guia) notFound();

  return (
    <article className="wrap page">
      <Link className="text-link" href="/servicos/">
        <Icon name="arrow-left" /> Todos os guias
      </Link>
      <Intro label="Caderno de manutenção" title={guia.nome} desc={guia.contexto} />
      <div className="split inner">
        <h2>O que observar</h2>
        <div>
          <ul className="observations">
            {guia.observar.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Link className="btn primary" href="/contato/">
            Consultar atendimento
          </Link>
        </div>
      </div>
    </article>
  );
}
