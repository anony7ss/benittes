import type { Metadata } from "next";
import Link from "next/link";
import { Intro } from "@/components/public/Intro";
import { Photo } from "@/components/public/Photo";

export const metadata: Metadata = {
  title: "A oficina",
  description:
    "Conheça a proposta do site da Benittes e entenda como preparar uma conversa sobre manutenção.",
};

export default function SobrePage() {
  return (
    <div className="wrap page">
      <Intro
        label="A oficina"
        title="Benittes Oficina Mecânica"
        desc="O cuidado com o carro começa por uma boa conversa."
      />
      <div className="about">
        <figure>
          <Photo id="bancada" priority sizes="(max-width:700px) 100vw, 50vw" />
          <figcaption>Fotografia editorial · Artem Podrez</figcaption>
        </figure>
        <div>
          <span className="kicker">Nosso caderno</span>
          <h2>
            O detalhe faz parte da conversa<span>.</span>
          </h2>
          <p>
            Um ruído na partida ou uma vibração no volante pode ser difícil de descrever. Este
            espaço da Benittes reúne orientações para ajudar você a reconhecer essas mudanças e
            conversar sobre elas.
          </p>
          <p>
            Nos guias, cada sistema tem uma explicação e perguntas que ajudam a organizar o
            histórico do seu carro.
          </p>
          <Link className="text-link" href="/servicos/">
            Conhecer os guias
          </Link>
        </div>
      </div>
    </div>
  );
}
