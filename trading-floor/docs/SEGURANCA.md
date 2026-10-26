# Segurança

O painel mostra informações financeiras privadas. O desenho parte de três premissas:
**roda no seu computador**, **não opera**, e **nunca toca em senhas de corretora**.

## O que está implementado

| Controle | Como |
|---|---|
| Exposição de rede | o servidor escuta só em `127.0.0.1` por padrão. Para `HOST` diferente ele **se recusa a subir sem TLS** (a menos que `ALLOW_INSECURE_LAN=1`, não recomendado) |
| Autenticação do painel | usuário + senha (mín. 10 caracteres), hash **scrypt** (N=32768) no banco; comparação em tempo constante; mesma resposta para usuário inexistente e senha errada |
| Primeiro acesso | a tela de criação de usuário só funciona **a partir do próprio PC** e **só se não houver usuário** |
| Sessão | token aleatório de 256 bits em cookie `HttpOnly`, `SameSite=Strict` (e `Secure` com TLS); no banco fica só o **SHA-256**; expira (padrão 12 h) |
| Força bruta | limite de 8 tentativas de login/min por IP |
| CSRF | cookie `SameSite=Strict` + bloqueio de requisições mutáveis com `Origin` não permitido |
| WebSocket | exige sessão válida e `Origin` permitido; mensagens limitadas a 64 KB; cliente lento é desconectado |
| Coletor e robô | tokens próprios (`bwc_…`, `bwr_…`), guardados só como hash, **escopo mínimo** (só enviar dados para o próprio endpoint), revogáveis |
| Validação de entrada | todo corpo/consulta passa por esquemas **zod** com limites de tamanho; campos desconhecidos são recusados na configuração |
| Cabeçalhos | CSP restritiva, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` na API |
| Logs | `Authorization`, cookies, senhas e tokens são mascarados; erros 500 não expõem detalhes ao navegador; o log do coletor não registra token nem valores |
| DEMO × LIVE | motores, canais WebSocket e salas separados; dados DEMO **nunca** vão para as tabelas financeiras (o repositório LIVE recusa `mode=demo`); a troca de modo no navegador descarta todo o estado anterior |
| Monitoramento puro | o coletor não usa nenhuma API de ordem (checado em `npm run collector:check`) |
| Deploy público | `.vercelignore` impede que `trading-floor/` vá junto com o site público do painel na Vercel |

## Acessar de outro PC/tablet da rede local

1. Gere um certificado confiável na rede, por exemplo com [mkcert](https://github.com/FiloSottile/mkcert):
   ```bash
   mkcert -install
   mkcert -cert-file certs/floor.pem -key-file certs/floor-key.pem 192.168.0.10 localhost 127.0.0.1
   ```
   (instale a CA do mkcert também no outro dispositivo).
2. No `.env`: `HOST=0.0.0.0`, `TLS_CERT=./certs/floor.pem`, `TLS_KEY=./certs/floor-key.pem`,
   `ALLOWED_ORIGINS=https://192.168.0.10:4100`.
3. Libere a porta 4100 no Firewall do Windows **só para a rede privada**.
4. No `collector.config`, se o NinjaTrader estiver em outro PC, use `serverUrl=https://…`
   (o coletor recusa `http://` para endereços que não sejam o próprio PC).

**Não exponha o painel na internet** (port forwarding, túnel público etc.). Para acesso remoto use uma
VPN (ex.: WireGuard/Tailscale) até a sua rede.

## O que fica com você

- O arquivo `.env` (senha do banco) e `collector.config`/`robot.config` (tokens) ficam em texto no
  disco do seu PC: proteja a conta do Windows. Se um token vazar, revogue-o e gere outro.
- Backups do PostgreSQL contêm histórico de execuções e saldos: trate-os como dados financeiros.
