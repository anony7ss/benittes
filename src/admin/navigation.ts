export type AdminPage = {
  path: string;
  label: string;
  group: "Operação" | "Oficina" | "Comercial" | "Sistema" | "Acesso";
  icon: string;
  module?: string;
  description?: string;
  special?: "dashboard" | "login" | "recovery" | "contacts" | "settings" | "account" | "bot" | "ponto";
};

export const adminPages: AdminPage[] = [
  { path: "", label: "Visão geral", group: "Operação", icon: "dashboard", special: "dashboard", description: "Indicadores, agenda e movimentação da oficina." },
  { path: "agenda", label: "Agenda", group: "Operação", icon: "agenda", module: "appointments", description: "Entradas previstas, retornos e horários do box." },
  { path: "ordens-de-servico", label: "Ordens de serviço", group: "Operação", icon: "orders", module: "work-orders", description: "Execução no box, diagnóstico técnico e entregas." },
  { path: "orcamentos", label: "Orçamentos", group: "Operação", icon: "quotes", module: "quotes", description: "Propostas, aprovação do cliente e validade." },
  { path: "inspecoes", label: "Inspeções", group: "Operação", icon: "inspections", module: "inspections", description: "Checklists veiculares por sistema e laudos." },

  { path: "clientes", label: "Clientes", group: "Oficina", icon: "clients", module: "clients", description: "Base de clientes, contatos e histórico de retorno." },
  { path: "veiculos", label: "Veículos", group: "Oficina", icon: "vehicles", module: "vehicles", description: "Placas, modelos, quilometragem e ficha técnica." },
  { path: "servicos", label: "Serviços", group: "Oficina", icon: "services", module: "services", description: "Catálogo de mão de obra, tempo estimado e valores." },
  { path: "estoque", label: "Estoque", group: "Oficina", icon: "inventory", module: "inventory", description: "Peças, insumos, estoque mínimo e margem." },

  { path: "contatos", label: "Mensagens", group: "Comercial", icon: "contacts", special: "contacts", description: "Solicitações recebidas pelo formulário do site." },
  { path: "financeiro", label: "Finanças", group: "Comercial", icon: "finance", module: "finance", description: "Receitas, despesas, fluxo de caixa e vencimentos." },
  { path: "vendas", label: "Vendas e PDV", group: "Comercial", icon: "sales", module: "sales", description: "Vendas de balcão, formas de pagamento e comandas." },

  { path: "relatorios", label: "Relatórios", group: "Sistema", icon: "reports", module: "reports", description: "Extração por período e exportação CSV." },
  { path: "ponto", label: "Ponto Eletrônico", group: "Sistema", icon: "agenda", special: "ponto", description: "Registro de entrada, intervalo, saída e horas." },
  { path: "bot", label: "Bot WhatsApp", group: "Sistema", icon: "bot", special: "bot", description: "Conexão QR Code, terminal ao vivo e automações." },
  { path: "configuracoes", label: "Configurações", group: "Sistema", icon: "settings", special: "settings", description: "Parâmetros da oficina e conteúdo do site." },
  { path: "conta", label: "Conta & Equipe", group: "Sistema", icon: "account", special: "account", description: "Seu perfil, equipe, permissões e auditoria." },

  { path: "login", label: "Entrar", group: "Acesso", icon: "account", special: "login" },
  { path: "recuperar-senha", label: "Recuperar senha", group: "Acesso", icon: "account", special: "recovery" },
];

export const findAdminPage = (path: string) =>
  adminPages.find((page) => page.path === path) ?? null;

export const routeFor = (path: string) => (path ? `/painel/${path}/` : "/painel/");

export function canSeePage(role: string, page: AdminPage): boolean {
  if (role === "owner") return true;
  if (role === "manager") return true;
  if (page.special === "dashboard" || page.special === "account" || page.special === "ponto") return true;
  if (page.special === "contacts") return role === "advisor";
  if (page.special === "settings") return false;
  const roleModules: Record<string, string[]> = {
    advisor: ["appointments", "work-orders", "quotes", "inspections", "clients", "vehicles", "services", "reports"],
    technician: ["appointments", "work-orders", "inspections", "vehicles", "inventory"],
    finance: ["finance", "sales", "reports"],
  };
  return Boolean(page.module && roleModules[role]?.includes(page.module));
}
