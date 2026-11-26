import type { Metadata } from "next";
import Link from "next/link";
import Perguntas from "@/components/Perguntas";
import { ContactSection } from "@/components/public/ContactSection";
import { Guides } from "@/components/public/Guides";
import { Icon } from "@/components/public/Icon";
import { Photo } from "@/components/public/Photo";
import { PhotoCarousel } from "@/components/public/PhotoCarousel";
import { whatsappUrl } from "@/config/oficina";

export const metadata: Metadata = {
  title: "Início",
  description:
    "Conheça a Benittes Oficina Mecânica. Orientações de manutenção, fotografias e contato.",
};

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-photo">
          <Photo
            id="fachada"
            alt="Fachada da Benittes Oficina Mecânica com o letreiro Benittes visível"
            width={1272}
            height={1237}
            srcWidths={[640, 1120, 1272]}
            format="jpg"
            priority
          />
        </div>
        <div className="hero-shade hero-shade-facade" />
        <div className="wrap hero-in">
          <div className="hero-copy">
            <h1>
              Mecânica de precisão.
              <br />
              <em>Detalhe por detalhe.</em>
            </h1>
            <div className="actions">
              <a className="btn primary" href={whatsappUrl ?? "/contato/"}>
                Solicitar orçamento
              </a>
              <Link className="text-light" href="/contato/">
                Contato
              </Link>
            </div>
          </div>
        </div>
      </section>

      <hr className="section-rule" />

      <section className="wrap split" id="guia">
        <div data-rise="">
          <span className="kicker">Manutenção</span>
          <h2>
            Por dentro da <br />
            manutenção.
          </h2>
          <p>Orientações para entender alguns sistemas do carro.</p>
          <Link className="text-link" href="/servicos/">
            Todos os guias
          </Link>
        </div>
        <Guides />
      </section>

      <hr className="section-rule" />

      <section className="gallery-section">
        <div className="wrap">
          <div className="section-heading">
            <div>
              <span className="kicker">Galeria</span>
              <h2>Mecânica em foco.</h2>
            </div>
            <Link className="text-light" href="/galeria/">
              Ver galeria
            </Link>
          </div>
          <PhotoCarousel
            leftIcon={<Icon name="arrow-left" size={18} />}
            rightIcon={<Icon name="arrow-right" size={18} />}
          />
        </div>
      </section>

      <hr className="section-rule" />

      <section className="wrap split faq-home">
        <div data-rise="">
          <span className="kicker">Perguntas</span>
          <h2>Dúvidas frequentes.</h2>
          <Link className="text-link" href="/perguntas-frequentes/">
            Todas as dúvidas
          </Link>
        </div>
        <Perguntas limit={5} />
      </section>

      <ContactSection />
    </>
  );
}
