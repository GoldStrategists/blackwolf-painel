# Black Wolf NinjaTrader — dossiê

> **Status: dívida de produção.** Mesma situação do EA: distribuído a clientes sem ter
> percorrido o ciclo de vida. Este dossiê é o plano de auditoria, não um atestado.

| Campo | Valor |
| ----- | ----- |
| id | `blackwolf-nt-mgc` |
| Market | Futuros de ouro MGC (micro) · M5 · NinjaTrader 8 |
| Version | 3.1 |
| Origin | original |
| Owner | Luiz |
| Estágio atual | STAGE 8 (em produção) — **sem evidência dos estágios 0 a 7** |
| Status | legacy |
| Prazo de auditoria | 2026-12-31 |

## Hipótese (STAGE 0) — A RECONSTRUIR

Porte da lógica do EA para futuros de ouro. A auditoria precisa responder se a hipótese é a
mesma do spot e, principalmente, **o que muda na execução**: book centralizado, horário de
pregão, rolagem de contrato, custo por contrato e tick de US$ 0,10 no MGC.

## O que se sabe hoje (fatos, não evidência)

- Pacote distribuído: `BlackWolfNT3.1.cs` + `BlackWolfNT3.1.dll` + `Info.xml`.
- Contratos configuráveis por conta; o painel acompanha contas em MGC (ex.: `MGC 12-26`) em M5.
- A lógica está compilada em DLL: a auditoria precisa do fonte correspondente, senão o
  STAGE 2 (reprodução) é impossível.

## Plano de auditoria retroativa

| Ordem | Estágio | O que fazer | Feito? |
| ----- | ------- | ----------- | ------ |
| 1 | STAGE 0 | Hipótese escrita + diferenças estruturais spot × futuros | ☐ |
| 2 | STAGE 1 | Backtest com custo de futuros correto (comissão por contrato + tick + rolagem) | ☐ |
| 3 | STAGE 2 | **Prioridade:** provar que a versão NT gera as mesmas entradas da versão MT5 no mesmo período. Enquanto isso não existir, são dois produtos diferentes vendidos como um | ☐ |
| 4 | STAGE 3 | Out-of-sample de uso único | ☐ |
| 5 | STAGE 4 | Walk-forward em ≥ 6 janelas, respeitando rolagem de contrato | ☐ |
| 6 | STAGE 5 | Stress test, com atenção a gaps de abertura e liquidez fora do pregão de NY | ☐ |
| 7 | STAGE 6 | Monte Carlo com tamanho em contratos (granularidade grossa muda o risco de ruína) | ☐ |
| 8 | STAGE 7 | Comparação do vivo contra o backtest do mesmo período | ☐ |

## Fraquezas conhecidas

- Sem dossiê: nenhuma etapa do ciclo tem evidência arquivada.
- Porte não reproduzido contra a versão MT5.
- Custo de futuros não modelado em nenhum backtest arquivado.
- Concentração no mesmo ativo do EA: risco somado, não diversificado.
- Granularidade de contrato: em conta pequena, 1 contrato pode ser um risco por trade muito
  acima do que o EA aplica em lote fracionado no spot. Isso precisa ser medido, não suposto.
