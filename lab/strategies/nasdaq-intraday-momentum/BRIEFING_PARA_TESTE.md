# BRIEFING — teste de estratégia (documento fechado, funciona sozinho)

> Cole este texto inteiro no chat/ferramenta que vai rodar o backtest.
> Ele não depende de nenhum contexto anterior.

---

## Tarefa

Fazer o backtest da estratégia abaixo **em 5 mercados** e devolver os números crus, no
formato pedido no fim. **Não é para fazer a estratégia dar certo.** É para descobrir rápido
se ela presta. Resultado ruim entregue com clareza vale mais que resultado bom maquiado.

## Mercados e horários

Timeframe **M5**, MetaTrader 5 (outro motor serve, desde que use dado de tick real).
Confirme o **nome exato de cada símbolo** no terminal e informe qual usou.

| Mercado | Símbolo provável | Fechamento do pregão | Sinal | Entrada | Saída |
| ------- | ---------------- | -------------------- | ----- | ------- | ----- |
| Nasdaq 100 | `S100` / `US100` / `NAS100` | 16:00 Nova York | 10:00 NY | 15:00 NY | 15:45 NY |
| S&P 500 | `US500` / `SP500` | 16:00 Nova York | 10:00 NY | 15:00 NY | 15:45 NY |
| Dow Jones | `US30` / `DJ30` | 16:00 Nova York | 10:00 NY | 15:00 NY | 15:45 NY |
| DAX | `DE40` / `GER40` | 17:30 CET | 09:30 CET | 16:30 CET | 17:15 CET |
| FTSE 100 | `UK100` | 17:30 CET (16:30 Londres) | 09:30 CET | 16:30 CET | 17:15 CET |

Os horários estão na **hora local de cada bolsa**. Converta para a hora do servidor da
corretora e **informe qual conversão usou**. Se o horário de sessão do símbolo na corretora
for diferente do da bolsa, use o da corretora e avise.

## A estratégia

**Uma operação por dia POR MERCADO.** Com os 5 mercados, são até 5 operações por dia, em dois
fechamentos de pregão diferentes (Europa e EUA). A posição **nasce e morre dentro da mesma
sessão** — nunca fica aberta com o mercado fechado. Isso é obrigatório e não é negociável.

1. **Referência:** preço no fechamento da sessão anterior daquele mercado.
2. **Leitura do sinal** (30 min após a abertura do pregão):
   `variação % = (preço no horário do sinal − referência) / referência × 100`.
3. **Entrada** (1h antes do fechamento do pregão):
   - variação **positiva** acima do movimento mínimo → **COMPRA**
   - variação **negativa** abaixo do movimento mínimo → **VENDE**
   - variação dentro do movimento mínimo → **não opera naquele mercado naquele dia**
4. **Saída** (15 min antes do fim do pregão): fecha a posição, sempre, aconteça o que
   acontecer. Os 15 minutos são de propósito: ordem de encerramento precisa de liquidez.
5. **Stop loss:** percentual do preço de entrada.
6. **Tamanho:** pelo risco — o lote sai da distância do stop e do percentual de risco do
   saldo. Se o lote calculado ficar abaixo do mínimo da corretora, **não operar**. Nunca
   arredondar o lote para cima.
7. **Proibido reentrar** no mesmo mercado no mesmo dia depois de tomar stop. Se o stop bateu,
   o sinal daquele dia falhou.

### Parâmetros (iguais para todos os mercados)

| Parâmetro | Valor inicial |
| --------- | ------------- |
| Movimento mínimo para operar | 0,10% |
| Stop loss | 0,60% do preço de entrada |
| Take profit | desligado (a saída é por horário) |
| Risco por operação | 1% do saldo |
| Permite venda | sim |
| Operações por dia | máximo 1 **por mercado** |

Usar **os mesmos parâmetros em todos os mercados**. Parâmetro diferente por mercado é ajuste
ao passado disfarçado de personalização.

## Condições do teste (obrigatórias)

- **Modelagem:** "Cada tick com base em ticks reais" (*Every tick based on real ticks*).
  Tick gerado a partir de candle de 1 minuto **não é aceito**.
- **Qualidade do histórico:** precisa fechar em **100%** (mínimo 99) em cada mercado. Se cair,
  encurtar o período ou trocar a fonte dos ticks — e **avisar no relatório**.
- **Custos:** spread real dos ticks + comissão real da corretora conferida na especificação do
  símbolo. Se estiver zerada lá, aplicar a comissão real e informar qual foi usada.
- **Período de desenvolvimento:** **01/01/2025 a 31/12/2025**.
- **Período de validação:** 01/01/2026 em diante. **NÃO RODAR AGORA.** Está lacrado para uma
  única utilização futura. Rodar agora destrói o único juiz imparcial que existe.

## Testes de controle (rodar junto, não são opcionais)

1. **Sinal invertido:** repetir fazendo o contrário (variação positiva → vende). Se render
   parecido ou melhor, a hipótese é falsa e o que paga é a tendência do ativo.
2. **Deslocamento de horário:** repetir com o sinal 15 minutos antes e 15 minutos depois. Se o
   resultado só existe no horário exato, é ajuste ao passado, não fluxo de mercado.
3. **Sem filtro de movimento mínimo** (0,00%): mostra se o filtro ajuda ou se foi escolhido
   depois de ver o resultado.

Os controles podem rodar só no Nasdaq e no DAX (um de cada fuso), para economizar tempo.

## Limite de tentativas

No máximo **12 combinações de parâmetros no total** — não 12 por mercado. Informar quantas
foram testadas. Quanto mais combinação se testa, maior a chance de achar uma que parece boa
por puro acaso.

## Como julgar (critério da cesta)

**A aprovação é da cesta inteira, nunca do melhor mercado.** Testar 5 mercados é ter 5 chances
de encontrar um vencedor por sorte.

- funciona em **1 de 5** → sorte, descarta;
- funciona em **3 ou mais de 5** e a soma dos 5 é lucrativa → é efeito, segue.

Escolher só o mercado que deu certo depois de ver os cinco resultados é enganar a si mesmo
com dado.

## O que devolver

**Uma tabela por mercado**, com: símbolo usado · período · qualidade do histórico (%) ·
spread médio e comissão aplicada · total de operações · vencedoras/perdedoras · lucro líquido
após custos · fator de lucro · expectativa por operação · drawdown máximo (% e valor) · maior
sequência de perdas seguidas · tempo médio de posição.

**Mais uma linha de TOTAL da cesta** (soma das 5, tratando como uma conta só).

**Mais os controles:** resultado do sinal invertido · resultado com o horário deslocado ±15
min · resultado sem filtro de movimento mínimo · combinações testadas no total · conversão de
horário aplicada (bolsa → servidor).

Junto com as tabelas, mandar:

- o **relatório do testador** e a **lista de operações exportada** (CSV ou HTML) de cada
  mercado, que serão usados depois para simulação de risco;
- a **curva de capital** da cesta;
- qualquer coisa que tenha dado errado ou estranho no meio do caminho.

## Critérios de morte (decididos antes do teste)

Descartada, sem apelação, se:

- a **cesta somada** tiver fator de lucro **abaixo de 1,0 com custo real** no período de
  desenvolvimento;
- funcionar em **menos de 3 dos 5** mercados;
- o **sinal invertido** render parecido ou melhor;
- o resultado **morrer** ao deslocar o horário em 15 minutos;
- o lucro vier de **menos de 30 operações** concentradas.

Se qualquer um acontecer, reportar como reprovada. Reprovar rápido é o objetivo.

## Contexto (por que essa estratégia existe)

Perto do fechamento existe fluxo obrigatório de quem não escolhe o horário: fundos que
rebalanceiam no fim do dia, ETFs alavancados que ajustam exposição diariamente e investidores
que só operam uma vez ao dia. Esse fluxo tende a empurrar o preço na direção que o dia já
vinha tomando, e quem está do outro lado (o formador de mercado) cobra para absorver esse
desequilíbrio.

Base pública: Gao, Han, Li & Zhou, *Market Intraday Momentum*, Journal of Financial Economics
(2018) — no ETF do S&P 500, de 1993 a 2013, o retorno da primeira meia hora previu o retorno
da última meia hora, com efeito mais forte em dias de volatilidade e volume altos. Os autores
encontraram o mesmo padrão em outros dez ETFs muito negociados — é por isso que o teste é em
cesta, e não em um mercado só.

A evidência posterior é **dividida**: parte dos estudos aponta enfraquecimento depois da
publicação, parte sustenta que o efeito persiste. Por isso o teste — não é para confirmar, é
para tentar derrubar.
