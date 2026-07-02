# Black Wolf — Backend (Cloudflare Worker)

Este diretório versiona o código do Worker `blackwolf-api`
(`https://blackwolf-api.contact-1f3.workers.dev`).

## Versão atual: v18

### O que a v18 adiciona (sobre a v17 que está no ar)

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
