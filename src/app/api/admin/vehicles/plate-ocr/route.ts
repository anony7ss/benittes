import { NextRequest, NextResponse } from "next/server";
import { requirePanelStaff } from "../../../../../lib/supabaseAdmin";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";

const MAX_VISION_IMAGE_BYTES = 5 * 1024 * 1024;

const PLATE_REGEX = /\b([A-Z]{3}[-\s]?[0-9][A-Z0-9][0-9]{2})\b/i;

type VehicleLookup = {
  plate: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  titulo: string | null;
  ano: string | null;
  cor: string | null;
  combustivel: string | null;
  chassi: string | null;
  source: "simplesapi" | "ai" | "none";
};

class PlateLookupError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "PlateLookupError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeFuel(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("flex")) return "Flex";
  if (normalized.includes("hibrid")) return "Híbrido";
  if (normalized.includes("eletric")) return "Elétrico";
  if (normalized.includes("diesel")) return "Diesel";
  if (normalized.includes("gnv") || normalized.includes("gas natural")) return "GNV";
  if (normalized.includes("gasolina") && (normalized.includes("etanol") || normalized.includes("alcool"))) return "Flex";
  if (normalized.includes("etanol") || normalized.includes("alcool")) return "Etanol";
  if (normalized.includes("gasolina")) return "Gasolina";
  return value;
}

function buildVehicleTitle(brand: string | null, model: string | null, version: string | null) {
  let modelLabel = model;
  if (version && model) {
    const modelPrefix = model.split(/\s+/)[0]?.toLocaleLowerCase("pt-BR");
    modelLabel = modelPrefix && version.toLocaleLowerCase("pt-BR").includes(modelPrefix)
      ? version
      : `${model} ${version}`;
  } else if (version) {
    modelLabel = version;
  }
  return [brand, modelLabel].filter(Boolean).join(" ") || null;
}

async function lookupPlateSimplesApi(plate: string): Promise<VehicleLookup> {
  const apiKey = process.env.SIMPLESAPI_KEY?.trim();
  if (!apiKey) throw new PlateLookupError("A consulta de placa não está configurada no servidor.", 503);
  if (!plate) throw new PlateLookupError("Informe uma placa válida.", 400);

  let response: Response;
  try {
    response = await fetch("https://api.simplesapi.com.br/v1/vehicle/plate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plate }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PlateLookupError("A consulta de placa está temporariamente indisponível. Tente novamente.", 503);
  }

  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "A chave da consulta de placa foi recusada. Verifique a configuração no servidor.",
      402: "O saldo ou limite de consultas de placa foi atingido.",
      403: "A conta da consulta de placa precisa de uma validação antes de ser usada.",
      404: "Não encontramos dados para esta placa.",
      422: "A placa informada está em um formato inválido.",
      429: "O limite de consultas foi atingido. Aguarde um pouco e tente novamente.",
      503: "A base de veículos está temporariamente indisponível. Tente novamente.",
    };
    const status = response.status === 404 ? 404 : response.status === 422 ? 400 : response.status === 401 || response.status === 402 || response.status === 403 || response.status === 429 || response.status === 503 ? 503 : 502;
    throw new PlateLookupError(messages[response.status] ?? "Não foi possível consultar esta placa agora.", status);
  }
  if (!json) throw new PlateLookupError("A resposta da consulta de placa veio em um formato inválido.", 502);

  // A Simples API retorna { plate, vehicle_info: { brand, model, version, ... } }.
  // Algumas integrações intermediárias podem envolver a mesma estrutura em `data`.
  const data = asRecord(json.data) ?? json;
  const vehicle = asRecord(data.vehicle_info)
    ?? asRecord(json.vehicle_info)
    ?? asRecord(data.vehicle)
    ?? asRecord(json.vehicle)
    ?? data;
  const fipe = asRecord(data.fipe) ?? asRecord(json.fipe);
  const fipeSpecs = fipe ? asRecord(fipe.specs) : null;
  const first = (keys: string[], ...records: Array<Record<string, unknown> | null>) => {
    for (const record of records) {
      if (!record) continue;
      for (const key of keys) {
        const value = asText(record[key]);
        if (value) return value;
      }
    }
    return null;
  };

  const marca = first(["brand", "marca", "make", "fabricante"], vehicle, data, json, fipe);
  const modelo = first(["model", "modelo", "vehicle_model", "name"], vehicle, data, json, fipe);
  const versao = first(["version", "versao", "trim", "vehicle_version"], vehicle, data, json, fipeSpecs);
  const ano = first(["model_year", "ano_modelo", "year", "ano", "anoModelo"], vehicle, data, json, fipe);
  const cor = first(["color", "cor"], vehicle, data, json);
  const combustivel = normalizeFuel(first(["fuel", "combustivel", "fuel_type"], vehicle, data, json, fipe, fipeSpecs));
  const chassi = first(["chassis", "chassi", "vin"], vehicle, data, json);
  if (!marca && !modelo && !versao && !ano && !cor && !combustivel && !chassi) {
    throw new PlateLookupError("Não encontramos dados de veículo para esta placa.", 404);
  }

  return {
    plate: asText(data.plate) ?? asText(json.plate) ?? plate,
    marca,
    modelo,
    versao,
    titulo: buildVehicleTitle(marca, modelo, versao),
    ano,
    cor,
    combustivel,
    chassi,
    source: "simplesapi",
  };
}

async function extractPlateWithAi(
  mimeType: string,
  base64Data: string,
): Promise<{ plate: string | null; marca: string | null; modelo: string | null; cor: string | null }> {
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: 'Extraia da imagem a placa brasileira (padrão antigo ABC1234 ou Mercosul ABC1D23) e, se visível, marca, modelo e cor do carro. Responda apenas em JSON: {"plate":"...","make":"...","model":"...","color":"..."}',
                  },
                  { inline_data: { mime_type: mimeType, data: base64Data } },
                ],
              },
            ],
          }),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          const cleanPlate = String(parsed.plate ?? "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
          return {
            plate: cleanPlate || null,
            marca: parsed.make ? String(parsed.make) : null,
            modelo: parsed.model ? String(parsed.model) : null,
            cor: parsed.color ? String(parsed.color) : null,
          };
        }
        const regexMatch = text.match(PLATE_REGEX);
        if (regexMatch) {
          return {
            plate: regexMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, ""),
            marca: null,
            modelo: null,
            cor: null,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Extraia a placa brasileira e marca/modelo/cor se visíveis. Responda só JSON: {"plate":"...","make":"...","model":"...","color":"..."}',
                },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
              ],
            },
          ],
          max_tokens: 150,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = json.choices?.[0]?.message?.content ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          const cleanPlate = String(parsed.plate ?? "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
          return {
            plate: cleanPlate || null,
            marca: parsed.make ? String(parsed.make) : null,
            modelo: parsed.model ? String(parsed.model) : null,
            cor: parsed.color ? String(parsed.color) : null,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  return { plate: null, marca: null, modelo: null, cor: null };
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!["owner", "manager", "advisor", "technician"].includes(String(staff.member.role))) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "vehicle-lookup-user", subject: staff.user.id, maxHits: 30, windowSeconds: 900 },
      { scope: "vehicle-lookup-ip", subject: clientAddress(request), maxHits: 60, windowSeconds: 900 },
    ]))) return rateLimitedResponse();
  } catch {
    return NextResponse.json({ error: "Consulta temporariamente indisponível." }, { status: 503 });
  }

  const parsed = await readBoundedJson<{
    imageBase64?: unknown;
    plate?: unknown;
  } | null>(request, Math.ceil(MAX_VISION_IMAGE_BYTES * 4 / 3) + 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const manualPlate = String(body?.plate ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (manualPlate) {
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(manualPlate)) {
      return NextResponse.json({ error: "Informe uma placa válida (7 caracteres)." }, { status: 400 });
    }
    try {
      const found = await lookupPlateSimplesApi(manualPlate);
      return NextResponse.json(found, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const status = error instanceof PlateLookupError ? error.status : 503;
      const message = error instanceof PlateLookupError ? error.message : "Não foi possível consultar esta placa agora.";
      return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
    }
  }

  const raw = String(body?.imageBase64 ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Envie uma imagem ou informe a placa." }, { status: 400 });
  }

  const mimeMatch = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!mimeMatch) return NextResponse.json({ error: "Envie uma imagem JPG, PNG ou WebP válida." }, { status: 400 });
  const mimeType = mimeMatch[1].toLowerCase();
  const base64Data = mimeMatch[2];
  const decodedBytes = Math.floor(base64Data.length * 3 / 4) - (base64Data.endsWith("==") ? 2 : base64Data.endsWith("=") ? 1 : 0);
  if (decodedBytes < 1 || decodedBytes > MAX_VISION_IMAGE_BYTES) {
    return NextResponse.json({ error: "A imagem deve ter no máximo 5 MB." }, { status: 413 });
  }

  const aiResult = await extractPlateWithAi(mimeType, base64Data);
  if (!aiResult.plate) {
    return NextResponse.json({
      plate: null,
      notice:
        "Não foi possível identificar a placa na foto (verifique GEMINI_API_KEY/OPENAI_API_KEY ou digite a placa para consultar pela SimplesAPI).",
    });
  }

  // Após a IA ler a placa, chama automaticamente a ferramenta SimplesAPI para buscar marca, modelo, ano, cor, combustível e chassi
  let apiData: VehicleLookup | null = null;
  let lookupNotice: string | null = null;
  try {
    apiData = await lookupPlateSimplesApi(aiResult.plate);
  } catch (error) {
    lookupNotice = error instanceof PlateLookupError ? error.message : "Os dados completos do veículo não puderam ser consultados.";
  }
  const modelSummary = [aiResult.marca, aiResult.modelo].filter((value): value is string => Boolean(value?.trim())).join(" ");
  return NextResponse.json({
    plate: aiResult.plate,
    marca: apiData?.marca ?? aiResult.marca,
    modelo: apiData?.modelo ?? aiResult.modelo,
    versao: apiData?.versao ?? null,
    titulo: apiData?.titulo ?? (modelSummary || null),
    ano: apiData?.ano ?? null,
    cor: apiData?.cor ?? aiResult.cor,
    combustivel: apiData?.combustivel ?? null,
    chassi: apiData?.chassi ?? null,
    source: apiData ? "simplesapi" : "ai",
    notice: lookupNotice,
  }, { headers: { "Cache-Control": "no-store" } });
}
