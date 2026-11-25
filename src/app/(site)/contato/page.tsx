import type { Metadata } from "next";
import { ContactMethods } from "@/components/public/ContactMethods";
import { ContactSection } from "@/components/public/ContactSection";
import { Intro } from "@/components/public/Intro";

export const metadata: Metadata = {
  title: "Contato",
  description: "Fale com a Benittes pelo WhatsApp, e-mail, Instagram ou formulário de contato.",
};

export default function ContatoPage() {
  return (
    <>
      <div className="wrap page contact-page">
        <Intro
          label="Contato"
          title="Fale conosco"
          desc="Escolha um canal ou envie uma mensagem."
        />
        <ContactMethods />
      </div>
      <ContactSection
        title="Escreva para a oficina"
        description="Conte brevemente o que você precisa."
        compact
      />
    </>
  );
}
