# Black Wolf AI (EA MetaTrader 5) — dossiê

> **Status: dívida de produção.** Produto vendido a clientes que **não** percorreu o ciclo de
> vida. Este dossiê existe para a auditoria retroativa, não para justificar o que já está
> rodando. Enquanto ele não estiver completo, nenhuma métrica deste robô pode ser apresentada
> como validada.

| Campo | Valor |
| ----- | ----- |
| id | `blackwolf-ai-mt5` |
| Market | XAUUSD spot · M5 · MetaTrader 5 |
| Version | 3.0 |
| Origin | original |
| Owner | Luiz |
| Estágio atual | STAGE 8 (em produção) — **sem evidência dos estágios 0 a 7** |
| Status | legacy |
| Prazo de auditoria | 2026-12-31 |

## Hipótese (STAGE 0) — A RECONSTRUIR

Não existe hipótese econômica escrita. Primeira tarefa da auditoria: responder, por escrito,
**por que esse dinheiro existe no XAUUSD em M5**, quem está do outro lado da operação e o que
invalidaria essa explicação. Sem isso, não há como distinguir edge de sorte em ouro num
período que foi, ele mesmo, excepcional para o ativo.

## O que se sabe hoje (fatos, não evidência)

- Opera XAUUSD em M5, com sessões configuráveis no gráfico.
- Parâmetros expostos ao cliente: risco %, modo de entrada (Conservador / Moderado /
  Agressivo), break-even, entrada inversa, filtro de payroll, liga/desliga por sessão e por
  conta, teto de perda.
- O painel registra trades reais por conta (`trades`, `balance_history` no D1) e calcula
  fator de lucro, drawdown e win rate por cliente.

Nada disso é evidência de estratégia: **cada cliente roda uma configuração diferente**, então
não existe uma curva única do robô. É o primeiro problema a resolver na auditoria.

## Plano de auditoria retroativa

| Ordem | Estágio | O que fazer | Feito? |
| ----- | ------- | ----------- | ------ |
| 1 | STAGE 0 | Escrever a hipótese econômica e o critério de invalidação | ☐ |
| 2 | STAGE 1 | Backtest da **configuração padrão congelada**, com spread real, comissão e swap da corretora usada pelos clientes | ☐ |
| 3 | STAGE 2 | Reimplementação independente (fora do MQL5) conferindo as mesmas entradas | ☐ |
| 4 | STAGE 3 | Bloco out-of-sample que não participou do desenvolvimento, aberto uma única vez | ☐ |
| 5 | STAGE 4 | Walk-forward em ≥ 6 janelas | ☐ |
| 6 | STAGE 5 | Stress: 2× slippage, +50% custo, atraso, perturbação ±20%, remoção dos 5% melhores trades, ≥ 2 regimes | ☐ |
| 7 | STAGE 6 | Monte Carlo no risco realmente recomendado ao cliente | ☐ |
| 8 | STAGE 7 | Comparar o vivo (contas com configuração padrão) contra o backtest do mesmo período | ☐ |

Atalho útil e honesto para o STAGE 7: em vez de esperar 60 sessões de paper, dá para
selecionar as contas que rodam **exatamente** a configuração padrão e comparar trade a trade
contra o backtest do mesmo período. Isso mede slippage real e divergência de execução com
dado que a casa já tem. Contas com parâmetros diferentes ficam de fora da amostra.

## Fraquezas conhecidas

- Sem dossiê: nenhuma etapa do ciclo tem evidência arquivada.
- Concentração total em ouro — o mesmo regime atinge EA e NinjaTrader ao mesmo tempo.
- Resultado do cliente ≠ resultado da estratégia (configuração heterogênea por conta).
- Métricas do painel não são evidência estatística.
