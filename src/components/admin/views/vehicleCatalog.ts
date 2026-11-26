export type VehicleCatalogOption = {
  code: string;
  name: string;
};

const FIPE_BRAND_ALIASES: Record<string, string> = {
  "gm - chevrolet": "Chevrolet",
  "vw - volkswagen": "Volkswagen",
  "kia motors": "Kia",
  "caoa chery": "CAOA Chery",
};
const NORMALIZED_BRAND_ALIASES: Record<string, string> = {
  gmchevrolet: "chevrolet",
  vwvolkswagen: "volkswagen",
  kiamotors: "kia",
};

export function normalizeVehicleCatalogName(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]/g, "");
  return NORMALIZED_BRAND_ALIASES[normalized] ?? normalized;
}

export function displayFipeBrand(name: string): string {
  const normalized = name.trim().toLocaleLowerCase("pt-BR");
  return FIPE_BRAND_ALIASES[normalized] ?? name.trim();
}

export function findFipeBrandByName(
  brands: VehicleCatalogOption[],
  label: string,
): VehicleCatalogOption | undefined {
  const normalized = normalizeVehicleCatalogName(label);
  return brands.find((brand) => normalizeVehicleCatalogName(displayFipeBrand(brand.name)) === normalized);
}

export function customCatalogKeyForBrand(
  custom: Record<string, string[]>,
  brand: string,
): string | undefined {
  const normalized = normalizeVehicleCatalogName(brand);
  return Object.keys(custom).find((key) => normalizeVehicleCatalogName(key) === normalized);
}

export function customModelsForBrand(custom: Record<string, string[]>, brand: string): string[] {
  const normalized = normalizeVehicleCatalogName(brand);
  return Object.entries(custom)
    .filter(([key, models]) => Array.isArray(models) && normalizeVehicleCatalogName(key) === normalized)
    .flatMap(([, models]) => models.map((model) => String(model).trim()).filter(Boolean));
}

export function mergeVehicleBrands(
  apiBrands: VehicleCatalogOption[],
  custom: Record<string, string[]>,
): string[] {
  const unique = new Map<string, string>();
  for (const brand of apiBrands) {
    const label = displayFipeBrand(brand.name);
    unique.set(normalizeVehicleCatalogName(label), label);
  }
  for (const brand of Object.keys(custom)) {
    const normalized = normalizeVehicleCatalogName(brand);
    if (!unique.has(normalized)) unique.set(normalized, brand.trim());
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function mergeVehicleModels(
  apiModels: VehicleCatalogOption[],
  customModels: string[],
): string[] {
  const unique = new Map<string, string>();
  for (const model of [...apiModels.map((item) => item.name), ...customModels]) {
    const label = String(model ?? "").trim();
    const normalized = normalizeVehicleCatalogName(label);
    if (label && !unique.has(normalized)) unique.set(normalized, label);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
