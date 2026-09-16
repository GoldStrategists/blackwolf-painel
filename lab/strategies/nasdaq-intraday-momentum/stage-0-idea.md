# STAGE 0 — IDEA — Nasdaq: momentum intradiário de fim de sessão

- **Data:** 2026-09-15
- **Ativo alvo:** cesta de índices no MetaTrader 5 · M5 — US100 (Nasdaq), US500, US30, DE40, UK100
- **Origem:** estratégia pública — artigo acadêmico (logo, o STAGE 2 é reproduzir o autor)
- **Regra da casa atendida:** a posição **nasce e morre dentro da mesma sessão**. Nunca fica
  aberta com o mercado fechado.

## Por que esse dinheiro existe (hipótese econômica)

Perto do fechamento existe uma concentração forçada de ordens que **não é opinião sobre
preço**: fundos que precisam rebalancear no fechamento, ETFs alavancados que são obrigados a
ajustar exposição todo dia no fim do pregão, e investidores que só conseguem operar uma vez
ao dia. Essa gente não escolhe o horário — ela é obrigada a executar.

Quando o dia já veio subindo, esse fluxo obrigatório entra comprando; quando já veio caindo,
entra vendendo. O resultado é que **a direção do começo do dia tende a se repetir no fim do
dia**, não porque o mercado "adivinha", mas porque tem gente com a mão forçada.

Quem está do outro lado: o formador de mercado que precisa ser compensado para absorver esse
fluxo desequilibrado. É por isso que ele paga — e é por isso que o efeito não desaparece só
porque virou público.

Isso não é invenção minha. É o achado central de **Gao, Han, Li & Zhou, "Market Intraday
Momentum", Journal of Financial Economics (2018)**: no ETF do S&P 500, entre 1993 e 2013, o
retorno da primeira meia hora previu o retorno da última meia hora. O efeito é **mais forte em
dias de volatilidade alta, volume alto e dia de notícia macro**, e aparece em outros dez ETFs
muito negociados. A explicação teórica usada pelos autores é justamente rebalanceamento
infrequente (modelo de Bogousslavsky, 2016) e operador informado que chega tarde.

## Regra (versão 0.1, congelada para o STAGE 1)

1. Guardar o **preço no fechamento da sessão anterior**.
2. No **horário de leitura** (começo do dia de pregão), medir a variação até ali.
3. No **horário de entrada** (perto do fim da sessão): se a variação for positiva, **compra**;
   se for negativa, **vende**. Abaixo do movimento mínimo, **não opera aquele dia**.
4. **Fecha na hora marcada, sempre**, antes do fim da sessão.
5. Uma operação por dia, no máximo. Stop loss em % do preço. Tamanho pela % de risco.

## Mais de uma operação por dia — como, sem quebrar a hipótese

O fluxo obrigatório de fechamento acontece **uma vez por sessão, por mercado**. Forçar 3, 4
entradas no mesmo mercado no mesmo dia não gera mais vantagem: gera mais custo em cima da
mesma vantagem, uma só vez.

O jeito honesto de aumentar o número de operações é **aumentar o número de eventos**, não
espremer o mesmo evento. Dois caminhos, ambos legítimos:

**1. Mais mercados, mesma hipótese.** O artigo original encontrou o mesmo efeito em dez ETFs
muito negociados, não só no S&P 500. Cesta inicial:

| Mercado | Fechamento do pregão | Sinal | Entrada | Saída |
| ------- | -------------------- | ----- | ------- | ----- |
| US100 (Nasdaq) | 16:00 Nova York | 10:00 NY | 15:00 NY | 15:45 NY |
| US500 (S&P 500) | 16:00 Nova York | 10:00 NY | 15:00 NY | 15:45 NY |
| US30 (Dow) | 16:00 Nova York | 10:00 NY | 15:00 NY | 15:45 NY |
| DE40 (DAX) | 17:30 CET | 09:30 CET | 16:30 CET | 17:15 CET |
| UK100 (FTSE) | 17:30 CET (16:30 Londres) | 09:30 CET | 16:30 CET | 17:15 CET |

**2. Duas janelas de horário por dia**: o fechamento europeu e o fechamento americano são
eventos separados, em fusos diferentes. Uma cesta com mercados dos dois lados dá até **5
operações por dia**, em dois horários distintos — sem inventar nada.

O que **não** vale: reentrar no mesmo mercado depois de tomar stop no mesmo dia. Se o stop
bateu, o sinal daquele dia falhou. Reentrar é discutir com o resultado.

### A regra que protege a cesta

Testar em 5 mercados é ter 5 chances de encontrar um vencedor por acaso. Por isso o critério
de aprovação é da **cesta inteira**, não do melhor mercado:

- funciona em **1 de 5** → é sorte, descarta;
- funciona em **3 ou mais de 5**, e a cesta somada é lucrativa → é efeito.

Escolher só o mercado que deu certo depois de ver os cinco resultados é a definição de
enganar a si mesmo com dado.

## O que invalida esta hipótese (critério de morte, escrito ANTES do teste)

Mato a ideia, sem apelação, se qualquer um acontecer:

- Fator de lucro **abaixo de 1,0 com custo real** no período de desenvolvimento (STAGE 1).
- O resultado **só existir** num ano e sumir no outro.
- O resultado depender de um horário específico e **morrer** se eu mexer 15 minutos nele
  (isso é ajuste fino em cima do passado, não é o fluxo institucional).
- O sinal inverso (fazer o contrário da regra) render parecido — sinal de que o que está
  pagando é a tendência do ativo, não a hipótese.

## Honestidade sobre a evidência

A literatura posterior está **dividida**: parte dos estudos aponta que a previsibilidade
enfraqueceu fora da amostra original depois da publicação, parte sustenta que o efeito
persiste, inclusive em ETFs menos líquidos. Ou seja: **é uma hipótese respeitável, não uma
certeza**. É exatamente por isso que ela entra no laboratório em STAGE 0 e não em produção.

## Períodos declarados (antes de rodar)

- **Desenvolvimento:** 2025-01-01 → 2025-12-31.
- **Validação (lacrado, uso único):** 2026-01-01 → hoje. **Não abrir no STAGE 1.**
- Se a corretora tiver tick real de 2023–2024, esses anos entram como regime extra no STAGE 5.
