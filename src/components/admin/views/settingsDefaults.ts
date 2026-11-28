export type EstablishmentConfig = {
  nome: string;
  razao_social: string;
  cnpj: string;
  slogan: string;
  boxes: string;
  telefone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  website: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  maps_url: string;
  garantia_dias: string;
  validade_orcamento_dias: string;
  observacoes_os: string;
  criar_os_automaticamente: boolean;
};

export type DaySchedule = {
  key: string;
  label: string;
  open: boolean;
  start: string;
  end: string;
  hasBreak: boolean;
  breakStart: string;
  breakEnd: string;
};

export type HolidayEntry = {
  id: string;
  date: string;
  reason: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
};

export type ScheduleConfig = {
  days: DaySchedule[];
  holidays: HolidayEntry[];
  slotDuration: string;
  bufferMinutes: string;
  minAdvanceHours: string;
};

export const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
] as const;

export const defaultEstablishmentConfig = (): EstablishmentConfig => ({
  nome: "Benittes Oficina Mecânica",
  razao_social: "",
  cnpj: "",
  slogan: "",
  boxes: "4",
  telefone: "",
  whatsapp: "",
  email: "",
  instagram: "",
  website: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "SP",
  maps_url: "",
  garantia_dias: "90",
  validade_orcamento_dias: "7",
  observacoes_os: "Garantia de 90 dias sobre os serviços executados.",
  criar_os_automaticamente: true,
});

export const defaultScheduleConfig = (): ScheduleConfig => ({
  days: [
    { key: "seg", label: "Segunda-feira", open: true, start: "08:00", end: "18:00", hasBreak: true, breakStart: "12:00", breakEnd: "13:30" },
    { key: "ter", label: "Terça-feira", open: true, start: "08:00", end: "18:00", hasBreak: true, breakStart: "12:00", breakEnd: "13:30" },
    { key: "qua", label: "Quarta-feira", open: true, start: "08:00", end: "18:00", hasBreak: true, breakStart: "12:00", breakEnd: "13:30" },
    { key: "qui", label: "Quinta-feira", open: true, start: "08:00", end: "18:00", hasBreak: true, breakStart: "12:00", breakEnd: "13:30" },
    { key: "sex", label: "Sexta-feira", open: true, start: "08:00", end: "18:00", hasBreak: true, breakStart: "12:00", breakEnd: "13:30" },
    { key: "sab", label: "Sábado", open: true, start: "08:00", end: "12:00", hasBreak: false, breakStart: "12:00", breakEnd: "13:00" },
    { key: "dom", label: "Domingo", open: false, start: "08:00", end: "12:00", hasBreak: false, breakStart: "12:00", breakEnd: "13:00" },
  ],
  holidays: [],
  slotDuration: "60",
  bufferMinutes: "15",
  minAdvanceHours: "2",
});
