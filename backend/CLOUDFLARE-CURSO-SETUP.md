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
