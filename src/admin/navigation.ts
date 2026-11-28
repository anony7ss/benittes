import { hasModulePermission, type PanelPermissions } from "./permissions";

export type AdminPage = {
  path: string;
  label: string;
  group: "Operação" | "Cadastros" | "Oficina" | "Comercial" | "Financeiro" | "Administração" | "Acesso";
  icon: string;
  module?: string;
  description?: string;
  special?: "dashboard" | "login" | "recovery" | "contacts" | "settings" | "account" | "bot" | "ponto" | "updates";
  footer?: boolean;
};

export const adminPages: AdminPage[] = [
  { path: "", label: "Visão geral", group: "Operação", icon: "dashboard", special: "dashboard", description: "Indicadores, agenda e movimentação da oficina." },
  { path: "agenda", label: "Agenda", group: "Operação", icon: "agenda", module: "appointments", description: "Entradas previstas, retornos e horários do box." },
  { path: "ordens-de-servico", label: "Ordens de serviço", group: "Operação", icon: "orders", module: "work-orders", description: "Execução no box, diagnóstico técnico e entregas." },
  { path: "orcamentos", label: "Orçamentos", group: "Operação", icon: "quotes", module: "quotes", description: "Propostas, aprovação do cliente e validade." },
  { path: "inspecoes", label: "Inspeções", group: "Operação", icon: "inspections", module: "inspections", description: "Checklists veiculares por sistema e laudos." },

  { path: "clientes", label: "Clientes", group: "Cadastros", icon: "clients", module: "clients", description: "Base de clientes, contatos e histórico de retorno." },
  { path: "veiculos", label: "Veículos", group: "Cadastros", icon: "vehicles", module: "vehicles", description: "Placas, modelos, quilometragem e ficha técnica." },
  { path: "servicos", label: "Serviços", group: "Oficina", icon: "services", module: "services", description: "Catálogo de mão de obra, tempo estimado e valores." },
  { path: "precos", label: "Preços por veículo", group: "Oficina", icon: "prices", module: "prices", description: "Tarifas específicas por marca, modelo e ano." },
  { path: "estoque", label: "Estoque", group: "Oficina", icon: "inventory", module: "inventory", description: "Peças, insumos, estoque mínimo e margem." },

  { path: "chat", label: "Chat", group: "Comercial", icon: "chat", module: "chat", description: "Conversas do WhatsApp com atendimento manual e controle do bot." },
  { path: "contatos", label: "Mensagens", group: "Comercial", icon: "contacts", special: "contacts", description: "Solicitações recebidas pelo formulário do site." },
  { path: "financeiro", label: "Finanças", group: "Financeiro", icon: "finance", module: "finance", description: "Receitas, despesas, fluxo de caixa e vencimentos." },
  { path: "vendas", label: "Vendas e PDV", group: "Comercial", icon: "sales", module: "sales", description: "Vendas de balcão, formas de pagamento e comandas." },

  { path: "relatorios", label: "Relatórios", group: "Administração", icon: "reports", module: "reports", description: "Extração por período e exportação CSV." },
  { path: "ponto", label: "Ponto Eletrônico", group: "Administração", icon: "agenda", special: "ponto", description: "Registro de entrada, intervalo, saída e horas." },
  { path: "bot", label: "Bot WhatsApp", group: "Administração", icon: "bot", special: "bot", description: "Conexão QR Code, terminal ao vivo e automações." },
  { path: "galeria", label: "Galeria do site", group: "Administração", icon: "gallery", module: "gallery", description: "Fotos, vídeos, destaques e ordem de exibição no site." },
  { path: "conta", label: "Conta & Equipe", group: "Administração", icon: "account", special: "account", description: "Seu perfil, equipe, permissões e auditoria." },
  { path: "configuracoes", label: "Configurações", group: "Administração", icon: "settings", special: "settings", description: "Parâmetros da oficina e conteúdo do site." },
  { path: "novidades", label: "Novidades", group: "Administração", icon: "updates", special: "updates", footer: true, description: "Melhorias recentes do painel explicadas sem termos técnicos." },

  { path: "login", label: "Entrar", group: "Acesso", icon: "account", special: "login" },
  { path: "recuperar-senha", label: "Recuperar senha", group: "Acesso", icon: "account", special: "recovery" },
];

export const findAdminPage = (path: string) =>
  adminPages.find((page) => page.path === path) ?? null;

export const routeFor = (path: string) => (path ? `/painel/${path}/` : "/painel/");

export function canSeePage(role: string, page: AdminPage, permissions?: PanelPermissions | null): boolean {
  if (role === "owner") return true;
  if (page.special === "updates") return true;
  if (permissions) {
    const module = page.module ?? (page.special === "dashboard" || page.special === "account" || page.special === "ponto" || page.special === "contacts" || page.special === "settings" || page.special === "bot" ? page.special : null);
    return Boolean(module && hasModulePermission(permissions, module));
  }
  if (role === "manager") return true;
  if (page.special === "dashboard" || page.special === "account" || page.special === "ponto") return true;
  if (page.special === "contacts") return role === "advisor";
  if (page.special === "settings" || page.special === "bot") return false;
  const roleModules: Record<string, string[]> = {
    advisor: ["appointments", "work-orders", "quotes", "inspections", "clients", "vehicles", "services", "prices", "reports", "chat"],
    technician: ["appointments", "work-orders", "inspections", "vehicles", "inventory"],
    finance: ["finance", "sales", "reports"],
  };
  return Boolean(page.module && roleModules[role]?.includes(page.module));
}
