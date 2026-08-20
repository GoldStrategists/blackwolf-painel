# Curso Manual Black Wolf — operação segura

## Lista VIP

O formulário de `curso.blackwolfea.com` exige nome, e-mail, WhatsApp e consentimento. Os dados ficam somente no D1 `LEADS_DB`, separados do banco operacional do EA.

- Funil: `new` → `contacted` → `group` → `closed`.
- O painel admin mostra os leads e permite mover o status e registrar notas.
- Reenvios atualizam o mesmo registro pelo e-mail e não disparam uma segunda sequência de boas-vindas.
- A rota pública limita envios por IP e por e-mail para reduzir spam.

## E-mails via Resend

No Cloudflare Worker, configurar apenas pelo painel de Secrets/Variables:

- `RESEND_API_KEY`: chave de API da Resend.
- `EMAIL_FROM`: `Black Wolf <no-reply@blackwolfea.com>` depois de verificar o domínio na Resend.
- `LEADS_NOTIFICATION_EMAIL` (opcional): caixa interna para receber cada novo lead. Sem essa variável, o primeiro administrador do painel recebe o aviso.
- `EMAIL_REPLY_TO` (opcional): endereço de suporte de e-mails que aceitam resposta.
- `EA_CONTINUATION_CHECKOUT_URL` (opcional): checkout oficial do plano EA para
  alunos que quiserem continuar após a cortesia. Sem essa variável, o Worker
  usa o checkout público atual do plano Lone Wolf.

O e-mail da Lista VIP e a confirmação de bônus são enviados com `no-reply@blackwolfea.com`; ambos exibem WhatsApp e `contact@goldstrategists.com` para suporte. Nunca envie token, senha ou chave da Resend por WhatsApp.

## Bônus de 1 mês do EA

O webhook do checkout marcado como curso (`blackwolf_product=course_manual` ou `product=curso`) grava uma única elegibilidade no D1 `BONUS_DB` e cria a licença de cortesia no banco principal do EA. Ele não cria assinatura, não autoriza cobrança futura e não altera uma licença paga já existente.

Fluxo comercial recomendado:

1. Compra confirmada → libera o curso, registra a elegibilidade e cria automaticamente uma licença Lone Wolf de cortesia por 30 dias (`is_courtesy=1` e `license_expires_at`).
2. O cliente recebe o e-mail do EA com painel, senha temporária e chave de licença; no primeiro login, o onboarding é obrigatório.
3. Um Cron Trigger diário do Cloudflare envia avisos 5 e 2 dias antes do fim. No vencimento, a licença é marcada como expirada e é enviado o e-mail de encerramento.
4. Todos os avisos oferecem o checkout separado do EA. Não há débito automático, assinatura criada por bônus ou cobrança futura autorizada pelo curso.

A criação é idempotente: reentregas do webhook não geram outra chave nem estendem o prazo. Se já existir uma conta paga para o mesmo e-mail, ela é preservada e não sofre alteração.

## Cron da cortesia

No Cloudflare, em **Workers & Pages → blackwolf-api → Triggers → Cron Triggers**, criar:

- `17 13 * * *` (uma vez por dia, 13:17 UTC).

O Worker v43 executa a rotina de forma idempotente: um mesmo aviso não é enviado duas vezes para a mesma validade de licença. Mesmo se o Cron ficar desligado, as rotas do EA continuam bloqueando uma licença expirada; o Cron é necessário para os e-mails e para refletir o status no painel sem o robô precisar chamar a API.

## Antes de tráfego pago

- Fazer um teste real de ponta a ponta com um e-mail controlado pelo time.
- Confirmar domínio `blackwolfea.com` verificado na Resend e o remetente no-reply.
- Configurar o webhook Stripe com o segredo correto e o marcador `blackwolf_product=course_manual` no produto/preço do curso.
- Validar termos, reembolso, privacidade e operação Brasil/EUA com assessoria jurídica competente.
