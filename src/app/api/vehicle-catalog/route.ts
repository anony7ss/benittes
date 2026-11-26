import { NextResponse } from "next/server";

const FIPE_BASE_URL = "https://fipe.parallelum.com.br/api/v2/cars/brands";
const CACHE_SECONDS = 60 * 60 * 24;

type FipeOption = { code: string; name: string };

function isFipeOption(value: unknown): value is FipeOption {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (typeof item.code === "string" || typeof item.code === "number")
    && typeof item.name === "string"
    && Boolean(item.name.trim());
}

export async function GET(request: Request) {
  const brandId = new URL(request.url).searchParams.get("brandId")?.trim();
  if (brandId && !/^\d+$/.test(brandId)) {
    return NextResponse.json({ error: "Código de marca inválido." }, { status: 400 });
  }

  const url = brandId ? `${FIPE_BASE_URL}/${brandId}/models` : FIPE_BASE_URL;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "A API FIPE não respondeu." }, { status: 502 });
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return NextResponse.json({ error: "A API FIPE retornou dados inválidos." }, { status: 502 });
    }

    const options = payload.filter(isFipeOption).map((item) => ({
      code: String(item.code),
      name: item.name.trim(),
    }));
    return NextResponse.json(options, {
      headers: { "Cache-Control": `public, max-age=3600, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400` },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a API FIPE." }, { status: 502 });
  }
}
