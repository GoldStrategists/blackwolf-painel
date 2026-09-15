# Como rodar cada estágio no MetaTrader 5

Guia prático, sem jargão. A regra da casa: **todo backtest deste laboratório roda em tick
real**. Está gravado em `lab/gates.json` e o validador recusa quem gravar outra coisa.

## Antes de qualquer teste — as três conferências

**1. Ligar o tick real.**
`Ctrl+R` abre o Testador de Estratégia. No campo de modelagem, escolher
**"Cada tick com base em ticks reais"** (*Every tick based on real ticks*). É o modo que usa
os ticks que a corretora realmente registrou, com o spread que realmente existiu. Qualquer
outro modo inventa os ticks a partir do candle de 1 minuto — inútil para um robô que opera em
M5.

**2. Conferir até onde existe tick real.**
Essa é a pegadinha que estraga backtest sem avisar: se a corretora só guardou 1 ano de ticks e
você testa 3 anos, o MT5 **completa o resto com tick sintético** e não dá aviso na cara. O que
denuncia é a barra **"Qualidade do histórico"** no fim do teste — ela precisa estar em 100%
(o laboratório aceita 99% para cima). Abaixo disso, encurte o período ou troque a fonte de
dados. Para ver o que existe: clique direito no símbolo no Observação de Mercado →
Símbolos → aba Ticks → baixar.

**3. Conferir a comissão.**
O testador usa a comissão configurada na especificação do símbolo
(Símbolos → Propriedades → Negociação → Comissão). Se lá estiver zero e seus clientes pagam
US$ 7 por lote, o backtest está mentindo a seu favor em todo trade. Confira antes, e anote
no dossiê qual comissão e qual spread entraram na conta.

Registre no dossiê, sempre: modo de modelagem, qualidade do histórico, corretora/servidor e o
período coberto por tick real.

---

## Estágio por estágio

| Estágio | O MT5 faz? | Como |
| ------- | ---------- | ---- |
| 1 BACKTEST | Sim | Teste único, tick real, período declarado. Salvar o relatório e a lista de trades. |
| 2 REPRODUÇÃO | Parcial | Rodar o mesmo período com os ticks de **outra corretora** e conferir se bate. Diferença grande = o resultado era da fonte de dados, não da estratégia. |
| 3 VALIDAÇÃO | Sim | Período que nunca foi usado para criar/ajustar. Na otimização existe o campo **Forward** (1/2, 1/3, 1/4): o MT5 otimiza na primeira parte e testa sozinho na parte final, que o otimizador nunca viu. |
| 4 WALK-FORWARD | Na mão | O MT5 dá **uma** janela de forward por vez. Para as 6+ janelas do estágio, repita o processo deslizando o período e anote janela a janela, inclusive as ruins. |
| 5 STRESS | Sim | Ver a lista abaixo. |
| 6 MONTE CARLO | **Não** | O MT5 não faz. Exporte a lista de trades e rode o cálculo fora dele. |
| 7 PAPER TRADE | Sim | Conta demo, tempo real, versão congelada, rodando sozinha. |
| 8 PRODUÇÃO | — | Plano de risco, kill-switch e monitoramento (o painel já cobre o monitoramento). |

### Estágio 5 — os seis ataques, no MT5

1. **Slippage 2×** — rodar com spread fixo maior que o real (campo de spread do testador).
2. **Custo +50%** — aumentar a comissão na especificação do símbolo e repetir.
3. **Atraso de execução** — campo **"Atrasos"** (*Delays*) do testador: usar um valor realista
   de VPS (50–100 ms) e também um pessimista.
4. **Perturbação de parâmetro ±20%** — rodar otimização em volta dos valores escolhidos e
   olhar a vizinhança. Se só o valor exato funciona, é sorte, não estratégia.
5. **Remoção dos 5% melhores trades** — feito na planilha da lista exportada, não no MT5.
6. **Regimes diferentes** — separar períodos de alta forte, de lateralização e de queda no
   ouro e rodar cada um. Estratégia que só vive num regime é uma aposta nesse regime.

Passa quem mantiver fator de lucro ≥ 1,1 **no pior** desses cenários.

### Estágio 6 — o único que precisa de coisa fora do MT5

Monte Carlo é embaralhar a ordem dos seus trades milhares de vezes para responder: "qual o
pior rombo que essa estratégia pode dar, se a mesma sequência aparecer em outra ordem?".
O MT5 não tem isso. O caminho: exportar a lista de trades do relatório e rodar um script que
faça as 10.000 simulações. **Ainda não existe neste repositório** — é a única peça que falta
para o ciclo rodar inteiro.

### Uma limitação que nenhum backtest resolve

Tick real reproduz preço e spread. Não reproduz recusa de ordem, requote em notícia, corretora
lenta nem gap de domingo com a sua ordem pendente no meio. É exatamente por isso que o
**estágio 7 (paper trade em tempo real) existe** e não pode ser pulado por "o backtest já
provou".
