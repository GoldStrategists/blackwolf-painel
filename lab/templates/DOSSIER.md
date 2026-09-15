# <NOME DA ESTRATÉGIA> — dossiê

| Campo | Valor |
| ----- | ----- |
| id | `<id>` |
| Market | <ativo · timeframe · plataforma> |
| Version | <x.y> |
| Origin | public (autor: ____) / original |
| Owner | ____ |
| Estágio atual | STAGE <n> |
| Status | in_lab / paper / production / rejected / paused |

## Hipótese (STAGE 0)

**Por que esse dinheiro existe?**
<Qual ineficiência, quem está do outro lado, por que ele continua pagando.>

**O que invalidaria esta hipótese?**
<Escreva o critério de morte ANTES do primeiro teste.>

**Dados:** <fonte, período, corretora, fuso horário>

## Registro de execução

| Estágio | Data | Veredito | Evidência | Observação |
| ------- | ---- | -------- | --------- | ---------- |
| 0 IDEA | | | `stage-0-idea.md` | |
| 1 BASIC BACKTEST | | | `stage-1-backtest.md` | |
| 2 REPRODUCTION | | | `stage-2-reproduction.md` | |
| 3 VALIDATION | | | `stage-3-validation.md` | |
| 4 WALK-FORWARD | | | `stage-4-walkforward.md` | |
| 5 STRESS TEST | | | `stage-5-stress.md` | |
| 6 MONTE CARLO | | | `stage-6-montecarlo.md` | |
| 7 PAPER TRADE | | | `stage-7-paper.md` | |
| 8 PRODUCTION | | | `stage-8-production.md` | |

## Modelo de custo e fonte de dados

- **Modo de modelagem:** tick real (`real_ticks`) — obrigatório
- **Qualidade do histórico:** ____% (mínimo 99)
- **Corretora / servidor:** ____
- **Período coberto por tick real:** ____ a ____
- **Spread:** <real dos ticks ou fixo de ____ pontos>
- **Comissão conferida na especificação do símbolo:** US$ ____ por lote/contrato
- **Swap:** ____

## Controle de teste múltiplo

- Configurações testadas até aqui: <n>
- Usos do holdout final: <0 ou 1>
- Ajuste aplicado (se > 30 configurações): <qual e por quê>

## Fraquezas conhecidas

- <O que você já sabe que é frágil. Lista vazia bloqueia promoção a partir do STAGE 7.>

## Decisões e mudanças

| Data | O que mudou | Por quê | Estágio para onde voltou |
| ---- | ----------- | ------- | ------------------------ |
