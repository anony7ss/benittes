import type { Metadata } from "next";
import Link from "next/link";
import { Intro } from "@/components/public/Intro";
import { oficina, whatsappUrl } from "@/config/oficina";

export const metadata: Metadata = {
  title: "Como chegar · Localização",
  description: `Visite a Benittes Oficina Mecânica em ${oficina.endereco}. Telefone e WhatsApp: ${oficina.telefone}.`,
};

export default function ComoChegarPage() {
  return (
    <article className="wrap page location-page">
      <Intro
        label="Localização"
        title="Como chegar."
      />

      <div className="location-grid">
        <div className="location-card">
          <div className="location-block">
            <span className="location-label">Endereço</span>
            <p className="location-value">{oficina.endereco}</p>
          </div>

          <div className="location-block">
            <span className="location-label">Telefone / WhatsApp</span>
            <p className="location-value">
              <a href={oficina.telefoneHref}>{oficina.telefone}</a>
            </p>
          </div>

          <div className="location-block">
            <span className="location-label">Atendimento</span>
            <p className="location-muted">
              Segunda a sexta, das 08h às 18h · Sábado, das 08h às 12h.
            </p>
          </div>

          <div className="location-actions">
            <a
              className="btn-secondary"
              href={oficina.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir no Google Maps
            </a>
            <a
              className="btn-secondary"
              href={oficina.wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir no Waze
            </a>
            {whatsappUrl && (
              <a
                className="btn-secondary"
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Chamar no WhatsApp
              </a>
            )}
            <Link className="btn-secondary" href="/contato/">
              Enviar mensagem
            </Link>
          </div>
        </div>

        <div className="location-map">
          <iframe
            title="Mapa da Benittes Oficina Mecânica em Alvorada - RS"
            src={oficina.googleMapsEmbedUrl}
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </article>
  );
}
