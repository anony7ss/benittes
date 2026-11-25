import type { PanelRecord } from "./supabase";

export const DOMAIN_TABLE_BY_MODULE: Record<string, string> = {
  clients: "clients",
  vehicles: "vehicles",
  services: "services",
  prices: "service_price_rules",
  appointments: "appointments",
  quotes: "quotes",
  "work-orders": "work_orders",
  inspections: "inspections",
  finance: "finance_entries",
  inventory: "inventory_items",
  sales: "sales",
  settings: "workshop_settings",
};

type RawRow = Record<string, unknown>;

function asObj(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function asStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function asNonNegNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function asNullableNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toSettingsKey(rawTitle: string): string {
  const cleaned = rawTitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 79);
  return cleaned || `param-${Date.now()}`;
}

export function fromDomainRow(module: string, row: RawRow): PanelRecord {
  const details = asObj(row.details);
  const id = String(row.id ?? row.key ?? "");
  const created_at = String(row.created_at ?? row.updated_at ?? new Date().toISOString());
  const updated_at = String(row.updated_at ?? created_at);

  switch (module) {
    case "clients":
      return {
        id,
        module,
        title: String(row.full_name ?? ""),
        status: row.active === false ? "cancelado" : "concluido",
        description: asStr(row.notes),
        amount: null,
        customer_name: asStr(row.full_name),
        customer_email: asStr(row.email),
        phone: asStr(row.phone),
        vehicle: null,
        details: {
          ...details,
          ...(row.tax_document ? { documento: row.tax_document } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "vehicles":
      return {
        id,
        module,
        title: String(row.trim ?? row.model ?? row.license_plate ?? ""),
        status: String(row.status ?? "novo"),
        description: asStr(row.notes),
        amount: null,
        customer_name: asStr(row.customer_name),
        customer_email: null,
        phone: null,
        vehicle: asStr(row.license_plate),
        details: {
          ...details,
          ...(row.make ? { marca: row.make } : {}),
          ...(row.model ? { modelo: row.model } : {}),
          ...(row.model_year !== null && row.model_year !== undefined ? { ano: String(row.model_year) } : {}),
          ...(row.mileage !== null && row.mileage !== undefined ? { km: String(row.mileage) } : {}),
          ...(row.fuel_type ? { combustivel: row.fuel_type } : {}),
          ...(row.vin ? { chassi: row.vin } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "services":
      return {
        id,
        module,
        title: String(row.name ?? ""),
        status: row.active === false ? "cancelado" : "concluido",
        description: asStr(row.description),
        amount: asNullableNum(row.base_price),
        customer_name: null,
        customer_email: null,
        phone: null,
        vehicle: null,
        details: {
          ...details,
          ...(row.category ? { categoria: row.category } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "prices":
      return {
        id,
        module,
        title: String(row.name ?? ""),
        status: row.active === false ? "cancelado" : "concluido",
        description: asStr(row.notes),
        amount: asNullableNum(row.price),
        customer_name: null,
        customer_email: null,
        phone: null,
        vehicle: null,
        details: {
          ...details,
          ...(row.service_id ? { service_id: row.service_id } : {}),
          ...(row.vehicle_make ? { vehicle_make: row.vehicle_make } : {}),
          ...(row.vehicle_model ? { vehicle_model: row.vehicle_model } : {}),
          ...(row.year_from !== null && row.year_from !== undefined ? { year_from: row.year_from } : {}),
          ...(row.year_to !== null && row.year_to !== undefined ? { year_to: row.year_to } : {}),
          ...(row.vehicle_application ? { vehicle_application: row.vehicle_application } : {}),
          ...(row.valid_from ? { valid_from: row.valid_from } : {}),
          ...(row.valid_until ? { valid_until: row.valid_until } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "appointments": {
      const dateFromCol = row.starts_at
        ? new Date(String(row.starts_at)).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
        : null;
      const timeFromCol = row.starts_at
        ? new Date(String(row.starts_at)).toLocaleTimeString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;
      const resolvedDate = asStr(details.starts_at) ?? asStr(details.data) ?? dateFromCol;
      const resolvedTime = asStr(details.horario) ?? asStr(details.hora) ?? timeFromCol;
      return {
        id,
        module,
        title: String(row.title ?? ""),
        status: String(row.status ?? "novo"),
        description: asStr(row.notes),
        amount: asNullableNum(row.amount),
        customer_name: asStr(row.customer_name),
        customer_email: null,
        phone: asStr(row.contact_phone),
        vehicle: asStr(row.vehicle_plate),
        details: {
          ...details,
          ...(resolvedDate ? { starts_at: resolvedDate } : {}),
          ...(resolvedTime ? { horario: resolvedTime } : {}),
          ...(row.service_type ? { servico: row.service_type } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };
    }

    case "quotes":
      return {
        id,
        module,
        title: String(row.reference ?? ""),
        status: String(row.status ?? "novo"),
        description: asStr(row.notes),
        amount: asNullableNum(row.total),
        customer_name: asStr(row.customer_name),
        customer_email: null,
        phone: asStr(row.phone),
        vehicle: asStr(row.vehicle_plate),
        details: {
          ...details,
          ...(row.valid_until ? { validade: row.valid_until } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "work-orders":
      return {
        id,
        module,
        title: String(row.reference ?? ""),
        status: String(row.status ?? "novo"),
        description: asStr(row.notes ?? row.diagnosis),
        amount: asNullableNum(row.total),
        customer_name: asStr(row.customer_name),
        customer_email: null,
        phone: asStr(row.phone),
        vehicle: asStr(row.vehicle_plate),
        details,
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "inspections":
      return {
        id,
        module,
        title: String(row.reference ?? ""),
        status: String(row.result ?? "novo"),
        description: asStr(row.notes),
        amount: null,
        customer_name: asStr(row.customer_name),
        customer_email: null,
        phone: asStr(row.phone),
        vehicle: asStr(row.vehicle_plate),
        details,
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "finance":
      return {
        id,
        module,
        title: String(row.description ?? ""),
        status: String(row.status ?? "aguardando"),
        description: asStr(row.notes),
        amount: asNullableNum(row.amount),
        customer_name: asStr(row.party_name),
        customer_email: null,
        phone: null,
        vehicle: null,
        details: {
          ...details,
          tipo: row.direction === "payable" ? "pagar" : "receber",
          ...(row.category ? { categoria: row.category } : {}),
          ...(row.due_at ? { vencimento: row.due_at } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "inventory":
      return {
        id,
        module,
        title: String(row.name ?? ""),
        status: row.active === false ? "cancelado" : "concluido",
        description: asStr(row.notes),
        amount: asNullableNum(row.sale_price),
        customer_name: null,
        customer_email: null,
        phone: null,
        vehicle: null,
        details: {
          ...details,
          ...(row.sku ? { codigo: row.sku } : {}),
          ...(row.category ? { categoria: row.category } : {}),
          quantidade: Number(row.quantity ?? 0),
          minimo: Number(row.minimum_quantity ?? 0),
          unidade: String(row.unit ?? "un"),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "sales":
      return {
        id,
        module,
        title: String(row.reference ?? ""),
        status: String(row.status ?? "concluido"),
        description: asStr(row.notes),
        amount: asNullableNum(row.total),
        customer_name: asStr(row.customer_name),
        customer_email: null,
        phone: asStr(row.phone),
        vehicle: asStr(row.vehicle_plate),
        details: {
          ...details,
          ...(row.payment_method ? { forma_pagamento: row.payment_method } : {}),
        },
        created_by: asStr(row.created_by),
        created_at,
        updated_at,
      };

    case "settings": {
      const val = asObj(row.value);
      return {
        id: String(row.key ?? ""),
        module,
        title: String(val.title ?? row.key ?? ""),
        status: String(val.status ?? "ativo"),
        description: asStr(row.description),
        amount: null,
        customer_name: null,
        customer_email: null,
        phone: null,
        vehicle: null,
        details: asObj(val.details),
        created_by: asStr(row.updated_by),
        created_at: updated_at,
        updated_at,
      };
    }

    default:
      return row as unknown as PanelRecord;
  }
}

export function toDomainPayload(
  module: string,
  input: RawRow,
  isUpdate = false,
): Record<string, unknown> {
  const details = asObj(input.details);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  switch (module) {
    case "clients": {
      const out: Record<string, unknown> = {};
      const name = asStr(input.customer_name) ?? asStr(input.title);
      if (!isUpdate || has("title") || has("customer_name")) {
        out.full_name = (name && name.length >= 2 ? name : `${name ?? "Cliente"}  `.slice(0, 2) + (name ?? "")).slice(0, 160);
        if (name && name.length >= 2) out.full_name = name.slice(0, 160);
      }
      if (!isUpdate || has("customer_email")) out.email = asStr(input.customer_email);
      if (!isUpdate || has("phone")) out.phone = asStr(input.phone);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.active = input.status !== "cancelado";
      if (!isUpdate || has("details")) {
        out.tax_document = asStr(details.documento);
        out.details = details;
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "vehicles": {
      const out: Record<string, unknown> = {};
      const plate = (asStr(input.vehicle) ?? asStr(input.title) ?? "SEMPLACA").toUpperCase().slice(0, 12);
      if (!isUpdate || has("vehicle") || has("title")) {
        out.license_plate = plate.length >= 3 ? plate : plate.padEnd(3, "X");
      }
      if (!isUpdate || has("title")) out.trim = asStr(input.title);
      if (!isUpdate || has("customer_name")) out.customer_name = asStr(input.customer_name);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.status = asStr(input.status) ?? "novo";
      if (!isUpdate || has("details")) {
        const make = asStr(details.marca);
        const model = asStr(details.modelo) ?? asStr(input.title) ?? plate;
        const yearNum = asNullableNum(details.ano);
        const kmNum = asNullableNum(details.km);
        out.make = make;
        out.model = model.slice(0, 120);
        out.model_year = yearNum !== null && yearNum >= 1900 && yearNum <= 2200 ? Math.trunc(yearNum) : null;
        out.mileage = kmNum !== null && kmNum >= 0 ? Math.trunc(kmNum) : null;
        out.fuel_type = asStr(details.combustivel);
        out.vin = asStr(details.chassi);
        out.details = details;
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "services": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) {
        const name = asStr(input.title) ?? "Serviço";
        out.name = (name.length >= 2 ? name : `${name} `).slice(0, 160);
      }
      if (!isUpdate || has("description")) out.description = asStr(input.description);
      if (!isUpdate || has("amount")) out.base_price = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("status")) out.active = input.status !== "cancelado";
      if (!isUpdate || has("details")) {
        out.category = asStr(details.categoria);
        out.details = details;
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "prices": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) {
        const name = asStr(input.title) ?? "Regra de preço";
        out.name = (name.length >= 2 ? name : `${name} `).slice(0, 160);
      }
      if (!isUpdate || has("amount")) out.price = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("status")) out.active = input.status !== "cancelado";
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("details")) {
        out.service_id = asStr(details.service_id);
        out.vehicle_make = asStr(details.vehicle_make);
        out.vehicle_model = asStr(details.vehicle_model);
        out.year_from = asNullableNum(details.year_from);
        out.year_to = asNullableNum(details.year_to);
        out.vehicle_application = asStr(details.vehicle_application);
        out.valid_from = asStr(details.valid_from);
        out.valid_until = asStr(details.valid_until);
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "appointments": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.title = (asStr(input.title) ?? "Agendamento").slice(0, 180);
      if (!isUpdate || has("customer_name")) out.customer_name = asStr(input.customer_name);
      if (!isUpdate || has("phone")) out.contact_phone = asStr(input.phone);
      if (!isUpdate || has("vehicle")) out.vehicle_plate = asStr(input.vehicle);
      if (!isUpdate || has("amount")) out.amount = asNullableNum(input.amount);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.status = asStr(input.status) ?? "novo";
      if (!isUpdate || has("details")) {
        out.service_type = asStr(details.servico);
        const dateStr = asStr(details.starts_at) ?? asStr(details.data);
        const timeStr = asStr(details.horario) ?? asStr(details.hora) ?? "09:00";
        if (dateStr) {
          const parsed = new Date(`${dateStr}T${timeStr}:00-03:00`);
          out.starts_at = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
        } else if (!isUpdate) {
          out.starts_at = new Date().toISOString();
        }
        out.details = details;
      } else if (!isUpdate) {
        out.starts_at = new Date().toISOString();
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "quotes": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.reference = (asStr(input.title) ?? "Orçamento").slice(0, 80);
      if (!isUpdate || has("customer_name")) out.customer_name = asStr(input.customer_name);
      if (!isUpdate || has("phone")) out.phone = asStr(input.phone);
      if (!isUpdate || has("vehicle")) out.vehicle_plate = asStr(input.vehicle);
      if (!isUpdate || has("amount")) out.total = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.status = asStr(input.status) ?? "novo";
      if (!isUpdate || has("details")) {
        out.valid_until = asStr(details.validade);
        out.details = details;
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "work-orders": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.reference = (asStr(input.title) ?? "Ordem de Serviço").slice(0, 80);
      if (!isUpdate || has("customer_name")) out.customer_name = asStr(input.customer_name);
      if (!isUpdate || has("phone")) out.phone = asStr(input.phone);
      if (!isUpdate || has("vehicle")) out.vehicle_plate = asStr(input.vehicle);
      if (!isUpdate || has("amount")) out.total = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.status = asStr(input.status) ?? "novo";
      if (!isUpdate || has("details")) out.details = details;
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "inspections": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.reference = (asStr(input.title) ?? "Inspeção").slice(0, 100);
      if (!isUpdate || has("customer_name")) out.customer_name = asStr(input.customer_name);
      if (!isUpdate || has("phone")) out.phone = asStr(input.phone);
      if (!isUpdate || has("vehicle")) out.vehicle_plate = asStr(input.vehicle);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.result = asStr(input.status) ?? "novo";
      if (!isUpdate || has("details")) out.details = details;
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "finance": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.description = (asStr(input.title) ?? "Lançamento").slice(0, 240);
      if (!isUpdate || has("customer_name")) out.party_name = asStr(input.customer_name);
      if (!isUpdate || has("amount")) out.amount = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.status = asStr(input.status) ?? "aguardando";
      if (!isUpdate || has("details")) {
        out.direction = details.tipo === "pagar" ? "payable" : "receivable";
        out.category = asStr(details.categoria);
        out.due_at = asStr(details.vencimento);
        out.details = details;
      } else if (!isUpdate) {
        out.direction = "receivable";
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "inventory": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.name = (asStr(input.title) ?? "Item").slice(0, 180);
      if (!isUpdate || has("amount")) out.sale_price = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.active = input.status !== "cancelado";
      if (!isUpdate || has("details")) {
        out.sku = asStr(details.codigo);
        out.category = asStr(details.categoria);
        out.quantity = asNonNegNum(details.quantidade, 0);
        out.minimum_quantity = asNonNegNum(details.minimo, 0);
        out.unit = asStr(details.unidade) ?? "un";
        out.details = details;
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "sales": {
      const out: Record<string, unknown> = {};
      if (!isUpdate || has("title")) out.reference = (asStr(input.title) ?? "Venda").slice(0, 100);
      if (!isUpdate || has("customer_name")) out.customer_name = asStr(input.customer_name);
      if (!isUpdate || has("phone")) out.phone = asStr(input.phone);
      if (!isUpdate || has("vehicle")) out.vehicle_plate = asStr(input.vehicle);
      if (!isUpdate || has("amount")) out.total = asNonNegNum(input.amount, 0);
      if (!isUpdate || has("description")) out.notes = asStr(input.description);
      if (!isUpdate || has("status")) out.status = asStr(input.status) ?? "concluido";
      if (!isUpdate || has("details")) {
        out.payment_method = asStr(details.forma_pagamento);
        out.details = details;
      }
      if (!isUpdate && input.created_by) out.created_by = input.created_by;
      return out;
    }

    case "settings": {
      const titleStr = asStr(input.title) ?? "config";
      const out: Record<string, unknown> = {};
      if (!isUpdate) out.key = toSettingsKey(titleStr);
      if (!isUpdate || has("details")) out.scope = asStr(details.category) ?? "general";
      if (!isUpdate || has("description")) out.description = asStr(input.description);
      if (!isUpdate || has("title") || has("status") || has("details")) {
        out.value = {
          title: titleStr,
          status: asStr(input.status) ?? "ativo",
          details,
        };
      }
      if (!isUpdate && input.created_by) out.updated_by = input.created_by;
      return out;
    }

    default:
      return input;
  }
}
