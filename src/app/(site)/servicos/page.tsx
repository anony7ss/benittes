import type { Metadata } from "next";
import { Guides } from "@/components/public/Guides";
import { Intro } from "@/components/public/Intro";

export const metadata: Metadata = {
  title: "Guias de manutenção",
  description: "Orientações sobre diagnóstico, revisão, freios e suspensão.",
};

export default function ServicosPage() {
  return (
    <div className="wrap page">
      <Intro
        label="Manutenção"
        title="Guias de manutenção"
        desc="Informações para ajudar você a descrever o que percebeu no veículo."
      />
      <Guides />
    </div>
  );
}
