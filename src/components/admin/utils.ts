import { useCallback, useEffect, useState, type DragEvent, type MouseEvent, type TouchEvent } from "react";
import { deleteRow, insertRow, selectRows, updateRow, type PanelRecord } from "../../lib/supabase";
import { confirmModal } from "./ConfirmDialog";

export const modalBackdropProps = (onClose: () => void) => ({
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => {
    e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
  },
  onClick: (e: MouseEvent<HTMLDivElement>) => {
    const ok = e.currentTarget.dataset.backdropDown === "1" && e.target === e.currentTarget;
    delete e.currentTarget.dataset.backdropDown;
    if (ok) onClose();
  },
});

export const money = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

export const dateText = (value: unknown, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => {
  if (!value) return "—";
  const source = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T12:00:00` : source);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("pt-BR", options).format(date);
};

export const todayIso = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export type VehicleActionPrefill = {
  plate: string;
  customerName: string;
  make: string;
  model: string;
  year: string;
  phone: string;
};

const VEHICLE_ACTION_PREFILL_KEY = "benittes_admin_vehicle_action_prefill";
const VEHICLE_OWNER_LOOKUP_KEY = "benittes_admin_vehicle_owner_lookup";

export function saveVehicleActionPrefill(prefill: VehicleActionPrefill) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(VEHICLE_ACTION_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // The form can still be opened if session storage is unavailable.
  }
}

export function consumeVehicleActionPrefill(): VehicleActionPrefill | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("novo") !== "1") return null;

  const fromQuery = {
    plate: params.get("placa") ?? "",
    customerName: params.get("cliente") ?? "",
    make: params.get("marca") ?? "",
    model: params.get("modelo") ?? "",
    year: params.get("ano") ?? "",
    phone: params.get("telefone") ?? "",
  };
  let prefill = fromQuery;
  try {
    const stored = window.sessionStorage.getItem(VEHICLE_ACTION_PREFILL_KEY);
    window.sessionStorage.removeItem(VEHICLE_ACTION_PREFILL_KEY);
    if (stored) {
      const value = JSON.parse(stored) as Partial<VehicleActionPrefill>;
      prefill = {
        plate: typeof value.plate === "string" ? value.plate : "",
        customerName: typeof value.customerName === "string" ? value.customerName : "",
        make: typeof value.make === "string" ? value.make : "",
        model: typeof value.model === "string" ? value.model : "",
        year: typeof value.year === "string" ? value.year : "",
        phone: typeof value.phone === "string" ? value.phone : "",
      };
    }
  } catch {
    try {
      window.sessionStorage.removeItem(VEHICLE_ACTION_PREFILL_KEY);
    } catch {
      // Ignore blocked browser storage.
    }
  }
  for (const key of ["novo", "placa", "cliente", "marca", "modelo", "ano", "telefone"]) {
    params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
  return prefill;
}

export function saveVehicleOwnerLookup(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(VEHICLE_OWNER_LOOKUP_KEY, name);
  } catch {
    // The client list remains available when session storage is unavailable.
  }
}

export function consumeVehicleOwnerLookup(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("ver-proprietario") !== "1") return null;
  let name = "";
  try {
    name = window.sessionStorage.getItem(VEHICLE_OWNER_LOOKUP_KEY) ?? "";
    window.sessionStorage.removeItem(VEHICLE_OWNER_LOOKUP_KEY);
  } catch {
    // Fall through to an empty client search.
  }
  params.delete("ver-proprietario");
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
  return name || null;
}

export const detail = (row: PanelRecord, key: string): unknown => {
  const d = row.details;
  return d && typeof d === "object" ? (d as Record<string, unknown>)[key] : undefined;
};

export const asText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

export function whatsappApprovalUrl(row: PanelRecord, kind: "orcamento" | "os"): string {
  const rawDigits = (row.phone ?? "").replace(/\D/g, "");
  const phone =
    rawDigits.length === 10 || rawDigits.length === 11 ? `55${rawDigits}` : rawDigits;
  const cliente = (row.customer_name ?? "").trim() || "cliente";
  const veiculo = (row.vehicle ?? "").trim() || "não informado";
  const hasFinalPrice = Number(row.amount) > 0;
  const valor = hasFinalPrice ? money(row.amount) : null;
  const validade = detail(row, "validade") ? dateText(detail(row, "validade")) : null;
  const obs = (row.description ?? "").trim();

  const lines = [
    `Olá, ${cliente}! Aqui é da *Benittes Oficina Mecânica*.`,
    kind === "orcamento"
      ? "Segue o orçamento para sua aprovação:"
      : "Segue sua Ordem de Serviço para aprovação:",
    `• *Serviço:* ${row.title}`,
    `• *Veículo:* ${veiculo}`,
    ...(valor ? [`• *Valor:* ${valor}`] : ["• *Valor:* em definição pela equipe da oficina."]),
    ...(validade ? [`• *Validade:* ${validade}`] : []),
    ...(obs ? [`• *Detalhes:* ${obs}`] : []),
    ...(hasFinalPrice
      ? ["Podemos aprovar e dar andamento?"]
      : ["Este envio é apenas informativo; a aprovação será solicitada quando o valor final estiver definido."]),
  ];

  const text = encodeURIComponent(lines.join("\n"));
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}

export function useModuleRecords(moduleName: string, userId: string) {
  const [rows, setRows] = useState<PanelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await selectRows<PanelRecord>(moduleName, {
        order: "created_at.desc",
        limit: "500",
      });
      setRows(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os registros.");
    } finally {
      setLoading(false);
    }
  }, [moduleName]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRecord(editing: PanelRecord | null, payload: Record<string, unknown>) {
    const result = editing
      ? await updateRow<PanelRecord>(moduleName, editing.id, payload)
      : await insertRow<PanelRecord>(moduleName, { ...payload, module: moduleName, created_by: userId });
    if (result[0]) {
      setRows((current) =>
        editing
          ? current.map((row) => (row.id === result[0].id ? result[0] : row))
          : [result[0], ...current],
      );
    }
    return result[0];
  }

  async function patchRecord(id: string, updates: Record<string, unknown>) {
    const result = await updateRow<PanelRecord>(moduleName, id, updates);
    if (result[0]) {
      const deleted = Boolean(
        result[0].details &&
          typeof result[0].details === "object" &&
          (result[0].details as Record<string, unknown>).deleted_after_finalize,
      );
      setRows((current) =>
        deleted
          ? current.filter((row) => row.id !== id)
          : current.map((row) => (row.id === id ? result[0] : row)),
      );
    }
    return result[0];
  }

  async function removeRecord(row: PanelRecord) {
    const ok = await confirmModal({
      title: "Confirmar exclusão",
      message: `Tem certeza que deseja excluir "${row.title}"? Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    await deleteRow(moduleName, row.id);
    setRows((current) => current.filter((item) => item.id !== row.id));
  }

  return { rows, setRows, loading, error, setError, load, saveRecord, patchRecord, removeRecord };
}

export function useKanbanDrag(onDropToLane: (rowId: string, laneKey: string) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);
  const [touchGhost, setTouchGhost] = useState<{ label: string; x: number; y: number } | null>(null);

  function cardDragProps(row: PanelRecord) {
    return {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData("text/plain", row.id);
        e.dataTransfer.effectAllowed = "move";
        setDraggingId(row.id);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setDragOverLane(null);
      },
    };
  }

  function handleTouchProps(row: PanelRecord) {
    return {
      onTouchStart: (e: TouchEvent<HTMLElement>) => {
        const touch = e.touches[0];
        if (!touch) return;
        setDraggingId(row.id);
        setTouchGhost({ label: row.title, x: touch.clientX, y: touch.clientY });
      },
      onTouchMove: (e: TouchEvent<HTMLElement>) => {
        const touch = e.touches[0];
        if (!touch) return;
        setTouchGhost((prev) => (prev ? { ...prev, x: touch.clientX, y: touch.clientY } : null));
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const lane = el?.closest("[data-lane-key]") as HTMLElement | null;
        setDragOverLane(lane?.dataset.laneKey ?? null);
      },
      onTouchEnd: (e: TouchEvent<HTMLElement>) => {
        const touch = e.changedTouches[0];
        if (touch) {
          const el = document.elementFromPoint(touch.clientX, touch.clientY);
          const lane = el?.closest("[data-lane-key]") as HTMLElement | null;
          const targetLane = lane?.dataset.laneKey;
          if (targetLane) {
            onDropToLane(row.id, targetLane);
          }
        }
        setDraggingId(null);
        setDragOverLane(null);
        setTouchGhost(null);
      },
      onTouchCancel: () => {
        setDraggingId(null);
        setDragOverLane(null);
        setTouchGhost(null);
      },
    };
  }

  function laneDropProps(laneKey: string) {
    return {
      "data-lane-key": laneKey,
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverLane !== laneKey) setDragOverLane(laneKey);
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOverLane((prev) => (prev === laneKey ? null : prev));
        }
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const rowId = e.dataTransfer.getData("text/plain") || draggingId;
        setDragOverLane(null);
        setDraggingId(null);
        if (rowId) onDropToLane(rowId, laneKey);
      },
    };
  }

  return { draggingId, dragOverLane, touchGhost, cardDragProps, handleTouchProps, laneDropProps };
}

export function usePersistedViewMode<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const [mode, setMode] = useState<T>(fallback);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`admin-view-${key}`) as T | null;
      if (saved && allowed.includes(saved)) {
        setMode(saved);
      }
    } catch {
      // ignore storage errors
    }
  }, [key]);

  const updateMode = useCallback(
    (next: T) => {
      setMode(next);
      try {
        window.localStorage.setItem(`admin-view-${key}`, next);
      } catch {
        // ignore storage errors
      }
    },
    [key],
  );

  return [mode, updateMode];
}
