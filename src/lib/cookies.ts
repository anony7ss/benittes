export type CookieConsent = {
  essential: true;
  preferences: boolean;
  analytics: boolean;
  decidedAt: string;
};

export const COOKIE_CONSENT_STORAGE_KEY = "benittes-cookie-consent";
const COOKIE_NAME = "benittes_consent";
export const CONSENT_EVENT = "benittes:cookie-consent";
export const OPEN_CONSENT_EVENT = "benittes:open-cookie-banner";

export function getCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsent>;
    if (typeof parsed.preferences !== "boolean" || typeof parsed.analytics !== "boolean") {
      return null;
    }
    return {
      essential: true,
      preferences: parsed.preferences,
      analytics: parsed.analytics,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function hasConsentFor(category: "essential" | "preferences" | "analytics"): boolean {
  if (category === "essential") return true;
  const consent = getCookieConsent();
  if (!consent) return false;
  return Boolean(consent[category]);
}

export function saveCookieConsent(choice: { preferences: boolean; analytics: boolean }): CookieConsent {
  const payload: CookieConsent = {
    essential: true,
    preferences: choice.preferences,
    analytics: choice.analytics,
    decidedAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }

    const level = choice.preferences && choice.analytics ? "all" : choice.preferences || choice.analytics ? "custom" : "essential";
    document.cookie = `${COOKIE_NAME}=${level}; Path=/; Max-Age=15552000; SameSite=Lax`;
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: payload }));
  }

  return payload;
}

export function clearOptionalCookies(): void {
  if (typeof document === "undefined") return;
  const essentialCookies = new Set([COOKIE_NAME]);
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const item of cookies) {
    const name = item.split("=")[0]?.trim();
    if (!name || essentialCookies.has(name) || name.startsWith("sb-")) continue;
    document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }
}

export function openCookiePreferences(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT));
  }
}
