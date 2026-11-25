import type { MetadataRoute } from "next";
import { guias } from "@/config/oficina";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || "").replace(
    /\/$/,
    "",
  );
  if (!siteUrl) return [];

  const paths = [
    "/",
    "/sobre/",
    "/servicos/",
    "/galeria/",
    "/como-chegar/",
    "/perguntas-frequentes/",
    "/contato/",
    "/termos/",
    "/privacidade/",
    "/cookies/",
    ...guias.map((g) => `/servicos/${g.slug}/`),
  ];

  return paths.map((path) => ({
    url: `${siteUrl}${path}`,
  }));
}
