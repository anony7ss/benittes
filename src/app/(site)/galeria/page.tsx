import type { Metadata } from "next";
import { GalleryClient } from "@/components/public/GalleryClient";
import { Icon } from "@/components/public/Icon";
import { Intro } from "@/components/public/Intro";

export const metadata: Metadata = {
  title: "Galeria",
  description:
    "Uma seleção de fotografias editoriais sobre motores, ferramentas e trabalho de bancada.",
};

export default function GaleriaPage() {
  return (
    <div className="wrap page gallery-page">
      <Intro
        label="Galeria fotográfica"
        title="Mecânica em foco"
        desc="Um ensaio editorial sobre peças, superfícies e trabalho manual. Fotografias de referência por Artem Podrez."
      />
      <GalleryClient closeIcon={<Icon name="x" />} />
    </div>
  );
}
