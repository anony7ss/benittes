# Benittes Oficina Mecânica

Aplicação web em Next.js, React e TypeScript para o site público e o painel administrativo da oficina. A persistência e autenticação usam Supabase; as rotas do Next.js validam sessões e operações no servidor. O bot de WhatsApp é um processo Node.js separado.

## Desenvolvimento local

Requisitos: Node.js compatível com a versão usada no deploy e acesso ao projeto Supabase.

```sh
npm ci
npm run dev
```

O painel fica em `/painel/`. Para iniciar o bot, configure as variáveis dele e rode `npm start` dentro de `bot-whatsapp/`. O serviço mantém a sessão vinculada ao ser desligado e o QR só é iniciado ao solicitar “Gerar QR Code” no painel. O comando `npm start` também supervisiona o processo e tenta reiniciá-lo com intervalo progressivo se ele encerrar inesperadamente.

## Configuração

Use variáveis locais ignoradas pelo Git para credenciais. As principais são:

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública do projeto Supabase usado pela aplicação web. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publishable usada pelo cliente autenticado. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave privilegiada, somente no servidor Next.js e no processo do bot. Nunca use prefixo `NEXT_PUBLIC_`. |
| `PUBLIC_SITE_URL` | URL pública usada em links de orçamento e conteúdo do site. |
| `SIMPLESAPI_KEY` | Consulta de placa, se habilitada. |
| `OPENAI_API_KEY`, `GROQ_API_KEY` ou `OPENCODE_API_KEY` | Provedores opcionais usados pelo bot e recursos de IA. |

O processo do bot também aceita `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKSHOP_NAME` e as chaves do provedor de IA. Consulte `src/lib/supabaseAdmin.ts` e `bot-whatsapp/src/config.js` para os nomes aceitos no ambiente de execução. Não inclua valores reais no README, no código ou em variáveis públicas.

## Aplicação e dados

- As páginas públicas incluem a home, conteúdo institucional, orçamento online e painel de TV.
- O painel usa rotas em `src/app/api/`, sessão Supabase e políticas RLS. Não exponha o schema `private` na API.
- O bot em `bot-whatsapp/` usa Baileys, IA opcional e a fila `whatsapp_outbox`. Ele precisa rodar como processo separado e estar conectado ao WhatsApp para enviar mensagens.
- O código de banco fica em `supabase/migrations/`. Aplique as migrações no projeto Supabase antes de publicar mudanças que adicionem tabelas ou colunas. Em especial, `20261126130000_configurable_automations_and_roles.sql` cria os controles de lembretes e os cargos personalizados.
- As migrações não são executadas automaticamente por `npm run build`.

## Bot e automatizações

Em Painel → Bot WhatsApp → Configurações, usuários autorizados podem pausar as automatizações de mensagens, configurar alertas e editar textos. A chave geral e as novas rotinas começam desligadas. Há rotinas para lembrete de agendamento, orçamento pendente e revisão após serviço concluído. Cada tipo tem chave liga/desliga, prazo configurável e modelo editável; a fila registra uma chave única por item para impedir envios repetidos após reiniciar o bot. O recurso só envia enquanto o processo do bot está ativo e conectado.

Desligar as automatizações não desliga a IA conversacional nem impede mensagens manuais e códigos de verificação. A IA tem controle próprio.

## Cargos e acesso

O proprietário pode criar cargos, editar permissões de leitura e escrita por área e atribuí-los à equipe. O cargo Proprietário mantém acesso total. A navegação filtra as áreas, e as políticas RLS consultam as mesmas permissões no banco. As rotas que usam serviço privilegiado também validam a sessão e a permissão no servidor.

## Situação fiscal

A rota fiscal salva uma prévia local de documento e declara na resposta que ela não tem validade fiscal nem foi transmitida. O projeto não realiza emissão ou autorização de NF-e, NFS-e ou NFC-e.

## Publicação

O deploy web usa Next.js na Vercel. Configure as variáveis nos ambientes Preview e Production e mantenha as chaves privilegiadas apenas no servidor. O bot deve ser implantado e mantido em um serviço Node separado; publicar o site não inicia esse processo.
