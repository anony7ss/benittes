# Benittes Oficina Mecânica

Plataforma de atendimento e operação para uma oficina automotiva, composta por site público, painel administrativo e processo separado para WhatsApp.

## Site público

Apresenta os serviços, informações e canais da oficina. Também recebe solicitações de contato, oferece consulta de orçamento por link e mostra a fila de serviços na tela de TV da oficina.

## Painel da oficina

O painel organiza agenda, ordens de serviço, orçamentos, inspeções, clientes, veículos, serviços, preços, estoque, vendas, finanças, mensagens e relatórios. A equipe usa contas autenticadas; o proprietário pode criar contas, atribuir cargos e definir permissões por área.

## WhatsApp

O bot roda em processo Node separado do site. Ele pode responder com IA, consultar informações da oficina, apoiar pedidos de agendamento e encaminhar conversas para uma pessoa. A conexão do bot depende de estar ativo e pareado com o WhatsApp.

Os controles de mensagens automáticas incluem:

- Chave geral para pausar lembretes, alertas e mensagens automáticas.
- Envio de orçamento/OS e aviso quando a oficina está fechada.
- Alertas ao responsável para pedido de atendente, resposta de orçamento e novo agendamento.
- Lembretes de agendamento, orçamento pendente e revisão de serviço, cada um com prazo, modelo e chave própria para evitar duplicidade.
- Pausa da IA por contato e pausa após atendimento manual, configuradas separadamente.

A chave geral e as novas rotinas começam desligadas. A IA conversacional e mensagens manuais não são desligadas pela chave geral de automatizações.

## Dados e permissões

O site e o painel usam Next.js e Supabase. As rotas do servidor validam as ações e o Supabase aplica RLS nos dados. O bot usa um processo separado com credencial privilegiada guardada no servidor.

As funcionalidades de cargos personalizados e lembretes configuráveis dependem da migração `20261126130000_configurable_automations_and_roles.sql` aplicada ao Supabase. O código local não confirma, por si só, que o banco publicado já recebeu essa migração.

## Limite fiscal atual

A rota de documento fiscal gera apenas uma prévia local; ela não possui validade fiscal e não é transmitida a uma autoridade ou provedor fiscal.
