# Configuração única — Curso Manual

O código do Worker já espera dois bindings D1:

```text
LEADS_DB  -> blackwolf-course-leads
BONUS_DB  -> blackwolf-course-bonus
```

Depois de criar os bindings, execute cada arquivo SQL no Console do banco de
mesmo nome:

```text
blackwolf-course-leads  -> migrations/2026-08-course-leads.sql
blackwolf-course-bonus  -> migrations/2026-08-course-bonus.sql
```

Na Stripe, no produto ou preço do Curso Manual, adicione esta metadata:

```text
blackwolf_product = course_manual
```

Esse marcador é obrigatório: impede que uma compra do curso seja interpretada
como uma assinatura do EA. Nenhum valor monetário é usado para esta decisão.

## Lista VIP e e-mails via Resend

O Worker usa a mesma conta Resend já usada para e-mails operacionais. Em
**Workers & Pages → blackwolf-api → Settings → Variables and Secrets**, manter
ou criar as variáveis abaixo (não enviar chaves por WhatsApp):

```text
RESEND_API_KEY            Secret da Resend já existente
EMAIL_FROM                Black Wolf <no-reply@blackwolfea.com>
EMAIL_REPLY_TO            E-mail de suporte que deve receber respostas
LEADS_NOTIFICATION_EMAIL  E-mail interno que recebe cada novo lead
```

`LEADS_NOTIFICATION_EMAIL` deve ser configurada como Secret. Após salvar,
publique o Worker. O formulário envia uma confirmação para o interessado e
um aviso interno somente na primeira entrada daquele e-mail; reenvios não
duplicam a sequência.
