# Coletor NinjaTrader 8 — instalação, compilação e validação

O coletor é um **AddOn NinjaScript** (`collector-nt8/BlackWolfFloorCollector.cs`) que roda dentro do
NinjaTrader 8 e envia, cerca de 1×/s, o estado das contas para o servidor local do Trading Floor.

**Ele é somente leitura.** O código não chama nenhuma API de ordens (`Submit`, `Cancel`, `Change`,
`Flatten`, `CreateOrder`, `CancelAllOrders`) — isso é verificado automaticamente por
`npm run collector:check`. Ele não pede, lê nem guarda senhas de corretora: usa as conexões
(Rithmic, Tradovate…) que você já abriu no NinjaTrader.

> ⚠️ **O que já foi validado e o que não foi.** O coletor foi compilado (Mono, C# 7) contra
> *stubs* que imitam a API do NT8 e executado contra o servidor real: JSON, HTTP, autenticação,
> deduplicação, filtros de conta e o ciclo de vida de recompilação funcionam. **Ele ainda não foi
> compilado nem executado dentro de um NinjaTrader 8 real** — isso só pode ser feito no Windows,
> pelos passos abaixo. Se algum nome da API divergir na sua versão, o NinjaScript Editor vai apontar
> a linha; me envie a mensagem de erro.

## 1. Pré-requisitos

- Windows com NinjaTrader 8 (testado o código contra a API documentada da 8.1.x).
- Servidor do Trading Floor rodando no mesmo PC (`npm start`, ver README).
- Contas Apex/prop **aparecendo na aba Accounts do NinjaTrader** (Control Center → Accounts).
  O coletor só enxerga o que o NinjaTrader enxerga.

## 2. Gerar o token do coletor

No painel: **Configurações → Integrações → Gerar token**, tipo **Coletor NinjaTrader 8**.
Copie o token (ele aparece uma única vez). Alternativa pelo terminal:

```bash
npm run token:create -- --name pc-ninjatrader --kind nt8
```

O token só permite **enviar** dados para `/api/ingest/nt8`. Ele não lê nada do painel e pode ser
revogado a qualquer momento em Configurações → Integrações.

## 3. Instalar o AddOn

1. Feche o NinjaScript Editor se estiver aberto.
2. Copie `collector-nt8/BlackWolfFloorCollector.cs` para
   `Documentos\NinjaTrader 8\bin\Custom\AddOns\`.
3. (Opcional, para o robô) copie também `collector-nt8/BlackWolfFloorRobotEvents.cs` para a mesma pasta.
4. No NinjaTrader: **New → NinjaScript Editor**, abra qualquer script e pressione **F5** (compilar).
   A barra inferior deve mostrar compilação sem erros.

Na primeira execução o AddOn cria `Documentos\NinjaTrader 8\BlackWolfFloor\collector.config` e fica
**desativado** até você colocar o token.

## 4. Configurar

Edite `Documentos\NinjaTrader 8\BlackWolfFloor\collector.config`:

```ini
serverUrl=http://127.0.0.1:4100
token=bwc_...cole_aqui...
collectorId=PC-TRADING
intervalMs=1000
# Para a ETAPA 7 (validar com UMA conta antes de expandir):
includeAccounts=APEX-123456-01
excludeAccounts=Sim101,Backtest,Playback101
includeSimulator=false
enabled=true
```

Depois **recompile (F5)** ou reinicie o NinjaTrader. O log fica em
`Documentos\NinjaTrader 8\BlackWolfFloor\collector.log` (nunca contém o token nem valores das contas).

- `serverUrl` com `http://` só é aceito para o próprio PC (127.0.0.1/localhost). Para outro
  computador use `https://` (ver `SEGURANCA.md`).
- `includeAccounts` vazio = todas as contas, menos as de `excludeAccounts` e as da conexão
  *Simulator* do NT8 (a menos que `includeSimulator=true`).

## 5. O que é coletado (e de onde)

| Campo no painel | Origem no NinjaTrader 8 | Observação |
|---|---|---|
| Saldo | `Account.Get(AccountItem.CashValue)` (ou `TotalCashBalance`) | depende da conexão informar |
| Equity | `AccountItem.NetLiquidation`; senão saldo + não realizado | |
| P&L realizado (dia) | `AccountItem.RealizedProfitLoss` | **a janela "do dia" é definida pela conexão/NT8**, não pelo app — valide (passo 6) |
| P&L não realizado | `AccountItem.UnrealizedProfitLoss`; senão soma das posições | |
| Posições | `Account.Positions` (instrumento, lado, qtd, preço médio) | |
| Não realizado por posição | `Position.GetUnrealizedProfitLoss(PerformanceUnit.Currency)` | usa a última cotação que o NT8 tem; **sem cotação ativa → "indisp."** |
| Ordens ativas | `Account.Orders` (exceto Filled/Cancelled/Rejected) | só leitura |
| Execuções | evento `Account.ExecutionUpdate` + `Account.Executions` (reenvio a cada 5 min) | deduplicadas pelo `ExecutionId` |
| Estado da conexão | `Connection.Status` / `PriceStatus`, `Connection.Options.Provider/Name` | |
| Drawdown / limite de liquidação | **não existe no NT8** | calculado pelo app a partir das regras que você configura, ou informado manualmente |

**Itens "não informados" aparecem como "—", nunca como zero.** Regra usada: um item é enviado se já
chegou por `AccountItemUpdate`, se vale ≠ 0, ou (para saldo/P&L) se outro item central da mesma conta
vale ≠ 0 — assim um P&L realizado de 0 no início do dia aparece como US$ 0,00 e não como "—".

### Limitações conhecidas por conexão

- **Trailing drawdown das prop firms (Apex etc.) não é exposto pelo NinjaTrader.** A lista oficial de
  `AccountItem` não tem esse campo. O app calcula localmente (com base no saldo inicial e no pico
  que ele mesmo observou) ou usa o **limite que você copia do dashboard da prop firm** — esta é a
  forma recomendada. Histórico anterior ao app é desconhecido.
- **Rithmic / Tradovate:** quais `AccountItem` cada uma preenche não é documentado de forma
  garantida. Verifique na tabela "Campos informados pela conexão" no painel da conta.
- **Tradovate só pela web:** se suas contas Tradovate não estão conectadas no NinjaTrader, o coletor
  não as vê. Um coletor direto pela API Tradovate não foi implementado (exigiria credenciais de API).
- **Horários** das execuções são convertidos do fuso **do Windows** para UTC. Se o fuso configurado
  no NinjaTrader (Tools → Options → General) for diferente do Windows, o horário exibido terá esse
  deslocamento (os valores financeiros não são afetados).
- Execuções **corrigidas/removidas** pela corretora: o painel mantém a primeira versão recebida.

## 6. ETAPA 7 — validar UMA conta antes de expandir

1. Coloque uma única conta em `includeAccounts` e recompile.
2. No painel, mude para **LIVE**. A conta aparece em segundos (sala sugerida pelo nome/conexão).
3. Em **Configurar**, informe: tamanho nominal, saldo inicial, tipo de drawdown, valor do drawdown e
   o **limite de liquidação atual copiado do dashboard da Apex**.
4. Compare com o NinjaTrader (Control Center → Accounts e Positions) por um pregão:

   | Conferir | Onde no NT8 | Esperado no painel |
   |---|---|---|
   | Saldo | Accounts → Cash value | igual |
   | P&L realizado | Accounts → Realized PnL | igual (e zera no mesmo horário) |
   | P&L não realizado | Accounts → Unrealized PnL | igual (±1 tick de defasagem) |
   | Posições | Positions | mesmas, mesma qtd e preço médio |
   | Execuções | Executions | todas, sem duplicadas |
   | Desconexão | desligue a conexão no NT8 | mesa fica cinza em ≤ ~5 s, valores marcados como desatualizados |
   | Coletor parado | feche o NinjaTrader | mesa cinza, totais excluem a conta |

5. Só depois amplie `includeAccounts` (ou deixe vazio para todas).

Anote qualquer divergência (especialmente P&L realizado e o horário em que ele zera) — isso define se o
painel pode usar o valor da conexão ou se precisa de cálculo próprio para "P&L do dia".

## 7. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Nada aparece no LIVE | token ausente/errado (veja `collector.log`), servidor parado, conta excluída pelo filtro |
| `Servidor recusou o token (401)` | token revogado ou do tipo "Robô" |
| `Servidor recusou os dados (400)` | versões diferentes de coletor e servidor |
| Conta aparece como "desatualizada" | NT8 fechado/travado ou PC sem comunicação com o servidor |
| "P&L não realizado indisponível" | instrumento sem cotação no NT8 (abra um gráfico ou Market Analyzer do instrumento) |
| Erro de compilação no NinjaScript Editor | nome da API diferente na sua versão — envie a linha do erro |

## 8. Remover

Apague os arquivos `BlackWolfFloor*.cs` de `bin\Custom\AddOns`, recompile (F5) e, se quiser, a pasta
`Documentos\NinjaTrader 8\BlackWolfFloor`. Revogue o token no painel.
