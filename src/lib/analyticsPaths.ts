const STATIC_ANALYTICS_PATHS = new Set([
  "/",
  "/sobre",
  "/servicos",
  "/galeria",
  "/como-chegar",
  "/perguntas-frequentes",
  "/contato",
  "/termos",
  "/privacidade",
  "/cookies",
]);

function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

export function analyticsPathFor(pathname: string): string | null {
  const path = normalizePath(pathname);

  if (STATIC_ANALYTICS_PATHS.has(path)) return path;

  if (path.startsWith("/servicos/")) {
    const slug = path.slice("/servicos/".length);
    return slug && !slug.includes("/") ? `/servicos/${slug}` : null;
  }

  // The public quote URL contains a secret token. Never send it to analytics.
  if (path.startsWith("/orcamento/")) {
    const token = path.slice("/orcamento/".length);
    return token && !token.includes("/") ? "/orcamento/:token" : null;
  }

  return null;
}

export function isReplayEligiblePath(pathname: string): boolean {
  const path = normalizePath(pathname);

  return (
    path === "/" ||
    path === "/sobre" ||
    path === "/servicos" ||
    path === "/galeria" ||
    path === "/como-chegar" ||
    path === "/perguntas-frequentes" ||
    (path.startsWith("/servicos/") && !path.slice("/servicos/".length).includes("/"))
  );
}

export function suppressReplayForPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/contato" || path.startsWith("/orcamento/");
}
