import type { Metadata } from "next";
import Perguntas from "@/components/Perguntas";
import { Intro } from "@/components/public/Intro";

export const metadata: Metadata = {
  title: "Perguntas frequentes",
  description: "Tire dúvidas sobre avaliação, orçamento e atendimento na oficina.",
};

export default function PerguntasFrequentesPage() {
  return (
    <div className="wrap page">
      <Intro
        label="Atendimento"
        title="Perguntas frequentes"
        desc="Informações para preparar sua visita e entender os próximos passos."
      />
      <Perguntas />
    </div>
  );
}
