# Checklist do Projeto · Benittes Oficina Mecânica

Legenda:
- `[x]` Já implementado no projeto
- `[ ]` Pendente (ou com base parcial indicada abaixo)

---

## Gestão Operacional

- [x] **Ordens de serviço em Kanban** (`WorkOrdersView.tsx`)
  - Quadro Kanban com arrastar e soltar, arquivamento/exclusão automática ao finalizar e geração a partir de orçamentos.
- [x] **Orçamentos com aprovação digital, inclusive parcial** (`QuotesView.tsx`, `QuoteSheetClient.tsx`, `/api/public/quote/[token]`)
  - Itens estruturados (`serviço` / `peça`, quantidade e valor unitário) com aprovação ou recusa item a item pelo cliente na ficha online e recálculo automático do total.
- [x] **Agenda, histórico de veículos e inspeções fotográficas** (`AppointmentsView.tsx`, `VehiclesView.tsx`, `InspectionsView.tsx`)
  - Agenda completa, linha do tempo consolidada por veículo (OS, orçamentos, agendamentos e inspeções) e upload de fotos comprimidas nas inspeções.
- [x] **Consulta automática e reconhecimento de placas** (`/api/admin/vehicles/plate-ocr`, `QuickPickers.tsx`)
  - Botão **Preencher** em todos os modais com placa usando SimplesAPI (`SIMPLESAPI_KEY`) e suporte opcional a leitura por foto via IA (`GEMINI_API_KEY` / `OPENAI_API_KEY`).
- [x] **Catálogo de serviços, peças e cálculo de mão de obra** (`ServicesView.tsx`, `InventoryView.tsx`)
  - Catálogo de serviços, estoque de peças e calculadora rápida de mão de obra (`R$/hora × horas`).

---

## Financeiro e Estoque

- [x] **Contas a pagar e receber** (`FinanceView.tsx`)
  - Lançamentos de entradas e saídas, status de pagamento e integração com vendas/OS concluídas.
- [x] **Fluxo de caixa, conciliação bancária e DRE** (`FinanceView.tsx`, `ReportsView.tsx`)
  - Importação e conciliação de extratos bancários (`.OFX` e `.CSV`) e relatório estruturado de **DRE** (Receitas, Compras/Custos, Despesas e Lucro Líquido).
- [x] **Controle de compras, fornecedores e comissões** (`InventoryView.tsx`, `ReportsView.tsx`)
  - Registro de compras com atualização automática de estoque/fornecedor, lançamento opcional no financeiro e cálculo de comissões por período.
- [x] **Emissão de NF-e, NFS-e e NFC-e** (`SalesView.tsx`, `/api/admin/fiscal`)
  - Emissão estruturada de NF-e, NFS-e e NFC-e a partir das vendas, com modo de homologação local e suporte pronto para provedor fiscal (`FISCAL_API_TOKEN`).

---

## Recursos Avançados

- [x] **Portal de acompanhamento para clientes** (`QuoteSheetClient.tsx` em `/orcamento/[token]`)
  - Ficha online com aprovação digital (total e parcial) e acompanhamento de status em tempo real (Orçamento → Aprovado → Na oficina → No box → Concluído).
- [x] **Central de atendimento e notificações pelo WhatsApp** (`WhatsAppBotView.tsx`, `NotificationCenter.tsx`)
  - Bot WhatsApp com IA, fila de envio (outbox), terminal de logs, QR Code, verificação de heartbeat online/offline e central de alertas no painel.
- [x] **Controle de funcionários e ponto eletrônico** (`TimeClockView.tsx`, `SettingsView.tsx`)
  - Registro de ponto eletrônico (entrada, início/fim de intervalo e saída), cálculo de horas trabalhadas no dia e espelho de ponto da equipe.
- [x] **Etiquetas de manutenção com QR Code** (`VehiclesView.tsx`)
  - Geração e impressão de etiqueta de manutenção (troca de óleo / próxima revisão / km) com QR Code para a ficha/histórico do veículo.
- [x] **Painel de serviços para televisões da oficina** (`/tv`, `WorkshopTvClient.tsx`, `/api/public/tv`)
  - Rota dedicada em tela cheia com atualização automática a cada 15s mostrando veículos na fila, no box e prontos para retirada (link direto em `WorkOrdersView.tsx`).
