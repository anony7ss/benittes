export const PANEL_PERMISSION_MODULES = [
  { key: "dashboard", label: "Visão geral" },
  { key: "appointments", label: "Agenda" },
  { key: "work-orders", label: "Ordens de serviço" },
  { key: "quotes", label: "Orçamentos" },
  { key: "inspections", label: "Inspeções" },
  { key: "clients", label: "Clientes" },
  { key: "vehicles", label: "Veículos" },
  { key: "services", label: "Serviços" },
  { key: "prices", label: "Preços por veículo" },
  { key: "packages", label: "Pacotes" },
  { key: "inventory", label: "Estoque" },
  { key: "purchases", label: "Compras" },
  { key: "suppliers", label: "Fornecedores" },
  { key: "finance", label: "Finanças" },
  { key: "cash-closing", label: "Fechamento de caixa" },
  { key: "sales", label: "Vendas" },
  { key: "reports", label: "Relatórios" },
  { key: "contacts", label: "Mensagens do site" },
  { key: "crm", label: "Relacionamento" },
  { key: "documents", label: "Documentos" },
  { key: "notifications", label: "Notificações" },
  { key: "employees", label: "Equipe de funcionários" },
  { key: "warranties", label: "Garantias" },
  { key: "fleets", label: "Frotas" },
  { key: "settings", label: "Configurações do site" },
  { key: "gallery", label: "Galeria do site" },
  { key: "bot", label: "Bot WhatsApp" },
  { key: "ponto", label: "Ponto eletrônico" },
  { key: "account", label: "Conta" },
  { key: "audit", label: "Auditoria" },
] as const;

export type PanelPermissionModule = (typeof PANEL_PERMISSION_MODULES)[number]["key"];
export type ModulePermission = { read: boolean; write: boolean };
export type PanelPermissions = Partial<Record<PanelPermissionModule, ModulePermission>> & {
  "*"?: ModulePermission;
};

export function normalizePanelPermissions(input: unknown): PanelPermissions | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const result: PanelPermissions = {};
  for (const { key } of PANEL_PERMISSION_MODULES) {
    const permission = source[key];
    if (!permission || typeof permission !== "object" || Array.isArray(permission)) continue;
    const record = permission as Record<string, unknown>;
    const write = record.write === true;
    const read = record.read === true || write;
    if (record.read !== undefined && typeof record.read !== "boolean") return null;
    if (record.write !== undefined && typeof record.write !== "boolean") return null;
    result[key] = { read, write };
  }
  return result;
}

export function hasModulePermission(
  permissions: PanelPermissions | null | undefined,
  module: string,
  access: "read" | "write" = "read",
): boolean {
  if (permissions?.["*"]?.[access]) return true;
  const permission = permissions?.[module as PanelPermissionModule];
  return Boolean(permission?.[access]);
}
