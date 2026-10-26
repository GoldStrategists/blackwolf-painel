# Integração com o robô Black Wolf

O painel recebe eventos do robô por um endpoint HTTP desacoplado. O robô **não precisa** do painel
para operar, e o painel **não precisa** do robô: se um dos dois cair, o outro segue normalmente.

## Regra principal: robô informa, conta confirma

| Origem | Aparece como | Pode virar "execução"? |
|---|---|---|
| Robô (`/api/ingest/robot`) | **ROBÔ · INFORMATIVO** | nunca |
| Coletor NT8 (feed de execuções da conta) | **EXECUÇÃO CONFIRMADA** | é a execução |
| Robô + execução real correspondente | **ROBÔ · ✓ CONFERE C/ EXECUÇÃO** | o evento do robô continua informativo; ganha o vínculo |

A correspondência usa o `orderId` (quando o robô informa) ou, na falta dele, mesma conta + mesmo
instrumento com até 15 s de diferença. Um `signal` nunca é tratado como operação.

## Contrato

```
POST /api/ingest/robot            (dados reais → modo LIVE)
POST /api/ingest/robot?target=demo (testes → modo DEMO)
Authorization: Bearer <token do tipo "Robô">
Content-Type: application/json
```

Corpo: um evento ou uma lista de até 200.

```json
{
  "eventId": "bw-2026-10-26-000123",
  "type": "entry_executed",
  "account": "APEX-123456-01",
  "strategy": "Black Wolf 3.1",
  "instrument": "NQ 12-26",
  "side": "buy",
  "quantity": 2,
  "price": 21045.25,
  "orderId": "a1b2c3",
  "message": "Entrada no rompimento",
  "time": "2026-10-26T14:31:05.120Z",
  "data": { "canal_topo": 21040, "canal_fundo": 20980 }
}
```

| Campo | Obrigatório | Regras |
|---|---|---|
| `eventId` | sim | único por evento; reenvios com o mesmo id são ignorados (deduplicação) |
| `type` | sim | `strategy_enabled`, `strategy_paused`, `channel_formed`, `signal`, `entry_executed`, `take_profit`, `stop_loss`, `position_closed`, `error` |
| `account` | não | nome exato da conta como no NinjaTrader |
| `time` | não | ISO 8601 com fuso; padrão = hora de chegada |
| `data` | não | pares chave/valor simples (texto ≤ 500, número, booleano) |

Resposta: `{"ok":true,"accepted":1,"duplicates":0}`. `400` = evento inválido (não reenviar),
`401` = token inválido.

## Opção 1 — NinjaScript (C#)

Copie `collector-nt8/BlackWolfFloorRobotEvents.cs` para `Documentos\NinjaTrader 8\bin\Custom\AddOns\`,
crie `Documentos\NinjaTrader 8\BlackWolfFloor\robot.config`:

```ini
serverUrl=http://127.0.0.1:4100
token=bwr_...
target=demo   # troque para live quando validar
```

e chame na estratégia:

```csharp
// em OnBarUpdate / OnExecutionUpdate do robô
BlackWolfFloorEvents.Send("signal", Account.Name, "Black Wolf 3.1", Instrument.FullName, "buy", 1, Close[0], null, "Rompimento do canal");
BlackWolfFloorEvents.Send("entry_executed", Account.Name, "Black Wolf 3.1", Instrument.FullName, "buy", 1, price, orderId, null);
```

`Send` retorna imediatamente (fila em background), nunca lança exceção e nunca bloqueia a thread da
estratégia. Sem `robot.config` o helper fica inativo (no-op). Validado com Mono contra o servidor;
ainda **não** compilado dentro de um NinjaTrader real.

> O robô atual (`BlackWolfNT3.1`) é distribuído compilado. Para emitir eventos, as chamadas acima
> precisam ser adicionadas ao código-fonte do robô e recompiladas.

## Opção 2 — qualquer linguagem (curl / Python / MQL5)

```bash
curl -X POST "http://127.0.0.1:4100/api/ingest/robot?target=demo" \
  -H "Authorization: Bearer bwr_..." -H "Content-Type: application/json" \
  -d '{"eventId":"teste-1","type":"signal","account":"DEMO-APEX-01","instrument":"NQ","side":"buy","message":"teste"}'
```

MQL5 (MetaTrader 5) — **esboço não testado**; exige adicionar `http://127.0.0.1:4100` em
*Ferramentas → Opções → Expert Advisors → Permitir WebRequest*:

```mql5
void BwFloorEvent(string type, string account, string msg)
{
   string body = StringFormat("{\"eventId\":\"%I64d-%d\",\"type\":\"%s\",\"account\":\"%s\",\"message\":\"%s\"}",
                              (long)TimeCurrent(), GetTickCount(), type, account, msg);
   char data[]; StringToCharArray(body, data, 0, StringLen(body));
   char result[]; string headers;
   string h = "Content-Type: application/json\r\nAuthorization: Bearer bwr_...\r\n";
   WebRequest("POST", "http://127.0.0.1:4100/api/ingest/robot", h, 2000, data, result, headers);
}
```

(`WebRequest` é síncrono no MT5 — chame-o fora do caminho crítico de execução.)
