# Black Wolf — Backend (Cloudflare Worker)

Este diretório versiona o código do Worker `blackwolf-api`
(`https://blackwolf-api.contact-1f3.workers.dev`).

## Versão atual: v27

### O que a v27 adiciona (auditoria profunda — segurança + dados de dinheiro)
- **Não perde mais trade com licença vencida**: `POST /api/ea/trades` grava o
  histórico mesmo com licença expirada/revogada e devolve `active:false` (antes
  respondia 403 e os trades sumiam pra sempre).
- **Dedup mais seguro**: nunca grava trade SEM conta (NULL furava o índice único
  e duplicaria o lucro); backlog ordenado p/ o corte de 500 descartar os mais
  novos. *(Pendente, precisa checar o índice no D1: trocar INSERT OR IGNORE por
  ON CONFLICT DO UPDATE p/ curar swap/commissão que liquidam depois.)*
- **Webhook do Stripe falha FECHADO** (segredo ausente = recusa, não aceita
  cobrança forjada).
- **Relatório soma no SQL** (SUM/COUNT/MAX/MIN) sem LIMIT — antes truncava em
  5000 e mostrava total errado a menos.
- **Senha inicial por CSPRNG** (>64 bits) no lugar de Math.random.
- Erro 500 não vaza detalhe interno; forgot-password sem oráculo de timing;
  limites de tamanho/enum em config/perfil/onboarding (anti-DoS).
- Confira /api/health: deve responder `blackwolf-api-v27`.

### O que a v26 adiciona (liga/desliga de sessão POR CONTA — item 6 do Luiz)
- O liga/desliga de cada sessão do robô agora pode ser definido **por conta**,
  não só global. Serve para o Luiz ter contas de teste operando sessões
  diferentes das de produção.
- O padrão continua **global** (admin): toda conta que não tiver ajuste próprio
  segue o global de hoje (retrocompatível — nada muda para os alunos).
- Guardado no override da conta (`users.ea_config → accounts[conta].sessionOn`,
  parcial); chave sem override herda o global. Sem migração de banco.
- No painel: seção "Risco por sessão" (admin) ganhou o checkbox Ativa por
  sessão, atrelado à conta selecionada. A tabela global virou "fallback".
- Confira /api/health: deve responder `blackwolf-api-v26`.

### O que a v25 adiciona (relatórios completos)
- GET /api/reports agora devolve também **saldo início/fim** do período
  (via balance_history), **% sobre o saldo inicial** e **detecção de
  depósito/saque**. Isso liga os cartões "Saldo início/fim" e o % na aba
  Relatórios do painel.
- O número subiu para v25 só para **confirmar o deploy**: o v24 já tinha a
  aba (resultado, trades, ganhos/perdas, melhor/pior), faltavam esses extras.
- Confira /api/health: deve responder `blackwolf-api-v25`.

### O que a v24 adiciona (ajustes do Luiz + auditoria)
- /api/admin/clients agora inclui as licenças de ADMIN (a do Luiz aparece na
  visão geral) + status online por cliente (last_seen) e contas reportando.
- Tudo o mais do v23 continua igual (colar este worker cobre v23+v24).


### O que a v23 adiciona (ROBUSTEZ DE PRODUÇÃO — deploy obrigatório)

Tabelas novas JÁ criadas no D1 (license_accounts, balance_history,
license_events + índices) e coluna users.ea_config_version. É só colar e
publicar o worker.

1. **Vínculo de conta ATÔMICO** (tabela license_accounts): sem corrida
   entre robôs simultâneos; o SQLite arbitra o limite (fim do estouro/perda
   de vínculo).
2. **POST /api/ea/trades atômico** (env.DB.batch): heartbeat + trades +
   histórico de saldo num commit tudo-ou-nada. COALESCE preserva o último
   saldo bom em heartbeat parcial. ACK com lista de tickets persistidos
   (retry seguro). Teto de 500 trades/POST.
3. **Dedupe por (licença, CONTA, ticket)**: contas diferentes com o mesmo
   número de ticket não se atropelam mais.
4. **EXPIRAÇÃO de licença** verificada nas 3 rotas do robô (antes nunca
   parava). Helper licenseState() unifica status+expiração; webhook grava
   expiração em ISO.
5. **GET /api/reports?period=week|month&from=&to=&account=**: relatório
   agregado no servidor — resultado = SOMA de trades (nunca diferença de
   saldo). Base: balance_history + índices.
6. **POST /api/admin/license** {email,action}: revoga/reativa DE VERDADE
   (com trilha em license_events).
7. **POST /api/admin/mt5-account** {email,account,op}: admin gerencia as
   contas da licença (desamarrar revenda/erro).
8. **Config versionada** (ea_config_version): UPDATE condicional → 409 em
   salvamento concorrente (last-write não vence em silêncio).
9. **Rate limiting** por IP/e-mail (login, forgot-password) via KV.
10. **config_version (ETag)** em /api/ea/config: robô manda ?since=<v> e
    recebe {changed:false} quando nada mudou.
11. Logs estruturados (console.log JSON) para diagnóstico sem abrir o banco.
12. /api/health → v23; /api/version novo.


### O que a v21 adiciona (CONFIABILIDADE — deploy obrigatório)

1. **Status por conta (`ea_status_acc`)**: dois robôs na mesma licença não
   sobrescrevem mais o saldo/status um do outro. `/api/my-data` devolve
   `statuses` (lista, uma por conta). Tabela já criada no D1.
2. **Trilha de auditoria (`config_log`)**: todo salvamento de config fica
   registrado (quem, quando, qual conta, o quê). Tabela já criada no D1.
3. **`account_mismatch` registrado** em `last_error` (visível no painel).
4. **Perfis globais só se aplicam a ALUNOS** (role=client): a conta do
   admin nunca tem a config sobrescrita por perfil.
5. v20 incluída: POST rejeitado (invalid_json) fica registrado.
6. `/api/health` responde `blackwolf-api-v21`.

As tabelas novas JÁ EXISTEM no banco (criadas via D1) — é só colar e
publicar o worker, sem nenhuma migração manual.


### O que a v19 adiciona (sobre a v18) — contrato do robô v1.2

1. **8 sessões no Operacional 1**: `sessionRisk` agora aceita/envia também
   `M5-09h`, `M5-15h30` e `M1-18h` (além das 5 antigas e do `OP2`).
2. **Liga/desliga por sessão (`sessionOn`)**: `GET /api/ea/config` sempre
   devolve as 8 chaves `on_<sessão>` explícitas (booleanos), conforme o
   contrato do robô v1.2. Controle GLOBAL do admin, salvo no KV
   (`SESSIONS`, chave `session_on`). Padrão de fábrica: só `on_M5-01h` e
   `on_M15-01h` = `true`.
3. `GET /api/risk-profiles` também devolve `sessionOn`;
   `POST /api/admin/risk-profiles` também aceita `sessionOn` para gravar.
4. `/api/health` responde `blackwolf-api-v19`.

O robô consulta a config a cada ~5 min — mudanças do admin valem para
todos os robôs na consulta seguinte, sem o aluno fazer nada.

### O que a v18 adicionou (sobre a v17)

1. **Perfis globais de risco** (Conservador / Moderado / Arrojado):
   - `GET /api/risk-profiles` — qualquer usuário logado lê os valores atuais
     dos 3 padrões (o painel usa para mostrar aos alunos).
   - `POST /api/admin/risk-profiles` — **somente admin** grava os valores
     (o painel tem o editor na página "Configurar Robô", visível só p/ admin).
   - Os valores ficam salvos no KV (`SESSIONS`, chave `risk_profiles`) —
     **não precisa de migração de banco nem de novo binding**.

2. **Propagação automática para os robôs**: em `GET /api/ea/config`, se o
   aluno está com `profile` = um dos 3 padrões (e não `custom`), o Worker
   substitui `sessionRisk`/`riskPerTrade` pelos valores ATUAIS do padrão.
   Ou seja: o admin muda o padrão → todos os robôs de alunos naquele padrão
   passam a usar os novos valores na próxima leitura de config, sem que o
   aluno precise salvar nada.

3. `/api/health` responde `blackwolf-api-v18` (para conferir o deploy).

### Como publicar (2 minutos, sem ferramenta local)

1. Abra o painel da Cloudflare → **Workers & Pages** → **blackwolf-api**.
2. Clique em **Edit code** (Quick Edit).
3. Apague tudo e cole o conteúdo de `worker.js` deste diretório.
4. Clique em **Save and deploy**.
5. Confira: abra `https://blackwolf-api.contact-1f3.workers.dev/api/health`
   — deve responder `{"ok":true,"service":"blackwolf-api-v18"}`.

Os bindings (DB, SESSIONS) e secrets já configurados são preservados —
o Quick Edit só troca o código.

### Compatibilidade

- Nenhum endpoint existente mudou de contrato; o robô (EA) não precisa de
  atualização.
- Enquanto a v18 não for publicada, o painel continua funcionando: ele usa
  os valores locais dos 3 padrões e o editor do admin mostra um aviso de
  que o backend ainda não foi atualizado.
