"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
  const navRef = useRef<HTMLElement | null>(null);
  const navIndicatorRef = useRef<HTMLSpanElement | null>(null);
  const navIndicatorPathRef = useRef(pathname);
  const pendingNavClickPathRef = useRef<string | null>(null);
  const navIndicatorAnimationRef = useRef<Animation | null>(null);
  const wpHref = whatsappUrl ?? oficina.googleMapsUrl ?? "/contato/";

  const animateIndicatorToLink = (link: HTMLAnchorElement) => {
    const nav = navRef.current;
    const indicator = navIndicatorRef.current;
    if (!nav || !indicator || window.getComputedStyle(nav).display === "none") return;

    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const currentRect = indicator.getBoundingClientRect();
    const fromX = currentRect.left - navRect.left;
    const fromY = currentRect.top - navRect.top;
    const toX = linkRect.left - navRect.left;
    const toY = linkRect.bottom - navRect.top - 5;
    const targetTransform = `translate(${toX}px, ${toY}px)`;
    const wasVisible = indicator.style.opacity === "1";

    indicator.style.width = "17px";
    indicator.style.opacity = "1";
    navIndicatorAnimationRef.current?.cancel();

    if (
      !wasVisible ||
      Math.hypot(toX - fromX, toY - fromY) <= 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      indicator.style.transform = targetTransform;
      navIndicatorAnimationRef.current = null;
      return;
    }

    const animation = indicator.animate(
      [
        { transform: `translate(${fromX}px, ${fromY}px)` },
        { transform: targetTransform },
      ],
      {
        duration: 620,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
    navIndicatorAnimationRef.current = animation;
    animation.onfinish = () => {
      indicator.style.transform = targetTransform;
      animation.cancel();
      if (navIndicatorAnimationRef.current === animation) {
        navIndicatorAnimationRef.current = null;
      }
    };
  };

  const handleNavigationClick = (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
    setMenuOpen(false);
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    pendingNavClickPathRef.current = new URL(href, window.location.origin).pathname;
    animateIndicatorToLink(event.currentTarget);
  };

  useLayoutEffect(() => {
    const clickedTarget = pendingNavClickPathRef.current === pathname;
    if (clickedTarget) pendingNavClickPathRef.current = null;
    const animateOnNavigation = navIndicatorPathRef.current !== pathname && !clickedTarget;
    navIndicatorPathRef.current = pathname;

    const updateIndicator = (shouldAnimate = false) => {
      const nav = navRef.current;
      const indicator = navIndicatorRef.current;
      const activeLink = nav?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      if (!nav || !indicator || !activeLink) {
        if (indicator) indicator.style.opacity = "0";
        return;
      }

      if (window.getComputedStyle(nav).display === "none") {
        indicator.style.opacity = "0";
        return;
      }

      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      if (!navRect.width || !linkRect.width) {
        indicator.style.opacity = "0";
        return;
      }

      const currentRect = indicator.getBoundingClientRect();
      const fromX = currentRect.left - navRect.left;
      const fromY = currentRect.top - navRect.top;
      const toX = linkRect.left - navRect.left;
      const toY = linkRect.bottom - navRect.top - 5;
      const wasVisible = indicator.style.opacity === "1";
      indicator.style.width = "17px";
      indicator.style.opacity = "1";

      if (!shouldAnimate && navIndicatorAnimationRef.current?.playState === "running") return;

      if (
        shouldAnimate &&
        wasVisible &&
        Math.hypot(toX - fromX, toY - fromY) > 1 &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        navIndicatorAnimationRef.current?.cancel();
        const animation = indicator.animate(
          [
            { transform: `translate(${fromX}px, ${fromY}px)` },
            { transform: `translate(${toX}px, ${toY}px)` },
          ],
          {
            duration: 520,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        );
        navIndicatorAnimationRef.current = animation;
        animation.onfinish = () => {
          indicator.style.transform = `translate(${toX}px, ${toY}px)`;
          animation.cancel();
          if (navIndicatorAnimationRef.current === animation) {
            navIndicatorAnimationRef.current = null;
          }
        };
      } else {
        navIndicatorAnimationRef.current?.cancel();
        indicator.style.transform = `translate(${toX}px, ${toY}px)`;
        navIndicatorAnimationRef.current = null;
      }
    };

    updateIndicator(animateOnNavigation);
    void document.fonts?.ready.then(() => updateIndicator());
    const onResize = () => updateIndicator();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pathname, menuOpen]);

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
          <nav id="menu" aria-label="Principal" ref={navRef}>
            {links.map(([url, label]) => (
              <Link
                key={url}
                href={url}
                aria-current={isActive(url) ? "page" : undefined}
                onClick={(event) => handleNavigationClick(event, url)}
              >
                {label}
              </Link>
            ))}
            <Link
              className="mobile-contact"
              href="/contato/"
              aria-current={isActive("/contato/") ? "page" : undefined}
              onClick={(event) => handleNavigationClick(event, "/contato/")}
            >
              Contato
            </Link>
            <span className="public-nav-indicator" ref={navIndicatorRef} aria-hidden="true" />
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

      <main id="conteudo" tabIndex={-1} key={pathname} className="public-page-transition">
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
          </div>
        </div>
      </footer>
    </>
  );
}
