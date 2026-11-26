"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearOptionalCookies,
  getCookieConsent,
  saveCookieConsent,
} from "@/lib/cookies";

export function CookieBanner({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    if (!open) return;
    const current = getCookieConsent();
    setPreferences(current?.preferences ?? false);
    setAnalytics(current?.analytics ?? false);
    if (current) {
      setCustomizing(true);
    }
  }, [open]);

  if (!open) return null;

  function acceptAll() {
    saveCookieConsent({ preferences: true, analytics: true });
    setCustomizing(false);
    onClose();
  }

  function acceptEssentialOnly() {
    clearOptionalCookies();
    saveCookieConsent({ preferences: false, analytics: false });
    setCustomizing(false);
    onClose();
  }

  function saveCustom() {
    if (!preferences && !analytics) {
      clearOptionalCookies();
    }
    saveCookieConsent({ preferences, analytics });
    setCustomizing(false);
    onClose();
  }

  return (
    <aside
      className="cookie-banner"
      role="dialog"
      aria-label="Preferências de cookies"
      aria-live="polite"
      style={{
        position: "fixed",
        left: 22,
        bottom: 22,
        zIndex: 9999,
      }}
    >
      <div className="cookie-banner-head">
        <strong>Privacidade e cookies</strong>
        <Link href="/cookies/" className="cookie-banner-link">
          Saiba mais
        </Link>
      </div>

      <p className="cookie-banner-text">
        Usamos cookies essenciais para o funcionamento do site. Cookies opcionais só são ativados após o seu consentimento.
      </p>

      {customizing && (
        <div className="cookie-options">
          <label className="cookie-option is-locked">
            <input id="cookie-essential" type="checkbox" checked disabled />
            <span>
              <strong>Essenciais</strong>
              <small>Necessários para segurança, navegação e funcionamento básico.</small>
            </span>
          </label>
          <label className="cookie-option">
            <input
              id="cookie-preferences"
              type="checkbox"
              checked={preferences}
              onChange={(e) => setPreferences(e.target.checked)}
            />
            <span>
              <strong>Preferências</strong>
              <small>Lembra tema visual e escolhas de exibição.</small>
            </span>
          </label>
          <label className="cookie-option">
            <input
              id="cookie-performance"
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
            />
            <span>
              <strong>Desempenho</strong>
              <small>Ajuda a medir estabilidade e melhorar o site.</small>
            </span>
          </label>
        </div>
      )}

      <div className="cookie-banner-actions">
        <button
          type="button"
          className="cookie-btn-ghost"
          onClick={() => setCustomizing((v) => !v)}
        >
          {customizing ? "Ocultar opções" : "Personalizar"}
        </button>
        <div className="cookie-banner-primary-group">
          <button
            type="button"
            className="cookie-btn-secondary"
            onClick={acceptEssentialOnly}
          >
            Apenas essenciais
          </button>
          {customizing ? (
            <button type="button" className="cookie-btn-primary" onClick={saveCustom}>
              Salvar escolha
            </button>
          ) : (
            <button type="button" className="cookie-btn-primary" onClick={acceptAll}>
              Aceitar todos
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
