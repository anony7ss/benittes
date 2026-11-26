import type { Metadata } from "next";
import { GalleryClient } from "@/components/public/GalleryClient";
import { Icon } from "@/components/public/Icon";
import { Intro } from "@/components/public/Intro";

export const metadata: Metadata = {
  title: "Galeria",
  description:
    "Uma seleção de fotografias de motores, inspeções e trabalhos na oficina.",
};

export default function GaleriaPage() {
  return (
    <div className="wrap page gallery-page">
      <Intro
        label="Galeria fotográfica"
        title="Mecânica em foco"
        desc="Imagens de componentes, inspeções e serviços vistos de perto."
      />
      <GalleryClient closeIcon={<Icon name="x" />} />
    </div>
  );
}
