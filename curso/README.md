# Black Wolf — Portal do Curso

Área de membros onde o aluno assiste ao curso. Projeto **separado** do robô
(D1 e Worker próprios), mesma arquitetura e mesmos padrões de segurança —
ver `docportalcurso.pdf` (briefing original) e a auditoria técnica que gerou
as correções abaixo.

## O que já está pronto neste commit

- `backend/schema.sql` — esquema D1 completo: alunos, matrículas, auditoria
  de matrícula (`enrollment_events`), módulos, aulas, progresso e ledger de
  pagamentos com dedupe (`payments.event_id` único).
- `backend/worker.js` — API completa: login/sessão/reset de senha (PBKDF2 +
  KV, idêntico ao robô), aulas + progresso, upload de vídeo via Cloudflare
  Stream, webhook do Stripe **idempotente** (grava o `event_id` antes de
  qualquer efeito colateral) e já tratando reembolso/disputa, webhook do
  Stream para status de processamento, painel admin (alunos, matrícula
  manual, aulas, módulos, métricas, broadcast).
- `index.html` — SPA vanilla (sem build), mesma identidade visual do
  `blackwolf-painel` (tokens de cor, tipografia, sidebar), telas: login,
  dashboard, aulas, player, materiais, configurações (com idioma PT/EN/ES),
  admin.

Correções em relação ao briefing original (`docportalcurso.pdf`) que este
código já aplica — detalhadas na auditoria técnica enviada antes deste
commit:

| Achado | O que mudou aqui |
|---|---|
| F-01 · webhook sem idempotência | `payments.event_id` único + `INSERT OR IGNORE` antes de criar aluno/matrícula/e-mail/cupom |
| F-02 · sessão ambígua (cookie/Bearer) | Só Bearer, igual ao robô — sem cookie, sem necessidade de CSRF |
| F-03 · sem auditoria de matrícula | `enrollment_events` grava toda mudança de status (quem, quando, por quê) |
| F-04 · reembolso/disputa não tratados | `charge.refunded` e `charge.dispute.created` revogam o acesso |
| F-05 · idioma do aluno não persistia | `students.lang`, endpoint `/api/profile` |
| F-06 · endpoint de upload não documentado | `POST /api/admin/lesson/:id/upload-url` implementado |
| F-07 · sem estado de processamento de vídeo | `lessons.video_status` + `POST /api/webhooks/stream` |
| F-11 · admin/students sem paginação | `?page=&limit=` |

## O que falta para ir ao ar (precisa de acesso que eu não tenho neste momento)

Este ambiente tem os conectores **Cloudflare** e **Stripe** instalados mas
**não autorizados** (preciso que você aprove o OAuth deles em
`claude.ai` → Configurações → Conectores; não dá pra eu completar esse
fluxo sozinho numa sessão não-interativa). Sem isso eu não consigo, na
prática:

1. **Criar o D1** (`blackwolf-curso-db`) e a KV (`blackwolf-curso-sessions`)
   e rodar `schema.sql`.
2. **Publicar o Worker** (`backend/worker.js`) no Cloudflare com os bindings
   `DB`/`SESSIONS` e os secrets (ver cabeçalho do arquivo — Resend, Stripe,
   Stream, bônus do robô).
3. **Criar o produto "Curso" no Stripe** com `metadata.product="curso"` e o
   endpoint de webhook (`/api/stripe-webhook`) apontando pro Worker.
4. **Configurar o Cloudflare Stream** (signing key, domain-lock para
   `curso.blackwolfea.com`) e o webhook de status (`/api/webhooks/stream`).
5. **Apontar o DNS** de `curso.blackwolfea.com` e publicar o `index.html`
   (Vercel, como o robô — esse conector já está autorizado, posso fazer o
   deploy do front assim que o domínio da API estiver definido).

Assim que você autorizar Cloudflare e Stripe (ou me passar as credenciais
diretamente), eu sigo e termino os passos 1–5 sem precisar de mais nada seu.

## Rodando localmente / testando a API

```bash
npm install -g wrangler
cd curso/backend
wrangler dev worker.js   # precisa de wrangler.toml com os bindings — ver abaixo
```

`wrangler.toml` de referência (criar antes do primeiro deploy):

```toml
name = "blackwolf-curso-api"
main = "worker.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "blackwolf-curso-db"
database_id = "<preenchido depois de criar o D1>"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<preenchido depois de criar a KV>"
```

## Pendências de produto (não travam o começo do build, do próprio briefing §14)

- Preço final do curso ($397 vs $399)
- Nº de meses grátis do robô no bônus (1 a 10) → variável `ROBO_BONUS_MONTHS`
- Certificado de conclusão — não implementado nesta v1
- Quiz/avaliação por módulo — não implementado nesta v1
- Tradução do conteúdo das aulas (EN/ES) — schema atual guarda só PT;
  planejar `lesson_translations` antes de ter conteúdo pra traduzir
