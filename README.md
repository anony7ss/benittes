# Benittes Oficina Mecânica

Site institucional e painel administrativo em Astro, React e TypeScript. As páginas públicas continuam estáticas; autenticação e dados operacionais são acessados diretamente pelo navegador usando a API do Supabase. Não há rotas de API próprias no Astro ou na Vercel.

## Rodar localmente

Use Node 24 LTS. Copie `.env.example` para `.env.local`, configure as variáveis e rode `npm ci` e `npm run dev`.

## Variáveis

| Variável | Uso |
| --- | --- |
| `PUBLIC_SITE_URL` | Domínio HTTPS publicado, para canonical e sitemap. |
| `PUBLIC_SUPABASE_URL` | URL do projeto `benittes`. |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública `sb_publishable_…`; pode ser usada pelo navegador porque as tabelas têm RLS. |
| `PUBLIC_WHATSAPP`, `PUBLIC_EMAIL`, `PUBLIC_INSTAGRAM` | Valores públicos de contingência do site. A identidade publicada também pode ser editada no painel. |

Nunca coloque uma chave `secret` ou `service_role` em variáveis `PUBLIC_*`, no HTML, no repositório ou na Vercel. O painel não usa credenciais privilegiadas no cliente. Os visitantes veem a identidade da oficina; o nome do provedor não aparece na interface.

## Painel

As páginas estão disponíveis em `/painel/`, incluindo login, recuperação de senha, mensagens do site, clientes, veículos, serviços, preços, agenda, financeiro, estoque, compras, equipe, conteúdo institucional, usuários, auditoria e configurações. A página `/painel/contatos/` recebe as mensagens enviadas pelo formulário público.

O formulário grava pela API de dados do projeto. Constraints do PostgreSQL validam os campos; a política RLS permite inserir somente mensagens válidas e aplica um limite por endereço de e-mail. Visitantes não têm permissão de leitura, alteração ou exclusão da caixa de entrada. O painel lê e trata as mensagens pela sessão autenticada e por políticas RLS.

Registros operacionais são separados por módulo e sujeitos a permissões no banco. Perfis: `owner`, `manager`, `advisor`, `technician` e `finance`. O painel oferece telas de cadastro e edição compartilhadas entre módulos. Os fluxos específicos de oficina (ex.: cálculo de orçamento, baixa de estoque vinculada à ordem e conciliação financeira) podem ser implementados sobre esses registros nas próximas etapas.

## Supabase

O schema está versionado em `supabase/migrations`. A migration `20261124223000_workshop_panel.sql` cria tabelas, constraints, gatilhos de auditoria, políticas RLS e conteúdo inicial. A migration `20261124230000_contact_rls.sql` limita as gravações públicas pelo RLS. Não adicione o schema `private` aos schemas expostos pela API.

Para criar o primeiro owner, adicione o usuário pelo painel Auth do projeto, com e-mail e senha temporária; depois vincule o `user_id` em `panel_members` com perfil `owner`. Não existe cadastro público. Mantenha confirmação de e-mail e configure em Auth → URL Configuration o domínio publicado e a rota `/painel/recuperar-senha/`.

## Publicação

Na Vercel, mantenha o preset Astro e o comando de build `npm run build`. Cadastre as variáveis públicas para os ambientes Preview e Production. As páginas do painel são geradas como HTML estático e consultam o Supabase no navegador; não é necessário um adaptador serverless do Astro. Netlify e Cloudflare Pages também podem servir o conteúdo de `dist`.

## Conteúdo e imagens

O conteúdo editorial inicial fica em `src/content/site.json`. A identidade e os canais editáveis ficam em `site_content` e são lidos ao abrir o site. Confirme os dados oficiais no painel antes da publicação. As fotos locais são de Artem Podrez, distribuídas sob a licença Pexels: [bancada](https://www.pexels.com/photo/man-repairing-an-engine-8986047/), [motor](https://www.pexels.com/photo/a-car-engine-at-an-auto-repair-shop-8985968/), [capô](https://www.pexels.com/photo/close-up-photo-of-a-car-with-open-hood-8985458/) · [licença Pexels](https://www.pexels.com/license/).

Poppins usa SIL Open Font License 1.1. Os pictogramas Phosphor usam MIT. [Poppins](https://github.com/google/fonts/tree/main/ofl/poppins) · [Phosphor](https://github.com/phosphor-icons/core).
