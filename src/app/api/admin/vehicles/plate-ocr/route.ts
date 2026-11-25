import { NextRequest, NextResponse } from "next/server";
import { requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const PLATE_REGEX = /\b([A-Z]{3}[-\s]?[0-9][A-Z0-9][0-9]{2})\b/i;

type VehicleLookup = {
  plate: string;
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  cor: string | null;
  combustivel: string | null;
  chassi: string | null;
  source: "simplesapi" | "ai" | "none";
};

async function lookupPlateSimplesApi(plate: string): Promise<VehicleLookup | null> {
  const apiKey = process.env.SIMPLESAPI_KEY || "";
  if (!apiKey || !plate) return null;

  try {
    const res = await fetch("https://api.simplesapi.com.br/v1/vehicle/plate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plate }),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as Record<string, unknown>;
    const payload =
      json.data && typeof json.data === "object"
        ? (json.data as Record<string, unknown>)
        : json.vehicle && typeof json.vehicle === "object"
          ? (json.vehicle as Record<string, unknown>)
          : json;

    const str = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = payload[k];
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          return String(v).trim();
        }
      }
      return null;
    };

    return {
      plate,
      marca: str("brand", "marca", "make", "fabricante"),
      modelo: str("model", "modelo", "vehicle_model"),
      ano: str("model_year", "ano_modelo", "year", "ano", "anoModelo"),
      cor: str("color", "cor"),
      combustivel: str("fuel", "combustivel", "fuel_type"),
      chassi: str("chassis", "chassi", "vin"),
      source: "simplesapi",
    };
  } catch {
    return null;
  }
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
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    imageBase64?: unknown;
    plate?: unknown;
  } | null;

  const manualPlate = String(body?.plate ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (manualPlate) {
    if (manualPlate.length < 7) {
      return NextResponse.json({ error: "Informe uma placa válida (7 caracteres)." }, { status: 400 });
    }
    const found = await lookupPlateSimplesApi(manualPlate);
    if (!found) {
      return NextResponse.json(
        { error: "Não foi possível consultar esta placa na API no momento." },
        { status: 404 },
      );
    }
    return NextResponse.json(found);
  }

  const raw = String(body?.imageBase64 ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Envie uma imagem ou informe a placa." }, { status: 400 });
  }

  const base64Data = raw.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  const mimeMatch = raw.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

  const aiResult = await extractPlateWithAi(mimeType, base64Data);
  if (!aiResult.plate) {
    return NextResponse.json({
      plate: null,
      notice:
        "Não foi possível identificar a placa na foto (verifique GEMINI_API_KEY/OPENAI_API_KEY ou digite a placa para consultar pela SimplesAPI).",
    });
  }

  // Após a IA ler a placa, chama automaticamente a ferramenta SimplesAPI para buscar marca, modelo, ano, cor, combustível e chassi
  const apiData = await lookupPlateSimplesApi(aiResult.plate);
  return NextResponse.json({
    plate: aiResult.plate,
    marca: apiData?.marca ?? aiResult.marca,
    modelo: apiData?.modelo ?? aiResult.modelo,
    ano: apiData?.ano ?? null,
    cor: apiData?.cor ?? aiResult.cor,
    combustivel: apiData?.combustivel ?? null,
    chassi: apiData?.chassi ?? null,
    source: apiData ? "simplesapi" : "ai",
  });
}
