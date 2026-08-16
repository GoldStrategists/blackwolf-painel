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

O e-mail da Lista VIP e a confirmação de bônus são enviados com `no-reply@blackwolfea.com`; ambos exibem WhatsApp e `contact@goldstrategists.com` para suporte. Nunca envie token, senha ou chave da Resend por WhatsApp.

## Bônus de 1 mês do EA

O webhook do checkout marcado com `blackwolf_product=course_manual` grava uma única elegibilidade no D1 `BONUS_DB`. Ele não cria assinatura do EA, não autoriza cobrança futura e não mistura o curso com a base de licenças do robô.

Fluxo comercial recomendado:

1. Compra confirmada → registra elegibilidade e envia confirmação transacional.
2. Onboarding concluído → time confere os requisitos e ativa uma licença de cortesia de 30 dias.
3. Fim da cortesia → a licença expira. Não há débito automático.
4. Se a pessoa quiser continuar → abre um checkout separado do EA, com valor, moeda, recorrência e cancelamento claramente mostrados pela Stripe.

Não criar licença automaticamente enquanto não houver uma regra aprovada para casos de cliente que já possua assinatura do EA, mais de uma compra ou dados divergentes. Isso evita sobrepor licença paga e gerar cobrança indevida.

## Antes de tráfego pago

- Fazer um teste real de ponta a ponta com um e-mail controlado pelo time.
- Confirmar domínio `blackwolfea.com` verificado na Resend e o remetente no-reply.
- Configurar o webhook Stripe com o segredo correto e o marcador `blackwolf_product=course_manual` no produto/preço do curso.
- Validar termos, reembolso, privacidade e operação Brasil/EUA com assessoria jurídica competente.
