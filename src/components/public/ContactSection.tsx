import { ContactForm } from "./ContactForm";

export function ContactSection({
  title = "Entre em contato.",
  description = "Conte o que você observou no veículo.",
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <section className={`contact-section${compact ? " compact" : ""}`}>
      <div className="wrap contact-grid">
        <div className="contact-pitch">
          <span className="kicker">Contato</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <ContactForm />
      </div>
    </section>
  );
}
