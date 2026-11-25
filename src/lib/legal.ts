export type LegalDocKey = "termos" | "privacidade" | "cookies";

export type LegalSection = {
  id: string;
  title: string;
  summary?: string;
  paragraphs: string[];
  bullets?: string[];
  callout?: string;
};

export type LegalDocument = {
  key: LegalDocKey;
  href: string;
  label: string;
  kicker: string;
  title: string;
  subtitle: string;
  updatedAt: string;
  sections: LegalSection[];
};

export const LEGAL_DOCUMENTS: Record<LegalDocKey, LegalDocument> = {
  termos: {
    key: "termos",
    href: "/termos/",
    label: "Termos de uso",
    kicker: "Documentos legais",
    title: "Termos de uso",
    subtitle:
      "Condições gerais de acesso ao site institucional, aos guias técnicos e ao portal de acompanhamento de serviços da Benittes Oficina Mecânica.",
    updatedAt: "Atualizado em novembro de 2026",
    sections: [
      {
        id: "objeto-aceitacao",
        title: "1. Objeto e aceitação",
        paragraphs: [
          "Estes Termos de Uso regulam o acesso e a utilização do site da Benittes Oficina Mecânica, incluindo páginas informativas, formulários de contato, guias de manutenção e links de acompanhamento de orçamentos e ordens de serviço.",
          "Ao navegar ou enviar solicitações por meio deste ambiente, o usuário declara estar ciente e de acordo com as condições aqui descritas.",
        ],
      },
      {
        id: "conteudo-guias",
        title: "2. Conteúdo informativo e guias técnicos",
        paragraphs: [
          "Os textos, recomendações e guias publicados têm caráter exclusivamente informativo e educativo. Eles não substituem a inspeção presencial nem constituem laudo técnico definitivo.",
          "A identificação exata da causa de qualquer sintoma ou falha mecânica, elétrica ou eletrônica depende da avaliação física do veículo por profissional qualificado na oficina.",
        ],
      },
      {
        id: "orcamentos-servicos",
        title: "3. Orçamentos, aprovações e disponibilidade",
        paragraphs: [
          "As informações exibidas no site não representam oferta vinculante imediata de reparo. Valores de mão de obra, disponibilidade de peças, prazos de execução e condições de pagamento dependem de confirmação direta com a equipe da oficina.",
          "Nos orçamentos digitais enviados ao cliente, eventuais aprovações parciais ou totais abrangem apenas os itens expressamente selecionados e confirmados, podendo sofrer ajuste mediante aviso prévio caso sejam identificados danos ocultos durante a desmontagem.",
        ],
      },
      {
        id: "indisponibilidade-48h",
        title: "4. Indisponibilidade do site, manutenção e prazo de 48h+",
        paragraphs: [
          "A Benittes Oficina Mecânica empenha esforços razoáveis para manter o site e o portal de acompanhamento acessíveis continuamente. Contudo, o serviço é disponibilizado no estado em que se encontra, sujeito a manutenções programadas, atualizações de sistema, instabilidades de rede ou falhas em provedores de hospedagem e APIs externas.",
          "Caso o site ou o portal permaneça fora do ar ou temporariamente indisponível por 48 horas ou mais, o usuário e o cliente ficam cientes de que:",
        ],
        bullets: [
          "O atendimento comercial, o acompanhamento de veículos e a entrega de serviços continuam normalmente pelos canais diretos (atendimento presencial na oficina, telefone e WhatsApp oficial).",
          "A indisponibilidade temporária do ambiente digital — mesmo que superior a 48 horas — não configura descumprimento contratual, perda de garantia de serviços executados nem gera direito a indenização por danos indiretos ou lucros cessantes.",
          "Prazos de aprovação ou retirada podem ser confirmados diretamente com a recepção da oficina enquanto durar a instabilidade técnica.",
        ],
        callout:
          "Aviso de continuidade: se o site estiver fora do ar por 48 horas ou mais, utilize nosso WhatsApp oficial ou compareça presencialmente à oficina para consultar seu veículo sem prejuízo ao atendimento.",
      },
      {
        id: "forca-maior",
        title: "5. Caso fortuito, força maior e serviços de terceiros",
        paragraphs: [
          "A oficina não se responsabiliza por falhas decorrentes de caso fortuito ou força maior, quedas de energia, bloqueios de operadoras de telecomunicação, ataques cibernéticos externos ou indisponibilidade de plataformas de terceiros integradas (como WhatsApp, provedores de nuvem ou consultas de placas).",
        ],
      },
      {
        id: "propriedade-intelectual",
        title: "6. Propriedade intelectual e imagens",
        paragraphs: [
          "A marca Benittes, logotipos, textos, estrutura visual e códigos do site pertencem à Benittes Oficina Mecânica ou são utilizados sob licença. É proibida a reprodução, cópia ou exploração comercial sem autorização prévia.",
          "Fotografias editoriais podem ilustrar procedimentos automotivos de referência e não representam necessariamente todas as instalações ou equipamentos disponíveis em cada momento.",
        ],
      },
      {
        id: "alteracoes-foro",
        title: "7. Alterações, legislação aplicável e foro",
        paragraphs: [
          "Estes termos podem ser atualizados a qualquer momento para refletir melhorias operacionais ou exigências legais, passando a valer a partir da publicação nesta página.",
          "Aplica-se a legislação brasileira, ficando eleito o foro da comarca da sede da oficina para dirimir eventuais controvérsias, ressalvadas as disposições aplicáveis do Código de Defesa do Consumidor.",
        ],
      },
    ],
  },
  privacidade: {
    key: "privacidade",
    href: "/privacidade/",
    label: "Política de privacidade",
    kicker: "Documentos legais · LGPD",
    title: "Política de privacidade",
    subtitle:
      "Como a Benittes Oficina Mecânica coleta, utiliza, armazena e protege dados pessoais em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).",
    updatedAt: "Atualizado em novembro de 2026",
    sections: [
      {
        id: "compromisso-lgpd",
        title: "1. Compromisso com a privacidade (LGPD)",
        paragraphs: [
          "A Benittes Oficina Mecânica respeita a privacidade de clientes, visitantes e parceiros. O tratamento de dados pessoais segue os princípios da finalidade, adequação, necessidade, transparência e segurança previstos na Lei nº 13.709/2018 (LGPD).",
        ],
      },
      {
        id: "dados-coletados",
        title: "2. Quais dados são coletados e para que servem",
        paragraphs: [
          "A navegação pelas páginas públicas e guias é livre e não exige cadastro prévio. Coletamos dados apenas quando necessários para atendimento ou execução de serviços:",
        ],
        bullets: [
          "Contato e agendamento: nome, telefone/WhatsApp, e-mail e descrição da solicitação enviados voluntariamente pelo formulário.",
          "Atendimento na oficina e portal: dados cadastrais, placa e características do veículo, histórico de inspeções, orçamentos e ordens de serviço.",
          "Obrigações legais e fiscais: informações necessárias para emissão de documentos fiscais e garantia dos serviços prestados.",
        ],
      },
      {
        id: "dados-tecnicos",
        title: "3. Dados técnicos e registros de acesso",
        paragraphs: [
          "Para garantir a entrega das páginas, prevenir abusos e manter a estabilidade do sistema, o provedor de hospedagem e a aplicação podem registrar metadados técnicos de conexão (como endereço IP, data/hora de acesso e agente de navegação), observando os prazos do Marco Civil da Internet (Lei nº 12.965/2014).",
        ],
      },
      {
        id: "compartilhamento",
        title: "4. Compartilhamento com terceiros e canais externos",
        paragraphs: [
          "Não vendemos nem cedemos dados pessoais para fins publicitários. O compartilhamento ocorre somente quando estritamente necessário para a operação:",
        ],
        bullets: [
          "Infraestrutura tecnológica: serviços de hospedagem, banco de dados e armazenamento seguro.",
          "Comunicação e consultas: ao clicar em links de WhatsApp ou Instagram, o usuário passa a interagir também sob as políticas dessas plataformas.",
          "Cumprimento legal: autoridades públicas, fiscais ou judiciais, quando exigido por lei.",
        ],
      },
      {
        id: "retencao-seguranca",
        title: "5. Armazenamento, segurança e indisponibilidade",
        paragraphs: [
          "Adotamos medidas técnicas e administrativas compatíveis com o porte da operação para proteger os dados contra acesso não autorizado, perda ou alteração indevida.",
          "Os dados são mantidos pelo tempo necessário ao cumprimento das finalidades de atendimento, garantia de serviços e obrigações legais. Eventual indisponibilidade temporária do site (inclusive por 48 horas ou mais) não compromete a integridade dos registros internos da oficina.",
        ],
      },
      {
        id: "direitos-titular",
        title: "6. Direitos do titular e canal de atendimento",
        paragraphs: [
          "Nos termos da LGPD, o titular pode solicitar a qualquer momento a confirmação da existência de tratamento, acesso, correção de dados incompletos ou desatualizados, eliminação (quando aplicável) ou revogação de consentimento.",
          "Para exercer seus direitos ou tirar dúvidas sobre privacidade, entre em contato pelos canais oficiais disponíveis na página de Contato ou pelo WhatsApp da oficina.",
        ],
        callout:
          "Solicitações de privacidade e proteção de dados são recebidas diretamente pela administração da Benittes Oficina Mecânica por meio da página de Contato.",
      },
    ],
  },
  cookies: {
    key: "cookies",
    href: "/cookies/",
    label: "Política de cookies",
    kicker: "Documentos legais",
    title: "Política de cookies",
    subtitle:
      "Transparência sobre os cookies e tecnologias de armazenamento local utilizados neste site para manter funcionalidades essenciais e preferências de uso.",
    updatedAt: "Atualizado em novembro de 2026",
    sections: [
      {
        id: "o-que-sao-cookies",
        title: "1. O que são cookies e armazenamento local",
        paragraphs: [
          "Cookies são pequenos arquivos de texto salvos pelo navegador quando você visita um site. De forma complementar, recursos como o armazenamento local (localStorage) guardam preferências simples diretamente no dispositivo do usuário.",
        ],
      },
      {
        id: "cookies-essenciais",
        title: "2. Cookies e dados estritamente necessários",
        paragraphs: [
          "Este site prioriza a privacidade e evita rastreamento invasivo. Utilizamos apenas mecanismos técnicos essenciais para o funcionamento correto das páginas:",
        ],
        bullets: [
          "Preferências visuais: memorização de tema claro ou escuro na ficha de acompanhamento do cliente e no painel interno.",
          "Autenticação e segurança: cookies de sessão utilizados exclusivamente por colaboradores autorizados ao acessar o painel administrativo.",
          "Estabilidade de navegação: parâmetros técnicos temporários para proteção contra requisições abusivas.",
        ],
      },
      {
        id: "cookies-terceiros",
        title: "3. Publicidade e serviços de terceiros",
        paragraphs: [
          "Não utilizamos redes de anúncios comportamentais nem vendemos perfis de navegação. Ao acessar links externos (como WhatsApp, Instagram ou mapas), esses serviços podem aplicar suas próprias políticas de cookies fora do domínio da Benittes.",
        ],
      },
      {
        id: "gerenciar-cookies",
        title: "4. Como gerenciar ou bloquear cookies",
        paragraphs: [
          "Você pode visualizar, apagar ou bloquear cookies a qualquer momento nas configurações do seu navegador (Chrome, Edge, Firefox ou Safari). Observe que a desativação de cookies ou armazenamento estritamente necessários pode impedir o salvamento de preferências visuais ou o acesso à área restrita da equipe.",
        ],
        callout:
          "Dica: na maioria dos navegadores, basta acessar Configurações > Privacidade e segurança > Cookies para limpar ou limitar o armazenamento por site.",
      },
    ],
  },
};

export const LEGAL_DOC_LIST: LegalDocument[] = [
  LEGAL_DOCUMENTS.termos,
  LEGAL_DOCUMENTS.privacidade,
  LEGAL_DOCUMENTS.cookies,
];
