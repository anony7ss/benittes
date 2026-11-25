"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LEGAL_DOCUMENTS, LEGAL_DOC_LIST, type LegalDocKey } from "@/lib/legal";
import { openCookiePreferences } from "@/lib/cookies";

export function LegalDocumentClient({ docKey }: { docKey: LegalDocKey }) {
  const doc = LEGAL_DOCUMENTS[docKey];
  const [activeId, setActiveId] = useState<string>(doc.sections[0]?.id ?? "");

  useEffect(() => {
    setActiveId(doc.sections[0]?.id ?? "");
    const elements = doc.sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-110px 0px -60% 0px",
        threshold: 0.05,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [doc]);

  function jumpTo(id: string) {
    setActiveId(id);
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${id}`);
    }
  }

  return (
    <article className="wrap page legal-hub">
      <header className="legal-hero">
        <p className="kicker">{doc.kicker}</p>
        <h1>{doc.title}</h1>
        <p className="legal-subtitle">{doc.subtitle}</p>
        <div className="legal-meta">
          <span>{doc.updatedAt}</span>
          <span>·</span>
          <span>Benittes Oficina Mecânica</span>
        </div>

        <nav className="legal-tabs" aria-label="Documentos legais">
          {LEGAL_DOC_LIST.map((item) => {
            const current = item.key === doc.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`legal-tab${current ? " active" : ""}`}
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="legal-layout">
        <aside className="legal-toc" aria-label="Seções desta página">
          <div className="legal-toc-title">Nesta página</div>
          <div className="legal-toc-list">
            {doc.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`legal-toc-link${activeId === section.id ? " active" : ""}`}
                onClick={() => jumpTo(section.id)}
              >
                {section.title}
              </button>
            ))}
          </div>
          <div className="legal-toc-foot">
            {doc.key === "cookies" && (
              <button
                type="button"
                className="legal-toc-cookie-btn"
                onClick={() => openCookiePreferences()}
              >
                Alterar preferências de cookies
              </button>
            )}
            <Link href="/contato/">Falar com a oficina</Link>
          </div>
        </aside>

        <div className="legal-content">
          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} className="legal-section">
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph, idx) => (
                <p key={idx}>{paragraph}</p>
              ))}
              {section.bullets && section.bullets.length > 0 && (
                <ul className="legal-list">
                  {section.bullets.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
              )}
              {section.callout && (
                <div className="legal-callout">{section.callout}</div>
              )}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
