"use client";

export const statusLabels: Record<string, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
  concluido: "Concluído",
  cancelado: "Cancelado",
  new: "Nova",
  read: "Lida",
  replied: "Respondida",
  archived: "Arquivada",
};

export function AdminStatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <span className={`admin-status ${status}`}>
      {label ?? statusLabels[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}
