import Link from "next/link";
import { Icon } from "./Icon";
import { whatsappUrl } from "@/config/oficina";

export function ContactMethods() {
  return (
    <div className="contact-methods" aria-label="Canais oficiais de contato">
      <a
        data-site-channel="whatsapp"
        href={whatsappUrl ?? "/contato/"}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="whatsapp-logo" size={20} /> WhatsApp
      </a>

      <a data-site-channel="email" hidden>
        E-mail
      </a>
      <Link href="/contato/" data-site-channel-empty="email">
        E-mail
      </Link>

      <a data-site-channel="instagram" target="_blank" rel="noopener noreferrer" hidden>
        Instagram
      </a>
      <Link href="/contato/" data-site-channel-empty="instagram">
        Instagram
      </Link>
    </div>
  );
}
