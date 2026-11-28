"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, History } from "lucide-react";

const RELEASES = [
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "WhatsApp",
    title: "Conversas atendidas pelo painel",
    text: "A nova aba Chat reúne as conversas e os contatos. A equipe pode responder por texto, enviar fotos, vídeos e áudios, gravar áudio, arquivar conversas e pausar o bot por um período escolhido. Quando não há nome salvo, o contato aparece como Cliente.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Bot WhatsApp",
    title: "QR Code sob seu controle",
    text: "O bot pode ser ligado ou desligado pelo painel sem desconectar a conta. O QR Code só é solicitado quando você escolhe Gerar QR Code; se o processo cair, ele tenta se recuperar automaticamente.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Orçamentos e WhatsApp",
    title: "Avisos automáticos sem repetição",
    text: "O vínculo entre orçamento aprovado e ordem de serviço foi reforçado para evitar ordens e pedidos de aprovação duplicados. O histórico do chat também agrupa avisos automáticos iguais enviados em sequência.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Ordens de serviço",
    title: "Finalização mais segura",
    text: "Ao concluir uma OS, o sistema registra o recebimento, a venda e as peças usadas como uma única operação. Se faltar estoque, a conclusão é interrompida para você corrigir antes. Repetir o clique não cria lançamentos duplicados.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Orçamentos",
    title: "Uma OS por orçamento aprovado",
    text: "Quando um cliente aprova um orçamento, o sistema evita criar duas ordens para a mesma aprovação, mesmo se o processo for repetido.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Estoque e compras",
    title: "Compra ligada ao estoque e ao financeiro",
    text: "Ao registrar uma compra, a quantidade e o custo médio do item são atualizados juntos. Se você escolher criar uma conta a pagar, ela fica ligada à entrada da peça.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Estoque",
    title: "Histórico de movimentações",
    text: "Entradas, ajustes e peças usadas em ordens de serviço passam a deixar um registro consultável, com quantidade, custo e motivo.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Histórico da oficina",
    title: "Mais contexto dentro da OS",
    text: "A ficha da ordem reúne mudanças de etapa, atualizações, vistorias vinculadas e peças baixadas, para facilitar a consulta do que aconteceu.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Clientes",
    title: "Lembretes de retorno",
    text: "Agora você pode combinar um próximo contato com o cliente, escolher o canal e a data, e marcar o lembrete como concluído no perfil dele.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Relatórios",
    title: "Custos reais das peças por OS",
    text: "Os relatórios podem considerar o custo das peças que saíram do estoque para cada ordem e filtrar os dados por período e responsável.",
  },
  {
    date: "2026-11-28",
    dateLabel: "28 nov. 2026",
    category: "Painel e WhatsApp",
    title: "Falhas mais claras e mensagens recuperáveis",
    text: "Se o banco falhar, o painel mostra um aviso em vez de apresentar um zero enganoso. Mensagens interrompidas podem voltar à fila com novas tentativas; falhas também podem ser reenviadas pelo módulo do WhatsApp.",
  },
  {
    date: "2026-11-27",
    dateLabel: "27 nov. 2026",
    category: "Orçamentos e ordens de serviço",
    title: "Orçamento aprovado pode abrir uma OS automaticamente",
    text: "Com a opção ativada, a aprovação cria uma ordem vinculada ao orçamento. A automação pode ser desligada nas configurações, e o sistema evita repetir a mesma OS.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Galeria do site",
    title: "Fotos e vídeos gerenciados pelo painel",
    text: "A equipe pode adicionar e organizar as mídias da galeria pública e escolher quais aparecem na página inicial.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Privacidade e site",
    title: "Analytics respeita a escolha de cookies",
    text: "A ferramenta de métricas só inicia a coleta quando a pessoa autoriza a categoria de análise no aviso de cookies.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Configurações do site",
    title: "Contatos públicos atualizados pelas configurações",
    text: "Telefone, WhatsApp, e-mail e redes sociais configurados pela oficina agora alimentam os pontos de contato do site.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Site público",
    title: "Mapa da página Como chegar carrega direto",
    text: "A página de localização abre o mapa sem depender de uma etapa de carregamento que fazia a visualização demorar.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Desempenho",
    title: "Painel mais rápido ao abrir e atualizar",
    text: "As consultas do painel foram enxugadas e as funções do site passaram a rodar em uma região mais próxima do banco de dados.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Acesso e segurança",
    title: "Sessão do painel protegida por cookie",
    text: "O acesso autenticado fica em um cookie protegido pelo navegador. A verificação de sessão também retorna uma resposta clara quando não há login ativo.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Conta e equipe",
    title: "Cargos e permissões da equipe",
    text: "O proprietário pode cadastrar membros e definir quais áreas cada cargo pode consultar ou alterar.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Bot WhatsApp",
    title: "Pausas e rotinas configuráveis",
    text: "A equipe pode pausar a IA durante um atendimento e configurar automações e lembretes do WhatsApp para tarefas repetitivas.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Imagens do site",
    title: "Fotos públicas mais leves",
    text: "As fotos da oficina usam versões WebP em diferentes tamanhos, ajudando a carregar as páginas com menos dados.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Painel",
    title: "Navegação organizada por categorias",
    text: "Os módulos do painel ficam agrupados em categorias que podem ser abertas ou fechadas, e essa escolha permanece salva no navegador.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Agenda e ordens de serviço",
    title: "Quadros mais fáceis de usar no celular",
    text: "Os quadros e ações do painel receberam ajustes para caber melhor em telas menores e facilitar a navegação por toque.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "TV da oficina",
    title: "Tela da oficina com tema e atualização ajustados",
    text: "Os controles de tema e atualização da TV foram corrigidos para manter as informações da oficina legíveis e atualizadas.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Agenda",
    title: "Agendamentos mostram mais informações úteis",
    text: "Os cartões destacam o horário, o serviço, o cliente e o veículo, com ações para abrir a conversa ou cuidar do agendamento.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Serviços",
    title: "Catálogo organizado por categorias",
    text: "Os serviços da oficina podem ser organizados em categorias próprias, facilitando encontrar e manter o catálogo atualizado.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Ordens e orçamentos",
    title: "Formulários de cadastro mais claros",
    text: "Os fluxos de cadastro de ordens e orçamentos foram organizados para separar informações do veículo, serviço, execução e valores.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Aparência do painel",
    title: "Tema claro padrão e troca ajustada no celular",
    text: "O painel abre no tema claro por padrão, e a troca de tema no celular foi ajustada para funcionar melhor com o menu aberto.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Documentos legais",
    title: "Termos e políticas mais fáceis de acessar no celular",
    text: "O menu das páginas de termos, privacidade e cookies foi ajustado para permanecer visível e utilizável em telas menores.",
  },
  {
    date: "2026-11-26",
    dateLabel: "26 nov. 2026",
    category: "Mensagens de clientes",
    title: "Contatos do site disponíveis no painel",
    text: "As mensagens enviadas pelo formulário público podem ser consultadas pela equipe na área de contatos do painel.",
  },
  {
    date: "2026-11-25",
    dateLabel: "25 nov. 2026",
    category: "Preços e serviços",
    title: "Preço de serviço pode variar por veículo",
    text: "A oficina pode cadastrar uma tarifa para marca, modelo e ano. O sistema considera essa regra ao montar o orçamento e apresenta ao cliente o valor confirmado para o serviço.",
  },
  {
    date: "2026-11-25",
    dateLabel: "25 nov. 2026",
    category: "Carregamento do painel",
    title: "Indicadores mostram quando os dados estão carregando",
    text: "As áreas que dependem do banco exibem placeholders enquanto os dados chegam, sem trocar a página inteira por uma tela de espera.",
  },
  {
    date: "2026-11-25",
    dateLabel: "25 nov. 2026",
    category: "Clientes e auditoria",
    title: "Listas longas divididas em páginas",
    text: "Clientes e registros de auditoria podem ser consultados em páginas menores, facilitando encontrar itens sem carregar uma lista enorme de uma vez.",
  },
  {
    date: "2026-11-25",
    dateLabel: "25 nov. 2026",
    category: "Acesso e segurança",
    title: "Confirmação extra para proteger a conta",
    text: "Alterações de segurança pedem confirmação da senha, e a conta pode usar verificação em duas etapas para reforçar o acesso.",
  },
];

const PAGE_SIZE = 4;

export function UpdatesView() {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(RELEASES.length / PAGE_SIZE);
  const first = page * PAGE_SIZE;
  const current = RELEASES.slice(first, first + PAGE_SIZE);

  return (
    <div className="admin-updates">
      <header className="admin-page-title">
        <div>
          <h1>Novidades</h1>
        </div>
        <span className="admin-updates-date">Atualizado até 28 de novembro de 2026</span>
      </header>

      <section className="admin-updates-intro" aria-label="Resumo desta atualização">
        <span className="admin-updates-icon" aria-hidden="true"><History size={18} /></span>
        <p>Esta atualização melhora o controle das ordens, do estoque, dos clientes e do atendimento pelo WhatsApp.</p>
      </section>

      <section className="admin-updates-grid" aria-label={`Notas de atualização, página ${page + 1} de ${pageCount}`}>
        {current.map((release, index) => (
          <article className="admin-updates-card" key={release.title} style={{ animationDelay: `${index * 45}ms` }}>
            <div className="admin-updates-card-meta">
              <span className="admin-updates-category">{release.category}</span>
              <time className="admin-updates-entry-date" dateTime={release.date}>{release.dateLabel}</time>
            </div>
            <h2>{release.title}</h2>
            <p>{release.text}</p>
          </article>
        ))}
      </section>

      <nav className="admin-updates-pagination" aria-label="Paginação das novidades">
        <span>{first + 1}–{Math.min(first + PAGE_SIZE, RELEASES.length)} de {RELEASES.length} novidades</span>
        <div>
          <button type="button" className="admin-secondary" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
            <ArrowLeft size={14} /> Anterior
          </button>
          <span aria-live="polite">Página {page + 1} de {pageCount}</span>
          <button type="button" className="admin-secondary" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1}>
            Próxima <ArrowRight size={14} />
          </button>
        </div>
      </nav>
    </div>
  );
}
