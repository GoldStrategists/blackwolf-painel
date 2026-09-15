# STRATEGY LIFECYCLE — Black Wolf

Este documento é a **lei do laboratório**. Toda estratégia passa obrigatoriamente pelos
estágios abaixo, na ordem, sem pular etapa. Não existe exceção por intuição, por urgência
comercial ou por resultado bonito.

Quem decide se uma estratégia avança não é a opinião de ninguém: é o gate em
[`lab/gates.json`](lab/gates.json), conferido por [`lab/validate.mjs`](lab/validate.mjs)
contra a evidência arquivada em `lab/strategies/<id>/`.

| Arquivo | Papel |
| ------- | ----- |
| [`lab/registry.json`](lab/registry.json) | Fonte única da verdade: estágio, métricas e histórico de cada estratégia |
| [`lab/gates.json`](lab/gates.json) | Os números que promovem ou reprovam |
| [`lab/validate.mjs`](lab/validate.mjs) | Aplica a lei e gera os dois documentos abaixo |
| [`HALL_OF_FAME.md`](HALL_OF_FAME.md) | **Gerado.** Só STAGE 7 e STAGE 8 |
| [`STRATEGY_GRAVEYARD.md`](STRATEGY_GRAVEYARD.md) | **Gerado.** Estratégias rejeitadas e a causa da morte |

```bash
node lab/validate.mjs           # confere o registro; sai com erro se alguém tentou pular etapa
node lab/validate.mjs --write   # regenera HALL_OF_FAME.md e STRATEGY_GRAVEYARD.md
node lab/validate.test.mjs      # testa o próprio validador
```

---

## Os estágios

### STAGE 0 — IDEA
Hipótese ainda não testada.

Exige **hipótese econômica ou estrutural escrita antes de qualquer teste**: por que esse
dinheiro existiria no mercado, quem está do outro lado e por que ele continuaria pagando.
"O gráfico mostra que funciona" não é hipótese — é observação de ruído.

- **Evidência:** `stage-0-idea.md` com a hipótese, o ativo, a janela de dados e o que a
  invalidaria. Escrever o critério de morte **antes** do primeiro backtest.

### STAGE 1 — BASIC BACKTEST
Primeiro teste com regras fixas e custos realistas.

Regras congeladas antes de rodar. Custo realista significa spread médio real do ativo,
comissão, swap e — em futuros — comissão por contrato e tick correto. Backtest sem custo
não é backtest, é gráfico.

**Tick real é obrigatório.** No MetaTrader 5, modo "Cada tick com base em ticks reais", com a
barra de qualidade do histórico em 100%. Tick gerado a partir do candle de 1 minuto não vale
para estratégia de M5 — e quando a corretora não tem tick real no período, o MT5 completa com
tick sintético sem avisar. Por isso o registro exige `modeling_mode`, `history_quality_pct` e
`data_source` juntos. Passo a passo em [`lab/COMO_RODAR_NO_MT5.md`](lab/COMO_RODAR_NO_MT5.md).

- **Gate:** ≥ 100 trades, profit factor > 1.0 **depois** dos custos, modelo de custo descrito,
  tick real e qualidade de histórico ≥ 99%.
- **Evidência:** `stage-1-backtest.md` + relatório exportado da plataforma + o arquivo de
  trades (CSV) usado para calcular tudo.

### STAGE 2 — REPRODUCTION
Estratégia pública: reproduzir o autor. Estratégia original: reproduzir internamente em
execução independente (outra implementação, de preferência outra linguagem/plataforma).

Serve para separar *edge* de *bug*. Muita estratégia "genial" é erro de índice, vazamento de
dado futuro (look-ahead) ou preenchimento a preço que não existia.

- **Gate:** desvio ≤ 20% no lucro líquido e no PF contra a referência.
- **Evidência:** `stage-2-reproduction.md` com as duas curvas lado a lado e a explicação de
  cada divergência relevante.

### STAGE 3 — VALIDATION
Testar em período que não participou do desenvolvimento.

Esse período é o **holdout final** e se usa **uma vez**. Olhou, ajustou e olhou de novo?
Ele virou dado de desenvolvimento e está queimado para sempre — arrume outro.

- **Gate:** ≥ 100 trades OOS, PF OOS ≥ 1.25, expectância OOS ≥ 0.10 R/trade,
  degradação IS → OOS ≤ 40%, `final_holdout_uses` ≤ 1.
- **Evidência:** `stage-3-validation.md` com as datas exatas do bloco OOS e a data em que ele
  foi aberto.

### STAGE 4 — WALK-FORWARD
Testar em múltiplas janelas cronológicas, com reotimização honesta a cada janela (só com
dados anteriores àquela janela).

- **Gate:** ≥ 6 janelas, ≥ 60% delas lucrativas, eficiência walk-forward ≥ 50%.
- **Evidência:** `stage-4-walkforward.md` com a tabela janela a janela, inclusive as ruins.

### STAGE 5 — STRESS TEST
Slippage, fees, execution delay, parameter perturbation, trade removal, regime changes.

O objetivo aqui não é confirmar: é **tentar matar**. Estratégia que só sobrevive na
configuração exata que você encontrou é sorte com nome técnico.

- **Gate:** sobrevive a 2× o slippage assumido, +50% de custo, atraso de execução declarado,
  perturbação de ±20% em cada parâmetro, remoção dos 5% melhores trades, e foi testada em
  ≥ 2 regimes distintos — mantendo PF ≥ 1.1 no **pior** cenário.
- **Evidência:** `stage-5-stress.md` com uma linha por cenário e o PF de cada um.

### STAGE 6 — MONTE CARLO
Estimar drawdown, losing streak e risk of ruin.

Reordenação de trades e reamostragem com reposição, no risco que o cliente realmente usa —
não no risco otimista da apresentação.

- **Gate:** ≥ 10.000 simulações, DD95 ≤ 25%, risk of ruin ≤ 1%, sequência de perdas no
  percentil 95 registrada e tolerável operacionalmente.
- **Evidência:** `stage-6-montecarlo.md` com a distribuição, o DD95 e as premissas.

### STAGE 7 — PAPER TRADE
Executar em tempo real sem capital, com a versão **congelada** que passou nos estágios
anteriores. Mexeu no código? Volta para o estágio afetado.

É aqui que aparece o que nenhum backtest mostra: latência, requote, spread de notícia,
gap de fim de semana, corretora que não preenche.

- **Gate:** ≥ 60 sessões e ≥ 100 trades, divergência de PF entre paper e backtest ≤ 30%,
  slippage médio dentro da tolerância declarada, zero erro crítico de execução.
- **Evidência:** `stage-7-paper.md` + log de execução + comparação trade a trade contra o
  backtest do mesmo período.

### STAGE 8 — PRODUCTION CANDIDATE
Somente estratégias que sobreviveram a todas as etapas.

- **Gate:** plano de risco escrito, kill-switch testado de verdade e monitoramento ligado.
- **Evidência:** `stage-8-production.md` com plano de risco, limites, quem desliga, como
  desliga e em quanto tempo.

---

## PROMOTION RULE

Uma estratégia só avança se cumprir os critérios da fase atual — todos, medidos, arquivados.

**Nunca promover porque:**

- teve grande lucro;
- apresentou curva bonita;
- teve win rate alto;
- funcionou em poucos meses.

Nenhum desses quatro é critério em lugar nenhum deste documento. Se você se pegar
argumentando por qualquer um deles, o argumento já está errado antes de terminar.

Afrouxar um gate para aprovar uma estratégia específica é fraudar o processo. O gate mora em
um arquivo versionado: qualquer mudança nele fica no histórico do git, com data e autor.
Calibrar gate é legítimo — **antes** do teste, para a casa inteira. Depois de ver o
resultado, não.

### Três controles que o processo original não tinha (e sem os quais ele vaza)

**1. Teste múltiplo.** Testar 100 ideias no mesmo bloco OOS produz "vencedores" por puro
acaso — com 100 tentativas, algumas passam em qualquer critério, inclusive em dado aleatório.
Por isso `configs_tested` é obrigatório a partir do STAGE 3: quantas variantes, parâmetros e
filtros foram testados até ali. Acima de 30, exige-se `multiple_testing_adjustment` escrito
(critério mais duro, teste tipo White's Reality Check / SPA, ou Deflated Sharpe Ratio no
espírito de Bailey & López de Prado). Sem isso, o funil de "100 ideias → 1 vencedora" não
seleciona a melhor: ele seleciona a mais sortuda.

**2. Holdout de uso único.** Cada estratégia declara `final_holdout_uses`. Passou de 1, o
STAGE 3 está reprovado. Dado olhado duas vezes não é out-of-sample.

**3. Uma curva por estratégia, não por cliente.** O painel calcula fator de lucro e drawdown
sobre contas reais com risco, modo de entrada, sessões e filtros **diferentes por cliente**.
Isso é excelente para suporte e péssimo como evidência: não existe "o resultado do robô",
existem N resultados de N configurações. Evidência de estratégia sai de uma configuração
congelada e declarada, nunca da média das contas.

---

## HALL OF FAME

Entram somente estratégias em **STAGE 7** ou **STAGE 8**, com os campos: Strategy, Market,
Version, Date promoted, OOS Profit Factor, OOS Expectancy, Sharpe, Max Drawdown, Average
Holding Time, Trades, Slippage tolerance, Monte Carlo DD95, Weaknesses, Current status.

O arquivo é **gerado** a partir do registro. Ninguém entra no Hall of Fame escrevendo o
próprio nome lá: entra preenchendo evidência que passa no validador.

Estratégia sem `weaknesses` preenchidas não é promovida. Estratégia sem fraqueza conhecida é
estratégia mal estudada.

## GRAVEYARD

[`STRATEGY_GRAVEYARD.md`](STRATEGY_GRAVEYARD.md) registra as rejeitadas com motivo da
rejeição, resultado, parâmetros e fraqueza descoberta.

**Nunca ressuscitar estratégia rejeitada simplesmente mudando parâmetros.** Ela só reabre com
**nova hipótese econômica ou estrutural**, em entrada nova do registro, com `reopened_from`
apontando para a original e recomeçando do STAGE 0. O validador recusa qualquer outro
caminho — inclusive "mudei o timeframe" e "troquei o ativo".

---

## LABORATORY PRINCIPLE

O objetivo do laboratório **não** é fazer todas as estratégias funcionarem. É **eliminar
estratégias ruins rapidamente** — e o mais barato possível.

Resultado saudável:

```
100 ideias
 → 30 passam no primeiro teste
 → 10 passam validação
 →  4 passam stress
 →  2 passam paper trade
 →  1 entra no Hall of Fame
```

Isso é sucesso. Uma taxa de aprovação alta não é sinal de talento: é sinal de critério
frouxo. O cemitério cheio é o ativo — ele é a lista do que já custou dinheiro e não vai
custar de novo.

Corolário desconfortável: **matar uma estratégia no STAGE 1 é lucro**, porque economiza o
capital que ela queimaria no STAGE 8. Quem trabalha aqui é medido por quantas ideias matou
rápido, não por quantas defendeu até o fim.

---

## Dívida de produção (a parte incômoda)

O Black Wolf AI (EA MT5 3.0) e o Black Wolf NinjaTrader (3.1) **já estão em produção e
vendidos a clientes**, e não percorreram nenhum destes estágios com evidência arquivada.
Aplicar este documento com honestidade significa registrar isso, não maquiar.

Por isso eles entram no registro com `status: "legacy"`, ficam **fora** do Hall of Fame e
aparecem como DÍVIDA em toda execução do validador, com prazo de auditoria. Colocá-los no
Hall of Fame agora seria cometer, na primeira hora do laboratório, exatamente o erro que ele
existe para impedir: promover por resultado comercial em vez de evidência.

Enquanto a auditoria não acontece, valem duas restrições:

1. Nenhuma métrica desses produtos pode ser apresentada como validada — nem em marketing,
   nem no painel, nem em conversa de venda.
2. Passado o prazo em `grandfathered.audit_deadline`, o validador passa a **falhar**. As
   saídas honestas são auditar, renegociar o prazo de forma explícita e versionada, ou tirar
   o produto de produção. Ignorar não é opção que o arquivo ofereça.

A auditoria retroativa é o caminho normal, na mesma ordem: reconstruir a hipótese (STAGE 0),
refazer o backtest com custo real (STAGE 1), e seguir. O que não existe é o atalho de
declarar aprovado o que nunca foi testado.
