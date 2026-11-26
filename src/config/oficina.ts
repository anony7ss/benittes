import editorial from "../content/site.json";

const emailAddress = (process.env.NEXT_PUBLIC_EMAIL || process.env.PUBLIC_EMAIL || "").trim();
const publicEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress) ? emailAddress : "";

const DEFAULT_ADDRESS = "Av. Dezessete de Setembro, 533 - Aparecida, Alvorada - RS";
const DEFAULT_PHONE = "(51) 8523-6656";
const DEFAULT_WHATSAPP = "555185236656";

export const oficina = {
  nome: editorial.identidade.nome,
  endereco: DEFAULT_ADDRESS,
  telefone: DEFAULT_PHONE,
  telefoneHref: "tel:+555185236656",
  whatsapp: (process.env.NEXT_PUBLIC_WHATSAPP || process.env.PUBLIC_WHATSAPP || DEFAULT_WHATSAPP).trim(),
  email: publicEmail,
  googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(DEFAULT_ADDRESS)}`,
  googleMapsEmbedUrl: `https://www.google.com/maps?q=${encodeURIComponent(DEFAULT_ADDRESS)}&z=16&output=embed`,
  wazeUrl: `https://waze.com/ul?q=${encodeURIComponent(DEFAULT_ADDRESS)}&navigate=yes`,
};

export const whatsappUrl = /^[1-9]\d{9,14}$/.test(oficina.whatsapp)
  ? `https://wa.me/${oficina.whatsapp}`
  : undefined;

export const instagramUrl = (() => {
  const configured = (process.env.NEXT_PUBLIC_INSTAGRAM || process.env.PUBLIC_INSTAGRAM || "").trim();
  if (!configured) return undefined;
  const address = configured.startsWith("@")
    ? `https://instagram.com/${configured.slice(1)}`
    : configured.includes("://")
      ? configured
      : `https://instagram.com/${configured}`;
  try {
    const url = new URL(address);
    return (url.hostname === "instagram.com" || url.hostname === "www.instagram.com") && url.pathname.length > 1 && url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
})();

export interface Guia {
  slug: string;
  nome: string;
  resumo: string;
  contexto: string;
  observar: string[];
  icone: string;
}

export const guias = editorial.guias as Guia[];
export const fotos = editorial.fotos;
export const perguntas = editorial.perguntas as [string, string][];
