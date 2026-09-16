# Nasdaq — momentum intradiário de fim de sessão — dossiê

| Campo | Valor |
| ----- | ----- |
| id | `nasdaq-intraday-momentum` |
| Market | Cesta de índices · M5 · MT5 — US100, US500, US30, DE40, UK100 |
| Version | 0.2 |
| Origin | public — Gao, Han, Li & Zhou, *Market Intraday Momentum*, JFE (2018) |
| Owner | Luiz |
| Estágio atual | STAGE 0 (idea) |
| Status | in_lab |
| Robô de teste | `BlackWolfLab_IntradayMomentum.mq5` (deste diretório) |

## Hipótese

Ver [`stage-0-idea.md`](stage-0-idea.md) — inclui o critério de morte, escrito antes do
primeiro teste.

## Por que estes ativos

Sai do ouro. Hoje 100% da linha de produtos da casa depende de um regime só; índices com
hipótese diferente são a primeira diversificação real do laboratório.

A cesta (US100, US500, US30, DE40, UK100) também é o que permite **mais de uma operação por
dia sem inventar sinal**: são dois fechamentos de pregão por dia (Europa às 17:30 CET, EUA às
16:00 NY) e até 5 operações. Cada mercado roda em um gráfico, com o robô anexado a cada um e
um número mágico diferente — o limite de 1 operação por dia vale por mercado, não no total.

**Critério de aprovação é da cesta, não do melhor mercado:** 1 de 5 funcionando é sorte;
3 ou mais de 5, com a cesta somada lucrativa, é efeito.

## Como rodar o STAGE 1 (backtest básico)

1. Compilar o `.mq5` no MetaEditor (F7) e anexar no gráfico **US100 M5**.
2. Testador (`Ctrl+R`): modelagem **"Cada tick com base em ticks reais"**.
3. Período de **desenvolvimento**: `2025-01-01` a `2025-12-31`.
   **Não rodar 2026 ainda** — 2026 é o período lacrado de validação (STAGE 3), uso único.
4. Conferir no fim: **qualidade do histórico em 100%** e comissão real na especificação do
   símbolo. Se a qualidade cair, encurtar o período ou trocar a fonte dos ticks.
5. Guardar o relatório e a lista de operações neste diretório como `stage-1-backtest.md` +
   arquivo exportado.

### Os três horários (hora do servidor, não a sua)

O robô usa **hora do servidor do MT5**, que quase nunca é a hora de Brasília. Abra o gráfico
do US100 em M5 e veja em que horário o candle "acorda" (abertura de Nova York). A partir daí:

| Parâmetro | O que é | Sugestão inicial |
| --------- | ------- | ---------------- |
| `InpSignalHour/Minute` | 30 min depois da abertura de NY | abertura + 00:30 |
| `InpEntryHour/Minute` | 60 min antes do fechamento | fechamento − 01:00 |
| `InpCloseHour/Minute` | fecha tudo, sempre | fechamento − 00:15 |

O fechamento é 15 minutos **antes** do fim do pregão de propósito: ordem de encerramento
precisa de mercado com liquidez para ser executada. Fechar no último segundo é como sair do
estacionamento no fim do show.

## Controle de teste múltiplo

- Configurações testadas até aqui: **0**
- Usos do holdout final (2026): **0** — e só pode ir a 1.

## Fraquezas conhecidas (antes de qualquer teste)

- **Evidência dividida:** parte da literatura pós-publicação aponta que o efeito enfraqueceu
  fora da amostra original; parte sustenta que persiste. É hipótese respeitável, não certeza.
- **Estratégia pública:** quanto mais gente opera, menor o prêmio. Se funcionar, funciona com
  margem apertada — o custo decide.
- **Risco de evento:** entra perto do fechamento, que é quando sai fala de banco central e
  balanço. O stop existe, mas gap dentro da sessão fura stop.
- **Depende de horário:** se o resultado morrer ao mexer 15 minutos no horário, é ajuste ao
  passado, não fluxo institucional. O STAGE 5 vai testar exatamente isso.
- **Dado da corretora:** índice em CFD tem spread e horário de sessão que variam por
  corretora. O resultado pode ser da corretora, não da estratégia — por isso o STAGE 2 roda
  em duas fontes de tick diferentes.

## Registro de execução

| Estágio | Data | Veredito | Evidência |
| ------- | ---- | -------- | --------- |
| 0 IDEA | 2026-09-15 | pass | `stage-0-idea.md` |
| 1 BASIC BACKTEST | | | |
| 2 REPRODUCTION | | | |
| 3 VALIDATION | | | |
| 4 WALK-FORWARD | | | |
| 5 STRESS TEST | | | |
| 6 MONTE CARLO | | | |
| 7 PAPER TRADE | | | |
| 8 PRODUCTION | | | |
