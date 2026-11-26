export const AGENT_CATALOG = [
  {
    key: "gabriel",
    name: "Gabriel",
    role: "Consultor técnico",
    summary: "Serviços, aplicação por veículo e estimativas internas.",
    color: "blue",
    suggestions: [
      "Quais serviços precisam de uma regra de preço por veículo?",
      "Confira as regras cadastradas para um veículo.",
      "Ajude a organizar uma rotina de revisão do catálogo.",
    ],
    capabilities: ["Catálogo de serviços", "Regras de preço autorizadas", "Checklist de revisão"],
    routineKinds: ["services_without_price"],
  },
  {
    key: "nathalia",
    name: "Nathalia",
    role: "Atendimento e agenda",
    summary: "Agenda, preparação de atendimento e próximos compromissos.",
    color: "teal",
    suggestions: [
      "O que está marcado para hoje?",
      "Há horários sem dados do veículo?",
      "Monte uma lista de preparação para amanhã.",
    ],
    capabilities: ["Agenda autorizada", "Preparação de atendimento", "Rotina diária"],
    routineKinds: ["agenda_daily"],
  },
  {
    key: "caio",
    name: "Caio",
    role: "Operações da oficina",
    summary: "Ordens em andamento, pendências e fluxo do box.",
    color: "slate",
    suggestions: [
      "Quais ordens estão em andamento?",
      "Existe alguma ordem sem atualização recente?",
      "Ajude a preparar a passagem de turno.",
    ],
    capabilities: ["Ordens autorizadas", "Pendências operacionais", "Rotina de acompanhamento"],
    routineKinds: ["work_orders_stale"],
  },
  {
    key: "marina",
    name: "Marina",
    role: "Analista financeira",
    summary: "Indicadores agregados de entradas, saídas e vencimentos.",
    color: "indigo",
    suggestions: [
      "Faça um resumo financeiro dos últimos sete dias.",
      "Compare entradas e saídas do mês atual.",
      "Que conferência financeira vale automatizar semanalmente?",
    ],
    capabilities: ["Resumo agregado", "Contas a vencer", "Rotina financeira semanal"],
    routineKinds: ["finance_weekly"],
  },
] as const;

export type AgentKey = (typeof AGENT_CATALOG)[number]["key"];
export type AgentRoutineKind = (typeof AGENT_CATALOG)[number]["routineKinds"][number];
export type AgentCatalogItem = (typeof AGENT_CATALOG)[number];

export type AgentProfile = {
  agent_key: AgentKey;
  enabled: boolean;
  objectives: string[];
  knowledge: string[];
  agreements: string[];
  memories: string[];
  alerts: Array<{ id: string; text: string; created_at: string }>;
  routines: Array<{
    id: string;
    kind: AgentRoutineKind;
    name: string;
    frequency: "daily" | "weekly";
    weekday: number | null;
    enabled: boolean;
    last_run_date?: string | null;
  }>;
  revision: number;
  updated_at: string;
};

export type AgentConversation = {
  id: string;
  agent_key: AgentKey;
  title: string;
  updated_at: string;
  last_message_at: string;
};

export type AgentAttachment = {
  path: string;
  name: string;
  mime_type: string;
  size: number;
  kind: "image" | "video" | "audio";
  frame_paths?: string[];
  signed_url?: string;
};

export type AgentMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  attachments: AgentAttachment[];
  metadata: { proposal_ids?: string[] };
  created_at: string;
};

export type AgentProposal = {
  id: string;
  agent_key: AgentKey;
  change_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: string;
  created_at: string;
};

export type AgentRoutineRun = {
  id: string;
  agent_key: AgentKey;
  routine_id: string;
  routine_name: string;
  run_date: string;
  status: "running" | "completed" | "failed";
  result: Record<string, unknown>;
  has_alert: boolean;
  started_at: string;
};

export function getAgent(agentKey: string): AgentCatalogItem | undefined {
  return AGENT_CATALOG.find((agent) => agent.key === agentKey);
}
