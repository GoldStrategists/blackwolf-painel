# BRIEFING — teste de estratégia (documento fechado, funciona sozinho)

> Cole este texto inteiro no chat/ferramenta que vai rodar o backtest.
> Ele não depende de nenhum contexto anterior.

---

## Tarefa

Fazer o backtest da estratégia descrita abaixo e devolver os números crus, no formato
pedido no fim. **Não é para fazer a estratégia dar certo.** É para descobrir rápido se ela
presta. Resultado ruim entregue com clareza vale mais que resultado bom maquiado.

## Ativo e gráfico

- **Símbolo:** `S100` (índice Nasdaq 100 na corretora). Se no terminal aparecer como `US100`,
  `NAS100` ou `USTEC`, use o nome exato do terminal e **informe qual usou**.
- **Timeframe:** M5.
- **Plataforma:** MetaTrader 5. Qualquer outro motor serve, desde que use dado de tick real.

## A estratégia

Uma operação por dia, no máximo. **A posição nasce e morre dentro da mesma sessão** — nunca
fica aberta com o mercado fechado. Essa regra é obrigatória e não é negociável.

Horários em **hora de Nova York** (converter para a hora do servidor da corretora e informar
qual conversão foi usada). Pregão do Nasdaq: 09:30 às 16:00 NY.

1. **Referência:** preço no fechamento da sessão anterior (16:00 NY do dia anterior de pregão).
2. **Leitura do sinal — 10:00 NY** (30 min após a abertura): calcular
   `variação % = (preço 10:00 − preço de referência) / preço de referência × 100`.
3. **Entrada — 15:00 NY** (1h antes do fechamento):
   - variação **positiva** e acima do movimento mínimo → **COMPRA**
   - variação **negativa** e abaixo do movimento mínimo negativo → **VENDE**
   - variação dentro do movimento mínimo → **não opera no dia**
4. **Saída — 15:45 NY**: fecha a posição, sempre, aconteça o que acontecer. (15 minutos antes
   do fim do pregão de propósito: ordem de encerramento precisa de liquidez.)
5. **Stop loss:** percentual do preço de entrada.
6. **Tamanho:** pelo risco — o lote sai da distância do stop e do percentual de risco do
   saldo. Se o lote calculado ficar abaixo do mínimo da corretora, **não operar** naquele dia.
   Nunca arredondar o lote para cima.

### Parâmetros (valores iniciais)

| Parâmetro | Valor inicial |
| --------- | ------------- |
| Movimento mínimo para operar | 0,10% |
| Stop loss | 0,60% do preço de entrada |
| Take profit | desligado (a saída é por horário) |
| Risco por operação | 1% do saldo |
| Permite venda | sim |
| Operações por dia | máximo 1 |

## Condições do teste (obrigatórias)

- **Modelagem:** "Cada tick com base em ticks reais" (*Every tick based on real ticks*).
  Tick gerado a partir de candle de 1 minuto **não é aceito**.
- **Qualidade do histórico:** precisa fechar em **100%** (mínimo 99%). Se cair, encurtar o
  período ou trocar a fonte dos ticks — e **avisar no relatório**.
- **Custos:** spread real dos ticks + comissão real da corretora conferida na especificação do
  símbolo. Se a comissão estiver zerada lá, aplicar a comissão real e informar qual foi usada.
- **Período de desenvolvimento:** **01/01/2025 a 31/12/2025**.
- **Período de validação:** 01/01/2026 em diante. **NÃO RODAR AGORA.** Está lacrado para uma
  única utilização futura. Rodar esse período agora destrói o único juiz imparcial que existe.

## Testes de controle (rodar junto, não são opcionais)

1. **Sinal invertido:** repetir tudo fazendo o contrário (variação positiva → vende). Se render
   parecido ou melhor, a hipótese é falsa e o que está pagando é a tendência do ativo.
2. **Deslocamento de horário:** repetir com sinal às 09:45 e às 10:15 NY. Se o resultado só
   existe às 10:00 exatas, é ajuste ao passado, não fluxo de mercado.
3. **Sem filtro de movimento mínimo** (0,00%): mostra se o filtro está ajudando ou se foi
   escolhido depois de ver o resultado.

## Limite de tentativas

Testar **no máximo 12 combinações** de parâmetros no total e **informar quantas foram
testadas**. Quanto mais combinações se testa, maior a chance de achar uma que parece boa por
puro acaso — isso precisa ficar registrado junto com o resultado.

## O que devolver (preencher exatamente esta tabela)

| Item | Valor |
| ---- | ----- |
| Símbolo usado | |
| Corretora / servidor | |
| Conversão de horário aplicada (NY → servidor) | |
| Período testado | |
| Qualidade do histórico (%) | |
| Spread médio e comissão aplicada | |
| Total de operações | |
| Operações vencedoras / perdedoras | |
| Lucro líquido (após custos) | |
| Fator de lucro | |
| Expectativa por operação | |
| Drawdown máximo (% e valor) | |
| Maior sequência de perdas seguidas | |
| Tempo médio de posição | |
| Resultado do teste de sinal invertido | |
| Resultado com sinal às 09:45 / 10:15 | |
| Resultado sem filtro de movimento mínimo | |
| Combinações testadas no total | |

Junto com a tabela, mandar:

- o **relatório do testador** e a **lista de operações exportada** (CSV ou HTML), que serão
  usados depois para simulação de risco;
- a **curva de capital**;
- qualquer coisa que tenha dado errado ou estranho no meio do caminho.

## Critérios de morte (decididos antes do teste)

A estratégia é descartada, sem apelação, se:

- fator de lucro **abaixo de 1,0 com custo real** no período de desenvolvimento;
- o resultado do **sinal invertido** for parecido ou melhor;
- o resultado **morrer** ao deslocar o horário em 15 minutos;
- o lucro vier de **menos de 30 operações** concentradas.

Se qualquer um acontecer, reportar como reprovada. Reprovar rápido é o objetivo.

## Contexto (por que essa estratégia existe)

Perto do fechamento existe fluxo obrigatório de quem não escolhe o horário: fundos que
rebalanceiam no fim do dia, ETFs alavancados que ajustam exposição diariamente e investidores
que só operam uma vez ao dia. Esse fluxo tende a empurrar o preço na direção que o dia já
vinha tomando. Base pública: Gao, Han, Li & Zhou, *Market Intraday Momentum*, Journal of
Financial Economics (2018) — no ETF do S&P 500, de 1993 a 2013, o retorno da primeira meia
hora previu o retorno da última meia hora, com efeito mais forte em dias de volatilidade e
volume altos.

A evidência posterior é **dividida**: parte dos estudos aponta enfraquecimento depois da
publicação, parte sustenta que o efeito persiste. Por isso o teste — não é para confirmar,
é para tentar derrubar.
