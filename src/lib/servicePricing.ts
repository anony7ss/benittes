import type { PanelRecord } from "./supabase";

export type PricingMode = "fixed" | "vehicle" | "assessment";

export type VehiclePriceProfile = {
  make?: unknown;
  model?: unknown;
  year?: unknown;
} | null;

export type ServicePriceResolution = {
  mode: PricingMode;
  amount: number | null;
  state: "priced" | "needs-vehicle" | "rule-not-found" | "ambiguous" | "assessment" | "missing-fixed";
  message: string;
  rule?: PanelRecord;
};

function detailsOf(row: PanelRecord | null | undefined): Record<string, unknown> {
  return row?.details && typeof row.details === "object" ? row.details : {};
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalize(value: unknown): string {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function positiveAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function yearValue(value: unknown): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function pricingModeForService(service: PanelRecord | null | undefined): PricingMode {
  const configured = text(detailsOf(service).pricing_mode);
  if (configured === "fixed" || configured === "vehicle" || configured === "assessment") {
    return configured;
  }
  // Older catalog rows with a real price stay fixed. A blank or zero price is
  // treated as an assessment, never presented as a free service.
  return positiveAmount(service?.amount) !== null ? "fixed" : "assessment";
}

export function vehiclePriceProfileFromRow(vehicle: PanelRecord | null | undefined): VehiclePriceProfile {
  if (!vehicle) return null;
  const details = detailsOf(vehicle);
  return {
    make: details.marca,
    model: details.modelo ?? vehicle.title,
    year: details.ano,
  };
}

export function mergeVehiclePriceProfile(
  vehicle: PanelRecord | null | undefined,
  overrides?: { make?: unknown; model?: unknown; year?: unknown },
): VehiclePriceProfile {
  const saved = vehiclePriceProfileFromRow(vehicle) ?? {};
  return {
    make: text(overrides?.make) || saved.make,
    model: text(overrides?.model) || saved.model,
    year: text(overrides?.year) || saved.year,
  };
}

export function resolveServicePrice(
  service: PanelRecord | null | undefined,
  priceRules: PanelRecord[],
  vehicle: VehiclePriceProfile,
): ServicePriceResolution {
  const mode = pricingModeForService(service);
  if (!service) {
    return { mode, amount: null, state: "missing-fixed", message: "Selecione um serviço do catálogo." };
  }

  if (mode === "fixed") {
    const promo = positiveAmount(detailsOf(service).preco_promo);
    const amount = promo ?? positiveAmount(service.amount);
    return amount === null
      ? { mode, amount: null, state: "missing-fixed", message: "Cadastre um valor fixo antes de usar este serviço." }
      : { mode, amount, state: "priced", message: "Valor fixo do catálogo." };
  }

  if (mode === "assessment") {
    return { mode, amount: null, state: "assessment", message: "Valor definido após avaliação." };
  }

  const profileMake = normalize(vehicle?.make);
  const profileModel = normalize(vehicle?.model);
  const profileYear = yearValue(vehicle?.year);
  if (!profileMake || !profileModel) {
    const missing = [!profileMake ? "marca" : "", !profileModel ? "modelo" : ""].filter(Boolean);
    return {
      mode,
      amount: null,
      state: "needs-vehicle",
      message: `Para preparar o orçamento, informe ${missing.join(" e ")} do veículo.`,
    };
  }

  const today = todayIso();
  if (profileYear === null && priceRules.some((rule) => {
    if (rule.status === "cancelado" || text(detailsOf(rule).service_id) !== service.id) return false;
    const details = detailsOf(rule);
    const ruleMake = normalize(details.vehicle_make);
    const ruleModel = normalize(details.vehicle_model);
    const amount = positiveAmount(rule.amount);
    const validFrom = text(details.valid_from);
    const validUntil = text(details.valid_until);
    return amount !== null
      && (ruleMake || ruleModel)
      && (!ruleMake || ruleMake === profileMake)
      && (!ruleModel || ruleModel === profileModel)
      && (yearValue(details.year_from) !== null || yearValue(details.year_to) !== null)
      && (!validFrom || validFrom <= today)
      && (!validUntil || validUntil >= today);
  })) {
    return {
      mode,
      amount: null,
      state: "needs-vehicle",
      message: "Para preparar o orçamento, informe o ano do veículo.",
    };
  }

  const matches = priceRules.flatMap((rule) => {
    if (rule.status === "cancelado" || text(detailsOf(rule).service_id) !== service.id) return [];
    const details = detailsOf(rule);
    const ruleMake = normalize(details.vehicle_make);
    const ruleModel = normalize(details.vehicle_model);
    const yearFrom = yearValue(details.year_from);
    const yearTo = yearValue(details.year_to);
    const validFrom = text(details.valid_from);
    const validUntil = text(details.valid_until);
    const amount = positiveAmount(rule.amount);

    if ((!ruleMake && !ruleModel) || amount === null) return [];
    if (ruleMake && (!profileMake || ruleMake !== profileMake)) return [];
    if (ruleModel && (!profileModel || ruleModel !== profileModel)) return [];
    if ((yearFrom !== null || yearTo !== null) && profileYear === null) return [];
    if (yearFrom !== null && profileYear! < yearFrom) return [];
    if (yearTo !== null && profileYear! > yearTo) return [];
    if (validFrom && validFrom > today) return [];
    if (validUntil && validUntil < today) return [];

    const yearSpecificity = yearFrom === null && yearTo === null
      ? 0
      : yearFrom !== null && yearTo !== null
        ? 10_000 - Math.min(9_999, yearTo - yearFrom)
        : 1_000;
    const vehicleSpecificity = ruleMake && ruleModel ? 10_000_000 : ruleMake || ruleModel ? 1_000_000 : 0;
    const specificity = vehicleSpecificity + yearSpecificity;
    return [{ rule, amount, specificity }];
  });

  if (matches.length === 0) {
    return {
      mode,
      amount: null,
      state: "rule-not-found",
      message: "Não há uma tarifa cadastrada para este veículo. Defina o valor após avaliação.",
    };
  }

  const bestSpecificity = Math.max(...matches.map((match) => match.specificity));
  const best = matches.filter((match) => match.specificity === bestSpecificity);
  const distinctAmounts = new Set(best.map((match) => match.amount));
  if (distinctAmounts.size > 1) {
    return {
      mode,
      amount: null,
      state: "ambiguous",
      message: "Há tarifas conflitantes para este veículo. Revise as regras antes de enviar o orçamento.",
    };
  }

  return {
    mode,
    amount: best[0].amount,
    state: "priced",
    message: `Tarifa específica: ${best[0].rule.title}.`,
    rule: best[0].rule,
  };
}
