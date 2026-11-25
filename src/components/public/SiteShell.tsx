"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { oficina, whatsappUrl } from "@/config/oficina";
import { OPEN_CONSENT_EVENT, getCookieConsent } from "@/lib/cookies";
import { CookieBanner } from "./CookieBanner";

const links: [string, string][] = [
  ["/", "Início"],
  ["/sobre/", "A oficina"],
  ["/servicos/", "Guias"],
  ["/galeria/", "Galeria"],
  ["/como-chegar/", "Como chegar"],
  ["/perguntas-frequentes/", "Dúvidas"],
];

export function SiteShell({
  mark,
  menuIcon,
  whatsappIcon,
  children,
}: {
  mark: ReactNode;
  menuIcon: ReactNode;
  whatsappIcon: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() || "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [wpOpen, setWpOpen] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const wpHref = whatsappUrl ?? oficina.googleMapsUrl ?? "/contato/";

  useEffect(() => {
    if (!getCookieConsent()) {
      setCookieOpen(true);
    }
    const onOpen = () => setCookieOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, onOpen);
  }, []);

  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);

  return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    const desktopFooter = window.matchMedia("(min-width: 821px)");
    const updateFooterVisibility = () => {
      const pageCanScroll = document.documentElement.scrollHeight > window.innerHeight + 1;
      const atTop = window.scrollY <= 0;
      document.body.toggleAttribute(
        "data-footer-hidden",
        desktopFooter.matches && pageCanScroll && atTop,
      );
    };
    updateFooterVisibility();
    window.addEventListener("scroll", updateFooterVisibility, { passive: true });
    window.addEventListener("resize", updateFooterVisibility);

  return () => {
      window.removeEventListener("scroll", updateFooterVisibility);
      window.removeEventListener("resize", updateFooterVisibility);
      document.body.removeAttribute("data-footer-hidden");
    };
  }, [pathname]);

  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: no-preference) and (min-width: 768px)").matches &&
      document.querySelector("[data-rise]")
    ) {
      void import("@/motion").then(({ animateSections }) => animateSections());
    }
  }, [pathname]);

  useEffect(() => {
    fetch("/api/public/identity")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { identity?: Record<string, unknown> } | null) => {
        const identity = data?.identity;
        if (!identity) return;
        const name = typeof identity.nome === "string" ? identity.nome.trim() : "";
        if (name) {
          document.title = document.title.replace(/ \| .+$/, ` | ${name}`);
          document.querySelectorAll<HTMLImageElement>(".brand-logo").forEach((image) => {
            image.alt = name;
            image.closest("a")?.setAttribute("aria-label", `${name} — início`);
          });
        }
        const whatsapp =
          typeof identity.whatsapp === "string" ? identity.whatsapp.replace(/\D/g, "") : "";
        const email = typeof identity.email === "string" ? identity.email.trim() : "";
        let instagram =
          typeof identity.instagram === "string" ? identity.instagram.trim() : "";
        if (instagram && !instagram.includes("://")) {
          instagram = `https://instagram.com/${instagram.replace(/^@/, "")}`;
        }
        const channelUrls: Record<string, string | undefined> = {
          whatsapp: /^[1-9]\d{9,14}$/.test(whatsapp) ? `https://wa.me/${whatsapp}` : undefined,
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : undefined,
          instagram: undefined,
        };
        try {
          const parsed = new URL(instagram);
          if (
            parsed.protocol === "https:" &&
            (parsed.hostname === "instagram.com" || parsed.hostname === "www.instagram.com") &&
            parsed.pathname.length > 1
          ) {
            channelUrls.instagram = parsed.href;
          }
        } catch {
          // ignore invalid instagram url
        }
        for (const [channel, href] of Object.entries(channelUrls)) {
          document
            .querySelectorAll<HTMLAnchorElement>(`[data-site-channel="${channel}"]`)
            .forEach((link) => {
              if (href) {
                link.href = href;
                link.hidden = false;
              } else {
                link.hidden = true;
              }
            });
          document
            .querySelectorAll<HTMLElement>(`[data-site-channel-empty="${channel}"]`)
            .forEach((label) => {
              label.hidden = Boolean(href);
            });
        }
        document.querySelectorAll<HTMLAnchorElement>("[data-site-quote]").forEach((link) => {
          if (channelUrls.whatsapp) {
            link.href = channelUrls.whatsapp;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          }
        });
        document
          .querySelectorAll<HTMLAnchorElement>("[data-site-whatsapp-float]")
          .forEach((link) => {
            if (channelUrls.whatsapp) {
              link.href = channelUrls.whatsapp;
              link.hidden = false;
            }
          });
      })
      .catch(() => {});
  }, [pathname]);

  return (
    <>
      <a href="#conteudo" className="skip">
        Pular para o conteúdo
      </a>
      <header className={menuOpen ? "opened" : undefined}>
        <div className="wrap header">
          {mark}
          <nav id="menu" aria-label="Principal">
            {links.map(([url, label]) => (
              <Link
                key={url}
                href={url}
                aria-current={isActive(url) ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <Link
              className="mobile-contact"
              href="/contato/"
              onClick={() => setMenuOpen(false)}
            >
              Contato
            </Link>
          </nav>
          <a className="btn primary head-cta" data-site-quote href={whatsappUrl ?? "/contato/"}>
            Solicitar orçamento
          </a>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="menu"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuIcon}
          </button>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1}>
        {children}
      </main>

      <CookieBanner open={cookieOpen} onClose={() => setCookieOpen(false)} />

      {/* WhatsApp FAB com popup */}
      <div className="wa-fab-wrap" aria-live="polite">
        {wpOpen && (
          <div className="wa-popup">
            <div className="wa-popup-head">
              <div className="wa-popup-avatar">
                <img src="/benittes-logo.png" alt="Benittes" />
              </div>
              <div>
                <div className="wa-popup-name">Benittes Oficina Mecânica</div>
                <div className="wa-popup-status">Online agora</div>
              </div>
              <button
                className="wa-popup-close"
                onClick={() => setWpOpen(false)}
                aria-label="Fechar"
              >✕</button>
            </div>
            <div className="wa-popup-body">
              <div className="wa-time">hoje</div>
              <div className="wa-bubble">
                Olá! 👋 Precisa de um orçamento ou quer agendar um serviço? Fale conosco diretamente pelo WhatsApp.
                <div className="wa-bubble-time">agora</div>
              </div>
            </div>
            <div className="wa-popup-foot">
              <a
                href={wpHref}
                target="_blank"
                rel="noopener noreferrer"
                className="wa-popup-btn"
                onClick={() => setWpOpen(false)}
              >
                {whatsappIcon} Iniciar conversa
              </a>
            </div>
          </div>
        )}
        <button
          className="wa-fab"
          onClick={() => setWpOpen((v) => !v)}
          aria-label="WhatsApp"
          aria-expanded={wpOpen}
        >
          {wpOpen ? <span className="wa-fab-x">✕</span> : whatsappIcon}
        </button>
      </div>

      <footer>
        <div className="wrap">
          <div className="foot-top">
            {mark}
            <div className="foot-links">
              {links.slice(1).map(([url, label]) => (
                <Link key={url} href={url}>
                  {label}
                </Link>
              ))}
              <Link href="/contato/">Contato</Link>
            </div>
          </div>
          <div className="foot-info">
            <Link href="/como-chegar/">{oficina.endereco}</Link>
            <a href={oficina.telefoneHref}>{oficina.telefone}</a>
          </div>
          <div className="foot-end">
            <div>
              <Link href="/privacidade/">Privacidade</Link>
              <Link href="/termos/">Termos de uso</Link>
              <Link href="/cookies/">Cookies</Link>
              <button
                type="button"
                className="foot-cookie-btn"
                onClick={() => setCookieOpen(true)}
              >
                Gerenciar cookies
              </button>
            </div>
            <a
              data-site-channel="whatsapp"
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp · {oficina.telefone}
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
