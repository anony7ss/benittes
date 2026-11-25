"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { getSession, insertRow, selectRows, type PanelRecord } from "../../lib/supabase";
import { resolveServicePrice, type ServicePriceResolution, type VehiclePriceProfile } from "../../lib/servicePricing";
import { detail, money } from "./utils";

export function useClientVehicleCatalog() {
  const [clients, setClients] = useState<PanelRecord[]>([]);
  const [vehicles, setVehicles] = useState<PanelRecord[]>([]);
  const [services, setServices] = useState<PanelRecord[]>([]);
  const [priceRules, setPriceRules] = useState<PanelRecord[]>([]);

  const reload = useCallback(() => {
    let active = true;
    void Promise.all([
      selectRows<PanelRecord>("clients", {
        order: "title.asc",
        limit: "500",
      }).catch(() => []),
      selectRows<PanelRecord>("vehicles", {
        order: "created_at.desc",
        limit: "500",
      }).catch(() => []),
      selectRows<PanelRecord>("services", {
        order: "title.asc",
        limit: "500",
      }).catch(() => []),
      selectRows<PanelRecord>("prices", {
        order: "title.asc",
        limit: "1000",
      }).catch(() => []),
    ]).then(([cli, veh, srv, prices]) => {
      if (!active) return;
      setClients(cli);
      setVehicles(veh);
      setServices(srv.filter((s) => s.status !== "cancelado"));
      setPriceRules(prices.filter((rule) => rule.status !== "cancelado"));
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => reload(), [reload]);

  return { clients, vehicles, services, priceRules, reload };
}

export async function ensureClientAndVehicle({
  userId,
  clients,
  vehicles,
  customerName,
  phone,
  vehicle,
  km,
  vehicleDetails,
  reload,
}: {
  userId: string;
  clients: PanelRecord[];
  vehicles: PanelRecord[];
  customerName?: string;
  phone?: string;
  vehicle?: string;
  km?: string;
  vehicleDetails?: { marca?: string | null; modelo?: string | null; ano?: string | number | null };
  reload?: () => void;
}) {
  const cleanName = (customerName ?? "").trim();
  const cleanPhone = (phone ?? "").trim();
  const cleanVehicle = (vehicle ?? "").trim().toUpperCase();
  let created = false;

  if (cleanName) {
    const existsClient = clients.some(
      (c) => clientDisplayName(c).toLowerCase() === cleanName.toLowerCase(),
    );
    if (!existsClient) {
      try {
        await insertRow<PanelRecord>("panel_records", {
          module: "clients",
          title: cleanName,
          customer_name: cleanName,
          phone: cleanPhone || null,
          status: "concluido",
          details: {},
          created_by: userId,
        });
        created = true;
      } catch {
        // ignore secondary auto-create failure
      }
    }
  }

  if (cleanVehicle) {
    const existsVehicle = vehicles.some((v) => vehiclePlate(v) === cleanVehicle);
    if (!existsVehicle) {
      try {
        await insertRow<PanelRecord>("panel_records", {
          module: "vehicles",
          title: cleanVehicle,
          vehicle: cleanVehicle,
          customer_name: cleanName || null,
          status: "concluido",
          details: {
            ...(km ? { km } : {}),
            ...(vehicleDetails?.marca ? { marca: vehicleDetails.marca } : {}),
            ...(vehicleDetails?.modelo ? { modelo: vehicleDetails.modelo } : {}),
            ...(vehicleDetails?.ano ? { ano: String(vehicleDetails.ano) } : {}),
          },
          created_by: userId,
        });
        created = true;
      } catch {
        // ignore secondary auto-create failure
      }
    }
  }

  if (created && reload) {
    reload();
  }
}

export function clientDisplayName(c: PanelRecord): string {
  return (c.customer_name || c.title || "").trim();
}

export function vehiclePlate(v: PanelRecord): string {
  return (v.vehicle || v.title || "").trim().toUpperCase();
}

export function vehicleSummary(v: PanelRecord): string {
  const plate = vehiclePlate(v);
  const marca = String(detail(v, "marca") ?? "").trim();
  const modelo = String(detail(v, "modelo") ?? v.title ?? "").trim();
  const modelText = [marca, modelo].filter(Boolean).join(" ");
  const owner = (v.customer_name || "").trim();
  return [plate, modelText && modelText !== plate ? modelText : "", owner ? `(${owner})` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function ClientPicker({
  clients,
  value,
  onSelectClient,
}: {
  clients: PanelRecord[];
  value: string;
  onSelectClient: (client: PanelRecord | null) => void;
}) {
  if (clients.length === 0) return null;

  const matched = clients.find(
    (c) => clientDisplayName(c).toLowerCase() === value.trim().toLowerCase(),
  );

  return (
    <select
      className="admin-select"
      value={matched?.id ?? ""}
      onChange={(e) => {
        const picked = clients.find((c) => c.id === e.target.value) ?? null;
        onSelectClient(picked);
      }}
      style={{ marginBottom: 6 }}
    >
      <option value="">Selecionar cliente salvo…</option>
      {clients.map((c) => {
        const name = clientDisplayName(c);
        return (
          <option key={c.id} value={c.id}>
            {name}
            {c.phone ? ` · ${c.phone}` : ""}
          </option>
        );
      })}
    </select>
  );
}

export function VehiclePicker({
  vehicles,
  value,
  clientName,
  onSelectVehicle,
}: {
  vehicles: PanelRecord[];
  value: string;
  clientName?: string;
  onSelectVehicle: (vehicle: PanelRecord | null) => void;
}) {
  if (vehicles.length === 0) return null;

  const normalizedClient = (clientName ?? "").trim().toLowerCase();
  const sorted = [...vehicles].sort((a, b) => {
    if (!normalizedClient) return 0;
    const aMatch = (a.customer_name ?? "").trim().toLowerCase() === normalizedClient ? 0 : 1;
    const bMatch = (b.customer_name ?? "").trim().toLowerCase() === normalizedClient ? 0 : 1;
    return aMatch - bMatch;
  });

  const matched = vehicles.find(
    (v) => vehiclePlate(v) === value.trim().toUpperCase(),
  );

  return (
    <select
      className="admin-select"
      value={matched?.id ?? ""}
      onChange={(e) => {
        const picked = vehicles.find((v) => v.id === e.target.value) ?? null;
        onSelectVehicle(picked);
      }}
      style={{ marginBottom: 6 }}
    >
      <option value="">Selecionar veículo salvo…</option>
      {sorted.map((v) => (
        <option key={v.id} value={v.id}>
          {vehicleSummary(v)}
        </option>
      ))}
    </select>
  );
}

export type PlateLookupResult = {
  plate: string;
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  cor: string | null;
  combustivel: string | null;
  chassi: string | null;
};

export function PlateLookupButton({
  plate,
  onFound,
}: {
  plate: string;
  onFound: (data: PlateLookupResult) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const clean = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 7 || busy) return;
    setBusy(true);
    try {
      const sess = await getSession();
      const res = await fetch("/api/admin/vehicles/plate-ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
        },
        body: JSON.stringify({ plate: clean }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as PlateLookupResult;
      if (json.plate) onFound(json);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="admin-secondary"
      style={{ flexShrink: 0, padding: "0 11px", minHeight: 40 }}
      disabled={busy || plate.trim().replace(/[^A-Z0-9]/gi, "").length < 7}
      onClick={() => void handleClick()}
      title="Consultar placa na API e preencher dados"
    >
      <Search size={13} />
      {busy ? "..." : "Preencher"}
    </button>
  );
}

export function ServicePicker({
  services,
  priceRules = [],
  value,
  vehicleProfile = null,
  onSelectService,
}: {
  services: PanelRecord[];
  value: string;
  priceRules?: PanelRecord[];
  vehicleProfile?: VehiclePriceProfile;
  onSelectService: (service: PanelRecord | null, resolution: ServicePriceResolution | null) => void;
}) {
  if (services.length === 0) return null;

  const matched = services.find(
    (s) => (s.title ?? "").trim().toLowerCase() === value.trim().toLowerCase(),
  );
  const matchedResolution = matched ? resolveServicePrice(matched, priceRules, vehicleProfile) : null;

  return (
    <>
      <select
        className="admin-select"
        value={matched?.id ?? ""}
        onChange={(e) => {
          const picked = services.find((s) => s.id === e.target.value) ?? null;
          onSelectService(picked, picked ? resolveServicePrice(picked, priceRules, vehicleProfile) : null);
        }}
        style={{ marginBottom: 6 }}
      >
        <option value="">Selecionar serviço salvo…</option>
        {services.map((s) => {
          const cat = String(detail(s, "categoria") ?? "").trim();
          const resolution = resolveServicePrice(s, priceRules, vehicleProfile);
          const price = resolution.amount !== null
            ? ` · ${money(resolution.amount)}`
            : ` · ${resolution.mode === "vehicle" ? "Por veículo" : resolution.mode === "assessment" ? "Sob avaliação" : "Preço a definir"}`;
          return (
            <option key={s.id} value={s.id}>
              {s.title}
              {cat ? ` (${cat})` : ""}
              {price}
            </option>
          );
        })}
      </select>
      {matchedResolution && (
        <small style={{ display: "block", margin: "-1px 0 8px", color: "var(--admin-muted)" }}>
          {matchedResolution.amount !== null
            ? `${matchedResolution.message} Valor: ${money(matchedResolution.amount)}.`
            : matchedResolution.message}
        </small>
      )}
    </>
  );
}
