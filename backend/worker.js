/**
 * ═══════════════════════════════════════════════════════════════
 *  BLACK WOLF — Back-end v28 (Cloudflare Worker)
 *  + v28: PAINEL ADMIN DE RESULTADOS. GET /api/admin/results (agregado + MRR +
 *         lista de clientes com P&L hoje/semana/mês/total) e ?email= (detalhe:
 *         curva, drawdown, % do dia). MRR real via monthly_amount guardado do
 *         webhook do Stripe (com cupom). Fuso do dia = servidor da corretora
 *         (EA_SERVER_OFFSET_MIN). Migração D1: users.monthly_amount, users.is_courtesy.
 *  + Webhook do Stripe (cria conta automática ao pagar)
 *  + v18: PERFIS GLOBAIS DE RISCO (admin define os 3 padrões;
 *         alunos escolhem; robôs em um perfil recebem os valores
 *         ATUAIS automaticamente na próxima leitura de config)
 *  + v19: ROBÔ v1.2 — 8 sessões no Operacional 1 (3 novas) e
 *         LIGA/DESLIGA por sessão (sessionOn, chaves "on_<sessão>")
 *         controlado globalmente pelo admin. Contrato do Luiz.
 *  + v20: OBSERVABILIDADE — POST /api/ea/trades rejeitado (ex.:
 *         invalid_json) agora fica registrado em ea_status.last_error,
 *         para nunca mais confundirmos "não gravou" com "não chamou".
 *  + v27: AUDITORIA PROFUNDA — correções de segurança e de dados (money):
 *         - P0-A: POST /api/ea/trades NÃO perde mais dados com licença vencida/
 *           revogada — grava o histórico e devolve active:false (antes: 403 e
 *           os trades sumiam para sempre). Ingestão de dados ≠ permissão de operar.
 *         - P0-B (parte segura): nunca grava trade SEM conta (NULL furava o dedup
 *           e duplicaria a cada reenvio → lucro dobrado); backlog ordenado p/ o
 *           corte de 500 descartar os mais NOVOS. [ON CONFLICT DO UPDATE pendente
 *           de verificar o índice único no D1.]
 *         - P0-D: webhook do Stripe FALHA FECHADO (segredo ausente = recusa, não
 *           aceita cobrança forjada).
 *         - P0-E: /api/reports agrega no SQL (SUM/COUNT/MAX/MIN) SEM LIMIT — antes
 *           truncava em 5000 e mostrava total ERRADO a menos.
 *         - P0-H: senha inicial por CSPRNG (>64 bits) em vez de Math.random.
 *         - Segurança: erro 500 não vaza err.message; forgot-password sem oráculo
 *           de timing (envio via waitUntil); limites de tamanho/enum em config,
 *           profile e onboarding (anti-DoS/inflar banco).
 *  + v26: LIGA/DESLIGA DE SESSÃO POR CONTA (decisão do Luiz — item 6).
 *         O padrão continua GLOBAL (admin), mas cada conta pode ter o seu
 *         próprio liga/desliga de sessão — contas de teste do sócio operam
 *         sessões diferentes das de produção. Guardado no override da conta
 *         (users.ea_config → accounts[conta].sessionOn, parcial); chave sem
 *         override herda o padrão global. Retrocompatível: contas sem
 *         override seguem exatamente o global de hoje.
 *  + v25: RELATÓRIOS COMPLETOS — GET /api/reports agora devolve também
 *         saldo INÍCIO/FIM do período (via balance_history), % sobre o
 *         saldo inicial e detecção de depósito/saque. (Número de versão
 *         subiu p/ v25 só para confirmar o deploy: o v24 já tinha a aba,
 *         faltavam esses campos extras.)
 *  + v23: ROBUSTEZ DE PRODUÇÃO (auditoria arquitetural) —
 *         - vínculo de conta ATÔMICO (tabela license_accounts) — sem corrida
 *           entre robôs simultâneos; o SQLite arbitra o limite;
 *         - POST /api/ea/trades agora é UM env.DB.batch (tudo-ou-nada):
 *           heartbeat + trades + histórico de saldo num commit atômico;
 *         - saldo/equity com COALESCE (heartbeat parcial não zera o último bom);
 *         - dedupe de trade por (licença, CONTA, ticket) — não descarta mais
 *           trades de contas diferentes com o mesmo ticket;
 *         - ACK: resposta lista os tickets realmente persistidos (retry seguro);
 *         - EXPIRAÇÃO de licença é verificada nas 3 rotas do robô (parava?
 *           nunca parava — agora sim) via helper licenseActive();
 *         - balance_history (série diária) → base para relatórios e para
 *           detectar depósito/saque (nunca calcular rendimento por saldo);
 *         - GET /api/reports (semanal/mensal) agregado no servidor;
 *         - POST /api/admin/license (revogar/reativar de verdade, com trilha);
 *         - POST /api/admin/mt5-account (admin gerencia contas da licença);
 *         - versionamento de config (ea_config_version) → 409 em conflito;
 *         - rate limiting por IP/licença (login, forgot, ea) via KV;
 *         - logs estruturados; expiração normalizada para ISO.
 *  + v22: AUDITORIA (correções de dinheiro/segurança) —
 *         - fixedLot/maxTrades/spreadFilter/timezone agora chegam ao robô;
 *         - Stripe: renovação NÃO rebaixa mais o plano; plano por metadata;
 *           replay de webhook bloqueado (timestamp);
 *         - config validada/limitada no servidor (não confia no cliente);
 *         - /api/admin/clients devolve licença/status/validade/contas;
 *         - handleProfile mantém visão de licença do sócio; guardas de
 *           row nulo; anti-enumeração de e-mail no login.
 *  + v21: CONFIABILIDADE MULTI-CONTA —
 *         (a) status por CONTA (ea_status_acc): dois robôs na mesma
 *             licença não sobrescrevem mais o saldo um do outro;
 *         (b) trilha de auditoria de config (config_log): todo save
 *             fica registrado com quem/quando/o quê;
 *         (c) account_mismatch fica registrado em last_error;
 *         (d) perfis globais só se aplicam a ALUNOS (role=client) —
 *             conta admin nunca tem a config sobrescrita por perfil.
 * ═══════════════════════════════════════════════════════════════
 *
 *  Bindings:
 *    DB        → D1 database  "blackwolf-db"
 *    SESSIONS  → KV namespace "blackwolf-sessions"
 *
 *  Secrets:
 *    RESEND_API_KEY     → chave da Resend
 *    EMAIL_FROM         → "Black Wolf <no-reply@blackwolfea.com>"
 *    PANEL_URL          → "https://painel.blackwolfea.com"
 *    STRIPE_WEBHOOK_SECRET → whsec_... (gerado no Stripe)
 */

const PBKDF2_ITER = 100000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '*';

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    try {
      if (path === '/api/login' && request.method === 'POST')            return await handleLogin(request, env, json);
      if (path === '/api/me' && request.method === 'GET')                return await handleMe(request, env, json);
      if (path === '/api/change-password' && request.method === 'POST')  return await handleChangePassword(request, env, json);
      if (path === '/api/profile' && request.method === 'POST')          return await handleProfile(request, env, json);
      if (path === '/api/onboarding' && request.method === 'POST')       return await handleOnboarding(request, env, json);
      if (path === '/api/forgot-password' && request.method === 'POST')  return await handleForgot(request, env, json, ctx);
      if (path === '/api/reset-password' && request.method === 'POST')   return await handleReset(request, env, json);
      if (path === '/api/admin/clients' && request.method === 'GET')      return await handleAdminClients(request, env, json);
      if (path === '/api/admin/results' && request.method === 'GET')      return await handleAdminResults(request, env, json, url);
      if (path === '/api/diag' && request.method === 'GET')              return await handleDiag(request, env, json);
      if (path === '/api/admin/broadcast' && request.method === 'POST')   return await handleAdminBroadcast(request, env, json);
      if (path === '/api/admin/reissue-license' && request.method === 'POST') return await handleAdminReissue(request, env, json);
      if (path === '/api/maintenance' && request.method === 'GET')         return await handleMaintenanceGet(request, env, json);
      if (path === '/api/admin/maintenance' && request.method === 'POST')  return await handleMaintenanceSet(request, env, json);
      if (path === '/api/admin/robot' && request.method === 'POST')        return await handleRobotUpload(request, env, json);
      if (path === '/api/robot/meta' && request.method === 'GET')          return await handleRobotMeta(request, env, json);
      if (path === '/api/robot/download' && request.method === 'GET')      return await handleRobotDownload(request, env, json, url);
      if (path === '/api/admin/payments' && request.method === 'GET')      return await handleAdminPayments(request, env, json);
      if (path === '/api/admin/stripe-sync' && request.method === 'POST')  return await handleAdminStripeSync(request, env, json);
      if (path === '/api/config' && request.method === 'POST')           return await handleSaveConfig(request, env, json);
      if (path === '/api/mt5-account' && request.method === 'POST')      return await handleMt5Account(request, env, json);
      if (path === '/api/my-data' && request.method === 'GET')           return await handleMyData(request, env, json);
      if (path === '/api/risk-profiles' && request.method === 'GET')     return await handleRiskProfilesGet(request, env, json);
      if (path === '/api/admin/risk-profiles' && request.method === 'POST') return await handleRiskProfilesSave(request, env, json);
      if (path === '/api/ea/config' && request.method === 'GET')         return await handleEaConfig(request, env, json, url);
      if (path === '/api/ea/trades' && request.method === 'POST')        return await handleEaTrades(request, env, json, url);
      if (path === '/api/ea/ping' && request.method === 'GET')           return await handleEaPing(request, env, json, url);
      if (path === '/api/stripe-webhook' && request.method === 'POST')   return await handleStripeWebhook(request, env, json);
      if (path === '/api/reports' && request.method === 'GET')           return await handleReports(request, env, json, url);
      if (path === '/api/admin/license' && request.method === 'POST')     return await handleAdminLicense(request, env, json);
      if (path === '/api/admin/mt5-account' && request.method === 'POST') return await handleAdminMt5(request, env, json);
      if (path === '/api/health')                                        return json({ ok: true, service: 'blackwolf-api-v37' });
      if (path === '/api/version')                                        return json({ ok: true, version: 'v37' });

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      // v27: não vaza detalhe interno (schema/SQL) ao cliente; registra no log estruturado
      try { logEvent({ evt: 'server_error', detail: String(err && err.message || err), stack: String(err && err.stack || '').slice(0, 500) }); } catch (e) {}
      return json({ error: 'server_error' }, 500);
    }
  },
};

/* ───────────────── CRIPTOGRAFIA ───────────────── */
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pbkdf2(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return bufToHex(bits);
}
function randomHex(bytes = 16) {
  return bufToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// v27: inteiro aleatório [0,max) por CSPRNG, SEM viés de módulo (rejection sampling)
function randInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % max;
}
// v27: senha legível E FORTE. Antes usava Math.random() (~900k combinações,
// formato público) → conta de cliente novo era adivinhável. Agora tudo por
// CSPRNG + sufixo de 48 bits → >64 bits de entropia, mantendo a parte legível.
function generatePassword() {
  const words = ['Wolf','Gold','Pack','Lone','Alpha','Star','Moon','Dark','Blue','Fire'];
  const w1 = words[randInt(words.length)];
  const w2 = words[randInt(words.length)];
  const num = String(1000 + randInt(9000));
  return w1 + '#' + num + w2 + '-' + randomHex(6); // ex: Wolf#4829Gold-a7f3c9d21b4e
}
// gera uma chave de licença de alta entropia, ex: BW-7F3A-9C21-E40B-5D8A-1F2C
// (a própria chave funciona como credencial/token do robô — por isso é aleatória e secreta)
function generateLicenseKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return 'BW-' + hex.match(/.{1,4}/g).join('-');
}
// Quantas contas MT5 cada plano permite (1 licença → N contas). Bate com o site:
// Lone Wolf = 1 · Wolf Pack = 2 · Alpha Pack / Alpha Pack External = 3
function planAccountLimit(plan) {
  const p = String(plan || '').toLowerCase();
  if (p.includes('alpha')) return 3;
  if (p.includes('pack'))  return 2;
  return 1;
}

/* ───────────────── LICENÇA: estado + expiração (v23) ─────────────────
   Fonte única de verdade sobre "a licença pode operar agora?". Antes cada
   rota checava só status !== 'active' e a EXPIRAÇÃO nunca era verificada —
   licença vencida continuava operando de graça. */
function toEpoch(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v; // ms ou s
  const s = String(v).trim();
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 1e12 ? Math.floor(n / 1000) : n; }
  const d = new Date(s); return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}
// retorna { active:bool, status:'active'|'revoked'|'expired'|'trial' }
function licenseState(row) {
  const st = row.license_status || (row.license_key ? 'active' : null);
  if (st && st !== 'active' && st !== 'trial') return { active: false, status: st };
  const exp = toEpoch(row.license_expires_at);
  if (exp && exp < Math.floor(Date.now() / 1000)) return { active: false, status: 'expired' };
  return { active: !!st, status: st || 'revoked' };
}

/* ───────────────── RATE LIMITING (v23, via KV) ─────────────────
   Token bucket simples por chave (IP+rota ou licença). Retorna true se
   ESTOUROU o limite (deve bloquear). Nunca quebra a request se o KV falhar. */
async function rateLimited(env, key, limit, windowSec) {
  try {
    const k = 'rl:' + key;
    const cur = parseInt((await env.SESSIONS.get(k)) || '0', 10) || 0;
    if (cur >= limit) return true;
    await env.SESSIONS.put(k, String(cur + 1), { expirationTtl: windowSec });
    return false;
  } catch (e) { return false; }
}
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}
// log estruturado (aparece no tail/Logpush) — sem PII crua (licença via hash curto)
function logEvent(obj) { try { console.log(JSON.stringify({ t: new Date().toISOString(), ...obj })); } catch (e) {} }

/* ───────────────── SESSÕES ───────────────── */
async function createSession(env, email) {
  const token = randomHex(32);
  await env.SESSIONS.put('sess:' + token, email, { expirationTtl: 60 * 60 * 24 * 30 });
  // v29: registra o token numa lista por usuário para poder REVOGAR tudo quando a
  // senha muda/reseta (antes um token roubado sobrevivia 30 dias a uma troca de senha).
  try {
    const k = 'usess:' + email;
    let arr = []; try { arr = JSON.parse(await env.SESSIONS.get(k) || '[]'); } catch (e) {}
    if (!Array.isArray(arr)) arr = [];
    arr.push(token);
    if (arr.length > 25) arr = arr.slice(-25);   // teto (evita crescer sem limite)
    await env.SESSIONS.put(k, JSON.stringify(arr), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (e) {}
  return token;
}
// revoga todas as sessões de um e-mail (opcionalmente preserva uma — a atual)
async function revokeSessions(env, email, exceptToken) {
  try {
    const k = 'usess:' + email;
    let arr = []; try { arr = JSON.parse(await env.SESSIONS.get(k) || '[]'); } catch (e) {}
    if (!Array.isArray(arr)) arr = [];
    const keep = [];
    for (const t of arr) {
      if (exceptToken && t === exceptToken) { keep.push(t); continue; }
      try { await env.SESSIONS.delete('sess:' + t); } catch (e) {}
    }
    await env.SESSIONS.put(k, JSON.stringify(keep), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (e) {}
}
function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}
async function getSessionEmail(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  return await env.SESSIONS.get('sess:' + token);
}
// converte o campo mt5_accounts (JSON no banco) numa lista limpa de contas,
// caindo para [mt5_account] quando a lista ainda estiver vazia (compatibilidade).
function accountsList(mt5AccountsRaw, mt5AccountSingle) {
  let list = [];
  try { list = mt5AccountsRaw ? JSON.parse(mt5AccountsRaw) : []; } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.map(a => String(a)).filter(a => a && a.trim() !== '');
  if (list.length === 0 && mt5AccountSingle) list = [String(mt5AccountSingle)];
  return list;
}

/* ─── PERFIS GLOBAIS DE RISCO (v18) ───
   O admin define os valores dos 3 padrões (Conservador/Moderado/Arrojado) e eles
   ficam salvos no KV (chave 'risk_profiles'). O aluno só escolhe o perfil; o robô
   recebe os valores ATUAIS do perfil na leitura de /api/ea/config — ou seja,
   mudou o padrão, mudou para todo mundo automaticamente. */
const DEFAULT_RISK_PROFILES = {
  conservador: { 'M5-01h':0.2, 'M15-01h':0.2, 'M1-02h':0.3, 'M1-11h':0.3, 'M1-17h':0.5, 'M5-09h':0.2, 'M5-15h30':0.2, 'M1-18h':0.3, 'OP2':0.3, _risk:0.3 },
  moderado:    { 'M5-01h':0.3, 'M15-01h':0.3, 'M1-02h':0.5, 'M1-11h':0.5, 'M1-17h':1.0, 'M5-09h':0.3, 'M5-15h30':0.3, 'M1-18h':0.5, 'OP2':0.5, _risk:0.5 },
  arrojado:    { 'M5-01h':0.5, 'M15-01h':0.5, 'M1-02h':0.8, 'M1-11h':0.8, 'M1-17h':1.5, 'M5-09h':0.5, 'M5-15h30':0.5, 'M1-18h':0.8, 'OP2':0.8, _risk:0.8 },
};
const RISK_PROFILE_NAMES = ['conservador','moderado','arrojado'];

/* ─── LIGA/DESLIGA POR SESSÃO (v19 — robô v1.2) ───
   O admin controla GLOBALMENTE quais sessões do Operacional 1 estão ativas.
   O robô lê em config.sessionOn com o prefixo "on_" (contrato do robô v1.2).
   OP2 fica de fora (o on/off dele segue no próprio robô por enquanto).
   Padrão de fábrica: só M5-01h e M15-01h ligadas. */
const SESSION_ON_KEYS = ['M5-01h','M15-01h','M1-02h','M1-11h','M1-17h','M5-09h','M5-15h30','M1-18h'];
const DEFAULT_SESSION_ON = {
  'M5-01h':true, 'M15-01h':true, 'M1-02h':false, 'M1-11h':false,
  'M1-17h':false, 'M5-09h':false, 'M5-15h30':false, 'M1-18h':false,
};
async function getSessionOn(env) {
  try {
    const s = await env.SESSIONS.get('session_on');
    if (s) {
      const p = JSON.parse(s);
      if (p && typeof p === 'object') {
        const out = {};
        for (const k of SESSION_ON_KEYS) out[k] = (k in p) ? !!p[k] : DEFAULT_SESSION_ON[k];
        return out;
      }
    }
  } catch (e) {}
  return { ...DEFAULT_SESSION_ON };
}
function sanitizeSessionOn(raw) {
  const out = { ...DEFAULT_SESSION_ON };
  if (raw && typeof raw === 'object') {
    for (const k of SESSION_ON_KEYS) if (k in raw) out[k] = !!raw[k];
  }
  return out;
}
// v26: override PARCIAL de sessionOn por CONTA. Só guarda as chaves presentes
// (como boolean); chave ausente = a conta herda o padrão GLOBAL (KV session_on).
// Não preenche defaults de propósito — o "vazio" significa "herdar".
function sanitizeSessionOnPartial(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of SESSION_ON_KEYS) if (k in raw) out[k] = !!raw[k];
  }
  return out;
}
async function getRiskProfiles(env) {
  try {
    const s = await env.SESSIONS.get('risk_profiles');
    if (s) {
      const p = JSON.parse(s);
      if (p && typeof p === 'object') {
        const out = {};
        for (const n of RISK_PROFILE_NAMES) out[n] = Object.assign({}, DEFAULT_RISK_PROFILES[n], p[n] || {});
        return out;
      }
    }
  } catch (e) {}
  return DEFAULT_RISK_PROFILES;
}
function sanitizeRiskProfiles(raw) {
  const out = {};
  for (const n of RISK_PROFILE_NAMES) {
    const src = (raw && typeof raw === 'object' && raw[n] && typeof raw[n] === 'object') ? raw[n] : {};
    const p = {};
    for (const k of SESSION_RISK_KEYS) {
      const v = Number(src[k]);
      if (isFinite(v) && v >= 0 && v <= 10) p[k] = Math.round(v * 100) / 100;
    }
    const r = Number(src._risk);
    if (isFinite(r) && r >= 0 && r <= 10) p._risk = Math.round(r * 100) / 100;
    out[n] = Object.assign({}, DEFAULT_RISK_PROFILES[n], p);
  }
  return out;
}
/* GET /api/risk-profiles — qualquer usuário logado lê os padrões atuais + sessões ativas */
async function handleRiskProfilesGet(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  return json({ ok: true, profiles: await getRiskProfiles(env), sessionOn: await getSessionOn(env) });
}
/* POST /api/admin/risk-profiles — só admin grava
   { profiles:{conservador,moderado,arrojado}, sessionOn:{'M5-01h':true,...} }
   (profiles e sessionOn são opcionais — grava o que vier) */
async function handleRiskProfilesSave(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }
  const now = new Date().toISOString();
  let profiles = null, sessionOn = null;
  if (body && body.profiles && typeof body.profiles === 'object') {
    profiles = sanitizeRiskProfiles(body.profiles);
    await env.SESSIONS.put('risk_profiles', JSON.stringify({ ...profiles, updated_at: now, updated_by: email }));
  }
  if (body && body.sessionOn && typeof body.sessionOn === 'object') {
    sessionOn = sanitizeSessionOn(body.sessionOn);
    await env.SESSIONS.put('session_on', JSON.stringify({ ...sessionOn, updated_at: now, updated_by: email }));
  }
  if (!profiles && !sessionOn) return json({ error: 'nothing_to_save' }, 400);
  return json({ ok: true, profiles: profiles || await getRiskProfiles(env), sessionOn: sessionOn || await getSessionOn(env) });
}

/* ─── CONFIG POR CONTA ───
   A config do robô agora suporta um valor por conta. Estrutura no banco:
     { "default": {..}, "accounts": { "8072210": {..}, "8077969": {..} }, "updated_at": ".." }
   - "default" = usado por qualquer conta que ainda não tenha config própria.
   - "accounts[CONTA]" = config específica daquela conta (sobrescreve o default).
   Formato ANTIGO (objeto plano {riskPerTrade:..}) é lido como o "default" (compatível). */
function normalizeEaConfig(raw) {
  let obj = {};
  try { obj = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {}; } catch (e) { obj = {}; }
  if (!obj || typeof obj !== 'object') obj = {};
  if (obj.accounts || obj.default) {
    const acc = (obj.accounts && typeof obj.accounts === 'object') ? obj.accounts : {};
    return { default: (obj.default && typeof obj.default === 'object') ? obj.default : {}, accounts: acc, updated_at: obj.updated_at || null };
  }
  // formato antigo (plano) → vira o default para todas as contas
  const { updated_at, ...rest } = obj;
  return { default: rest || {}, accounts: {}, updated_at: updated_at || null };
}
// mescla defaults-base + default-do-usuário + override-da-conta
function effectiveConfig(structNorm, account, baseDefaults) {
  const base = (structNorm && structNorm.default) ? structNorm.default : {};
  const key = (account != null) ? String(account) : null;
  const acc = (key && structNorm && structNorm.accounts && structNorm.accounts[key]) ? structNorm.accounts[key] : {};
  return Object.assign({}, baseDefaults || {}, base, acc);
}
function publicUser(row, licOverride) {
  const lic = licOverride || {
    plan: row.plan || null,
    license_key: row.license_key || null,
    license_status: row.license_status || (row.license_key ? 'active' : null),
    mt5_account: row.mt5_account || null,
    mt5_accounts: row.mt5_accounts || null,
    account_limit: (row.account_limit != null ? row.account_limit : null),
    license_expires_at: row.license_expires_at || null,
  };
  const accounts = accountsList(lic.mt5_accounts, lic.mt5_account);
  // devolve a configuração salva do robô (estrutura por conta) para o painel recarregar
  const rawCfg = (lic && lic.ea_config != null) ? lic.ea_config : row.ea_config;
  const eaConfig = normalizeEaConfig(rawCfg);   // { default, accounts, updated_at }
  return {
    email: row.email, name: row.name, role: row.role,
    display_name: row.display_name, photo: row.photo,
    phone: row.phone, whatsapp: row.whatsapp,
    country: row.country, city: row.city, lang: row.lang,
    plan: lic.plan ?? null,
    license_key: lic.license_key ?? null,
    license_status: lic.license_status ?? null,
    mt5_account: lic.mt5_account ?? (accounts[0] || null),
    mt5_accounts: accounts,                              // TODAS as contas vinculadas
    account_limit: (lic.account_limit != null ? lic.account_limit : null),
    ea_config: eaConfig,                                 // configuração salva do robô (recarrega o formulário)
    license_expires_at: lic.license_expires_at ?? null,
    last_login: row.last_login, prev_login: row.prev_login,
  };
}

// Sócios (com results_source) enxergam a licença/plano do POOL (as contas da
// sociedade), não a própria conta de admin (que é vazia). Os demais veem a sua.
async function licenseViewFor(env, row) {
  if (row && row.results_source) {
    const src = await env.DB.prepare(
      'SELECT plan, license_key, license_status, mt5_account, mt5_accounts, account_limit, ea_config, license_expires_at FROM users WHERE email = ?'
    ).bind(row.results_source).first();
    if (src) return {
      plan: src.plan || null,
      license_key: src.license_key || null,
      license_status: src.license_status || (src.license_key ? 'active' : null),
      mt5_account: src.mt5_account || null,
      mt5_accounts: src.mt5_accounts || null,
      account_limit: (src.account_limit != null ? src.account_limit : null),
      ea_config: src.ea_config || null,
      license_expires_at: src.license_expires_at || null,
    };
  }
  return null;
}

/* ───────────────── STRIPE WEBHOOK ───────────────── */
async function handleStripeWebhook(request, env, json) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  // v27: FALHA FECHADO. Se o segredo não estiver configurado, RECUSA o webhook
  // em vez de aceitar sem verificar (antes: um segredo ausente aceitava qualquer
  // POST forjado → criava/upgradava/revogava licença de graça).
  if (!env.STRIPE_WEBHOOK_SECRET) {
    try { logEvent({ evt: 'stripe_webhook_misconfigured' }); } catch (e) {}
    return json({ error: 'webhook_not_configured' }, 500);
  }
  const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'invalid_signature' }, 400);

  let event;
  try { event = JSON.parse(body); } catch(e) { return json({ error: 'invalid_json' }, 400); }

  // ── ASSINATURA: cancelamento, falha de pagamento, reativação ──
  // Regra: cancelou no meio do ciclo → MANTÉM ativo até o fim do período pago.
  // Só revoga quando o Stripe avisa que o período acabou de fato (deleted),
  // ou quando a assinatura vira canceled/unpaid (inadimplência esgotada).
  if (event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.created') {
    const sub = event.data.object;
    const cust = sub.customer;
    const periodEnd = sub.current_period_end || null;   // época (s) — fim do ciclo pago
    const status = sub.status;

    if (cust) {
      // guarda até quando está pago (para mostrar "acesso até..." no painel)
      if (periodEnd) {
        // v23: normaliza para ISO (o resto do sistema usa ISO; epoch cru quebrava
        // a comparação de expiração e a exibição no painel)
        const expIso = new Date(periodEnd * 1000).toISOString();
        await env.DB.prepare('UPDATE users SET license_expires_at = ? WHERE stripe_customer = ?').bind(expIso, cust).run();
      }
      let newStatus = null;
      if (event.type === 'customer.subscription.deleted') {
        newStatus = 'revoked'; // fim definitivo do ciclo (com cancel-at-period-end, só chega no fim)
      } else if (status === 'active' || status === 'trialing') {
        newStatus = 'active';  // ativo, mesmo com cancelamento agendado pro fim do ciclo
      } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
        newStatus = 'revoked'; // ciclo encerrado / inadimplência esgotada
      }
      // past_due / incomplete → não mexe (período de novas tentativas / pagamento inicial pendente)
      if (newStatus) {
        await env.DB.prepare('UPDATE users SET license_status = ? WHERE stripe_customer = ?').bind(newStatus, cust).run();
      }
    }
    return json({ ok: true, action: event.type.split('.').pop(), status: status || null, customer: cust || null });
  }

  // Só processa pagamentos completados
  if (event.type !== 'checkout.session.completed' && event.type !== 'invoice.payment_succeeded') {
    return json({ ok: true, ignored: true });
  }

  const obj = event.data.object;
  const stripeCustomer = obj.customer || null;

  // Pega email e nome do cliente
  let email = obj.customer_details?.email || obj.customer_email || null;
  let name  = obj.customer_details?.name  || 'Cliente' ;

  // v37: Identifica o plano SEM usar o valor pago. Promoção/cupom/sorteio NÃO podem
  // mudar o plano. Ordem: metadata.plan (setada no Payment Link) → metadata/nickname
  // do preço e do produto (via API Stripe, à prova de desconto) → plano PADRÃO da casa.
  // O valor pago é IGNORADO de propósito (era a origem do bug do limite de contas).
  const isCheckout = event.type === 'checkout.session.completed';
  const resolvedPlan = await resolvePlan(env, obj, isCheckout);
  let plan = resolvedPlan.plan;
  const planExplicit = resolvedPlan.explicit;

  if (!email) return json({ error: 'no_email' }, 400);

  email = email.trim().toLowerCase();

  // v28: guarda o VALOR REAL pago (em dólares, já com cupom aplicado) para o MRR
  // real do admin — não dá pra derivar do plano porque o cupom muda o valor.
  const monthlyAmount = (obj.amount_total || obj.amount_paid || 0) / 100;

  // v33/v36: registra o pagamento num LEDGER (tabela payments). Dedup pela FATURA
  // (obj.invoice para checkout de assinatura, ou obj.id quando o próprio obj já é a
  // fatura). Assim o webhook e o backfill da Stripe NUNCA contam o mesmo 2×.
  try {
    await ensurePaymentsTable(env);
    const payKey = obj.invoice || obj.id || event.id || null;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO payments (email, amount, currency, plan, type, event_id, created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(email, monthlyAmount, (obj.currency || 'usd').toUpperCase(), plan, event.type, payKey, new Date().toISOString()).run();
  } catch (e) { logEvent({ evt: 'payment_log_fail', detail: String(e && e.message || e) }); }

  // v22: renovação (invoice.payment_succeeded) NUNCA muda o plano/limite —
  // só a compra/troca explícita (checkout.session.completed) pode. Isso impede
  // o rebaixamento silencioso (Alpha 3 contas → Lone 1 conta) por valor de invoice.
  // (isCheckout já foi definido acima, na identificação do plano.)

  // Verifica se já tem conta
  const existing = await env.DB.prepare('SELECT email, license_key FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    // Cliente já tem conta — garante licença ativa e cliente Stripe salvo
    let lic = existing.license_key;
    if (!lic) { lic = generateLicenseKey(); }
    if (isCheckout && planExplicit) {
      // compra/troca EXPLÍCITA (metadata.plan): pode ajustar plano e limite.
      await env.DB.prepare("UPDATE users SET license_key = ?, license_status = 'active', plan = ?, account_limit = ?, monthly_amount = ?, stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?")
        .bind(lic, plan, planAccountLimit(plan), monthlyAmount, stripeCustomer, email).run();
    } else if (isCheckout) {
      // checkout SEM metadata.plan: o plano foi inferido do VALOR — e um cupom pode
      // ter baixado o valor abaixo da faixa. NÃO rebaixa plano/limite de um cliente
      // que já pagou por mais (Alpha 3 → Lone 1). Só reafirma licença + MRR.
      // (Corrigir plano nesse caso: setar metadata.plan no link de checkout do Stripe.)
      await env.DB.prepare("UPDATE users SET license_key = ?, license_status = 'active', monthly_amount = COALESCE(NULLIF(?,0), monthly_amount), stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?")
        .bind(lic, monthlyAmount, stripeCustomer, email).run();
    } else {
      // renovação: reafirma licença ativa + valor recorrente (MRR), preserva plano/limite
      await env.DB.prepare("UPDATE users SET license_key = ?, license_status = 'active', monthly_amount = COALESCE(NULLIF(?,0), monthly_amount), stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?")
        .bind(lic, monthlyAmount, stripeCustomer, email).run();
    }
    await sendWelcomeEmail(env, email, name, plan, null, lic);
    return json({ ok: true, action: 'already_exists' });
  }

  // Cria conta nova com senha aleatória + licença
  const password = generatePassword();
  const license = generateLicenseKey();
  const salt = randomHex(16);
  const hash = await pbkdf2(password, salt);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (email, password_hash, salt, name, role, lang, plan, license_key, license_status, account_limit, monthly_amount, stripe_customer, created_at)
     VALUES (?, ?, ?, ?, 'client', 'pt', ?, ?, 'active', ?, ?, ?, ?)`
  ).bind(email, hash, salt, name, plan, license, planAccountLimit(plan), monthlyAmount, stripeCustomer, now).run();

  // Envia email de boas-vindas com as credenciais + licença
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    await sendWelcomeEmail(env, email, name, plan, password, license);
  }

  return json({ ok: true, action: 'created', email, plan });
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    const parts = sigHeader.split(',');
    const tPart = parts.find(p => p.startsWith('t='));
    const v1Part = parts.find(p => p.startsWith('v1='));
    if (!tPart || !v1Part) return false;
    const timestamp = tPart.split('=')[1];
    const expected = v1Part.split('=')[1];
    // v22: rejeita webhooks antigos (proteção contra replay), como o SDK oficial do Stripe
    const ts = parseInt(timestamp, 10);
    if (!ts || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
    const signed = timestamp + '.' + payload;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signed));
    const computed = bufToHex(sig);
    return safeEqual(computed, expected);
  } catch(e) { return false; }
}

/* ===EMAIL_TEMPLATES_START=== (usadas no worker e no preview de e-mail) */
// Estrutura base do e-mail (cabecalho da marca + rodape), layout em TABELA para
// funcionar bem em Gmail/Outlook/Apple Mail. So o miolo (inner) muda por e-mail.
function emailShell(preheader, inner) {
  return `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Black Wolf</title></head>
<body style="margin:0;padding:0;background:#06070a;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06070a;"><tr><td align="center" style="padding:30px 12px;">
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#0c0e14;border-radius:18px;overflow:hidden;border:1px solid #171b26;">
    <tr><td align="center" bgcolor="#2D6CFF" style="background:#2D6CFF;background-image:linear-gradient(135deg,#2D6CFF 0%,#1b46c2 100%);padding:36px 28px 30px;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.34em;color:#d3deff;font-weight:700;text-transform:uppercase;margin-bottom:9px;">GOLD STRATEGISTS</div>
      <div style="font-family:'Trebuchet MS',Arial,sans-serif;font-size:34px;letter-spacing:.12em;color:#ffffff;font-weight:800;line-height:1;">BLACK&nbsp;WOLF</div>
      <div style="height:3px;width:52px;background:#FF3B47;border-radius:3px;margin:15px auto 0;"></div>
    </td></tr>
    <tr><td style="padding:34px 30px 6px;font-family:Arial,Helvetica,sans-serif;color:#E8EAED;">${inner}</td></tr>
    <tr><td style="padding:6px 30px 0;"><div style="height:1px;background:#1a1f2b;"></div></td></tr>
    <tr><td style="padding:18px 30px 30px;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#7f8696;">Precisa de ajuda? Fale com a gente no WhatsApp <b style="color:#aeb4c0;">+1 (229) 296-1795</b> ou <a href="mailto:contact@goldstrategists.com" style="color:#7fa6ff;text-decoration:none;">contact@goldstrategists.com</a>.</p>
      <p style="margin:0;font-size:11px;line-height:1.6;color:#4b5160;">Gold Strategists LLC &middot; 15168 Evergreen Oak Loop, FL 34787, USA</p>
    </td></tr>
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#3a3f4c;margin-top:16px;">&copy; 2026 Gold Strategists LLC &middot; Black Wolf</div>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

// Botao "a prova de balas" (cor no TD para o Outlook respeitar)
function ctaButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr>
    <td align="center" bgcolor="#2D6CFF" style="border-radius:11px;background:#2D6CFF;background-image:linear-gradient(135deg,#2D6CFF,#1b46c2);">
      <a href="${href}" style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:.02em;">${label}</a>
    </td></tr></table>`;
}

function welcomeEmailHtml(to, name, plan, password, license, panelUrl) {
  const isNew = !!password;
  const preheader = isNew ? 'Seu acesso ao Black Wolf esta pronto - credenciais e licenca dentro.' : 'Pagamento confirmado - seu Black Wolf esta ativo.';
  const headline = isNew ? 'Seu acesso esta pronto &#128058;' : 'Pagamento confirmado &#9989;';
  const intro = isNew
    ? `Ol&aacute; <b style="color:#E8EAED;">${name}</b>, seu pagamento foi confirmado e criamos seu acesso ao painel Black Wolf. Abaixo est&atilde;o seus dados de acesso e a sua chave de licen&ccedil;a.`
    : `Ol&aacute; <b style="color:#E8EAED;">${name}</b>, seu pagamento foi confirmado e o seu acesso continua ativo.`;

  const planChip = `<div style="margin:0 0 24px;"><span style="display:inline-block;background:rgba(45,108,255,.14);border:1px solid rgba(45,108,255,.32);color:#7fa6ff;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:7px 14px;border-radius:999px;">Plano ${plan}</span></div>`;

  const credsBlock = isNew ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#0a0c12;border:1px solid #1c2230;border-radius:14px;"><tr><td style="padding:20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:14px;">Seus dados de acesso</div>
      <div style="font-size:12px;color:#7f8696;margin-bottom:4px;">E-mail</div>
      <div style="font-family:'Courier New',monospace;font-size:15px;color:#E8EAED;margin-bottom:15px;word-break:break-all;">${to}</div>
      <div style="font-size:12px;color:#7f8696;margin-bottom:4px;">Senha provis&oacute;ria</div>
      <div style="font-family:'Courier New',monospace;font-size:19px;color:#7fa6ff;font-weight:bold;letter-spacing:.04em;">${password}</div>
    </td></tr></table>
    <p style="margin:0 0 18px;font-size:12px;color:#6b7280;line-height:1.55;">Por seguran&ccedil;a, troque a senha no primeiro acesso em <b style="color:#8b92a0;">Configura&ccedil;&otilde;es</b>.</p>` : '';

  const licenseBlock = license ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#0a0c12;border:1px solid #1c2230;border-radius:14px;"><tr>
      <td width="4" style="background:#2D6CFF;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Sua chave de licen&ccedil;a</div>
        <div style="font-family:'Courier New',monospace;font-size:17px;color:#7fa6ff;font-weight:bold;letter-spacing:.06em;word-break:break-all;">${license}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:11px;line-height:1.55;">Cole esta chave no rob&ocirc; (campo de licen&ccedil;a, dentro do MetaTrader) para ativ&aacute;-lo. Ela &eacute; a sua credencial &mdash; guarde com seguran&ccedil;a.</div>
      </td></tr></table>` : '';

  const inner = `
    <h1 style="margin:0 0 8px;font-size:23px;color:#ffffff;font-weight:800;line-height:1.25;">${headline}</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#aeb4c0;">${intro}</p>
    ${planChip}
    ${credsBlock}
    ${licenseBlock}
    ${ctaButton(panelUrl, 'Acessar meu painel &rarr;')}`;

  return emailShell(preheader, inner);
}

function resetEmailHtml(name, link) {
  const preheader = 'Link para redefinir sua senha do Black Wolf (expira em 1 hora).';
  const hi = name ? `Ol&aacute; <b style="color:#E8EAED;">${name}</b>, ` : 'Ol&aacute;, ';
  const inner = `
    <h1 style="margin:0 0 8px;font-size:23px;color:#ffffff;font-weight:800;line-height:1.25;">Redefinir sua senha</h1>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.65;color:#aeb4c0;">${hi}recebemos um pedido para redefinir a senha da sua conta Black Wolf.</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#aeb4c0;">Clique no bot&atilde;o abaixo para criar uma nova senha. Este link expira em <b style="color:#E8EAED;">1 hora</b>.</p>
    ${ctaButton(link, 'Redefinir minha senha')}
    <p style="margin:8px 0 0;font-size:12px;color:#6b7280;line-height:1.55;">Se voc&ecirc; n&atilde;o solicitou isso, ignore este e-mail &mdash; sua senha continua a mesma.</p>`;
  return emailShell(preheader, inner);
}
/* ===EMAIL_TEMPLATES_END=== */

async function sendWelcomeEmail(env, to, name, plan, password, license) {
  const panelUrl = env.PANEL_URL || 'https://painel.blackwolfea.com';
  const isNew = !!password;
  const html = welcomeEmailHtml(to, name, plan, password, license, panelUrl);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: isNew ? 'Black Wolf - Seu acesso esta pronto' : 'Black Wolf - Pagamento confirmado',
      html,
    }),
  });
}

/* ───────────────── DEMAIS ROTAS (iguais à v1) ───────────────── */
async function handleLogin(request, env, json) {
  const { email, password } = await request.json();
  if (!email || !password) return json({ error: 'missing_fields' }, 400);
  const e = String(email).trim().toLowerCase();
  // v23: trava anti-brute-force — 10 tentativas / 5 min por IP+email
  if (await rateLimited(env, 'login:' + clientIp(request) + ':' + e, 10, 300)) {
    logEvent({ evt: 'login_ratelimited', ip: clientIp(request) });
    return json({ error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' }, 429);
  }
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(e).first();
  // v22: mesmo com usuário inexistente, roda um pbkdf2 dummy para igualar o tempo
  // de resposta (impede enumeração de e-mails por timing).
  if (!row) { await pbkdf2(password, 'ffffffffffffffffffffffffffffffff'); return json({ error: 'invalid_credentials' }, 401); }
  const computed = await pbkdf2(password, row.salt);
  if (!safeEqual(computed, row.password_hash)) return json({ error: 'invalid_credentials' }, 401);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE users SET prev_login = last_login, last_login = ? WHERE email = ?').bind(now, e).run();
  const token = await createSession(env, e);
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(e).first();
  const licL = await licenseViewFor(env, fresh);
  return json({ token, user: publicUser(fresh, licL) });
}
async function handleMe(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!row) return json({ error: 'unauthorized' }, 401);
  const onb = await env.DB.prepare('SELECT * FROM onboarding WHERE email = ?').bind(email).first();
  const licM = await licenseViewFor(env, row);
  return json({ user: publicUser(row, licM), onboarding: onb || null });
}
async function handleChangePassword(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const { current, new_password } = await request.json();
  if (!current || !new_password) return json({ error: 'missing_fields' }, 400);
  if (String(new_password).length < 8) return json({ error: 'weak_password' }, 400);
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!row) return json({ error: 'unauthorized' }, 401);  // v22: sessão órfã (usuário removido)
  const computed = await pbkdf2(current, row.salt);
  if (!safeEqual(computed, row.password_hash)) return json({ error: 'wrong_current' }, 403);
  const salt = randomHex(16);
  const hash = await pbkdf2(new_password, salt);
  await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE email = ?').bind(hash, salt, email).run();
  // v29: derruba as OUTRAS sessões (mantém a atual) — token roubado morre na troca
  await revokeSessions(env, email, bearerToken(request));
  return json({ ok: true });
}
// v27: limita tamanho de campo de texto (evita gravar blob de MB → DoS/inflar banco)
function capStr(v, max) { if (v == null) return null; const s = String(v); return s.length > max ? s.slice(0, max) : s; }
async function handleProfile(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const b = await request.json();
  const lang = ['pt','en','es'].includes(b.lang) ? b.lang : 'pt';
  await env.DB.prepare(
    `UPDATE users SET display_name=?,photo=?,phone=?,whatsapp=?,country=?,city=?,lang=? WHERE email=?`
  ).bind(capStr(b.display_name,80),capStr(b.photo,2048),capStr(b.phone,40),capStr(b.whatsapp,40),capStr(b.country,60),capStr(b.city,60),lang,email).run();
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const licP = await licenseViewFor(env, fresh);  // v22: sócio mantém a visão da licença do pool
  return json({ ok: true, user: publicUser(fresh, licP) });
}
async function handleOnboarding(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const b = await request.json();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO onboarding (email,age,experience,goal,self_profile,family,source,country,state,city,marketing_opt_in,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET age=excluded.age,experience=excluded.experience,
       goal=excluded.goal,self_profile=excluded.self_profile,family=excluded.family,source=excluded.source,
       country=excluded.country,state=excluded.state,city=excluded.city,marketing_opt_in=excluded.marketing_opt_in`
  ).bind(email,capStr(b.age,20),capStr(b.experience,60),capStr(b.goal,60),capStr(b.self_profile,60),capStr(b.family,60),capStr(b.source,60),capStr(b.country,60),capStr(b.state,60),capStr(b.city,60),(b.marketing_opt_in?1:0),now).run();
  // mantém o país/cidade do cadastro do usuário em sincronia com o questionário
  if (b.country || b.city) {
    await env.DB.prepare('UPDATE users SET country=COALESCE(?,country), city=COALESCE(?,city) WHERE email=?')
      .bind(capStr(b.country,60), capStr(b.city,60), email).run();
  }
  return json({ ok: true });
}
async function handleForgot(request, env, json, ctx) {
  const { email } = await request.json();
  const e = String(email || '').trim().toLowerCase();
  const generic = { ok: true };
  if (!e) return json(generic);
  // v23: anti e-mail bombing — no máx 1 e-mail / 15 min por endereço (e resposta
  // continua genérica, então não vaza se o rate limit bateu)
  if (await rateLimited(env, 'forgot:' + e, 1, 900)) return json(generic);
  const row = await env.DB.prepare('SELECT email, name FROM users WHERE email = ?').bind(e).first();
  if (row) {
    const token = randomHex(32);
    await env.SESSIONS.put('reset:' + token, e, { expirationTtl: 60 * 60 });
    const panelUrl = env.PANEL_URL || 'https://painel.blackwolfea.com';
    const link = `${panelUrl}/?reset=${token}`;
    if (env.RESEND_API_KEY && env.EMAIL_FROM) {
      const html = resetEmailHtml(row.name, link);
      // v27: NÃO aguarda o envio (era um oráculo de timing: e-mail existente
      // demorava mais → dava pra enumerar clientes). waitUntil solta em segundo
      // plano; a resposta volta no mesmo tempo, exista o e-mail ou não.
      const send = fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[e],subject:'Redefinir sua senha — Black Wolf',html})}).catch(()=>{});
      if (ctx && ctx.waitUntil) ctx.waitUntil(send);
    }
  }
  return json(generic);
}
async function handleReset(request, env, json) {
  const { token, new_password } = await request.json();
  if (!token || !new_password) return json({ error: 'missing_fields' }, 400);
  if (String(new_password).length < 8) return json({ error: 'weak_password' }, 400);
  const email = await env.SESSIONS.get('reset:' + token);
  if (!email) return json({ error: 'invalid_or_expired' }, 400);
  const salt = randomHex(16);
  const hash = await pbkdf2(new_password, salt);
  await env.DB.prepare('UPDATE users SET password_hash=?,salt=? WHERE email=?').bind(hash,salt,email).run();
  await env.SESSIONS.delete('reset:' + token);
  // v29: recuperação de conta revoga TODAS as sessões (o dono legítimo re-loga;
  // qualquer sessão de um invasor com token roubado é derrubada)
  await revokeSessions(env, email);
  return json({ ok: true });
}

/* ───────────────── ADMIN: LISTA DE CLIENTES REAIS ─────────────────
   Requer sessão de administrador. Retorna apenas clientes reais
   (role='client'), excluindo as contas de demonstração. */
const DEMO_ACCOUNTS = ['demo.admin@blackwolfea.com', 'demo.cliente@blackwolfea.com', 'ea-test@blackwolfea.com'];
async function handleAdminClients(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);

  // v24 (item 2 do Luiz): a visão geral inclui TODA licença ativa — inclusive as
  // contas de admin que também são clientes (a do próprio Luiz). Antes filtrava só
  // role='client' e a licença do admin não aparecia no "quartel general".
  const rows = await env.DB.prepare(
    `SELECT u.email, u.name, u.role, u.country, u.plan, u.created_at,
            u.license_key, u.license_status, u.license_expires_at, u.mt5_accounts, u.account_limit,
            o.age, o.experience, o.goal, o.self_profile, o.family, o.source,
            o.country AS o_country, o.state, o.city, o.marketing_opt_in,
            (SELECT MAX(s.last_seen) FROM ea_status_acc s WHERE s.email = u.email) AS last_seen,
            (SELECT COUNT(*) FROM ea_status_acc s WHERE s.email = u.email) AS acc_online
     FROM users u
     LEFT JOIN onboarding o ON o.email = u.email
     WHERE u.role = 'client' OR u.license_key IS NOT NULL
     ORDER BY u.created_at DESC`
  ).all();

  const clients = (rows.results || [])
    .filter(r => !DEMO_ACCOUNTS.includes(String(r.email).toLowerCase()))
    .map(r => ({
      email: r.email,
      name: r.name,
      country: r.o_country || r.country,
      plan: r.plan,
      created_at: r.created_at,
      is_admin: r.role === 'admin',
      license_key: r.license_key || null,
      license_status: r.license_status || (r.license_key ? 'active' : null),
      license_expires_at: r.license_expires_at || null,
      accounts_used: (function(){ try { const a = r.mt5_accounts ? JSON.parse(r.mt5_accounts) : []; return Array.isArray(a) ? a.length : 0; } catch(e){ return 0; } })(),
      mt5_accounts: (function(){ try { const a = r.mt5_accounts ? JSON.parse(r.mt5_accounts) : []; return Array.isArray(a) ? a.map(String) : []; } catch(e){ return []; } })(),
      account_limit: (r.account_limit != null ? r.account_limit : null),
      last_seen: r.last_seen || null,
      accounts_reporting: r.acc_online || 0,
      onboarding: (r.age || r.o_country || r.marketing_opt_in) ? {
        age: r.age, experience: r.experience, goal: r.goal,
        selfProfile: r.self_profile, family: r.family, source: r.source,
        country: r.o_country, state: r.state, city: r.city, marketing: r.marketing_opt_in
      } : null,
    }));

  return json({ clients });
}

/* ─────────────── ADMIN: RESULTADOS DOS CLIENTES (v28) ───────────────
   GET /api/admin/results            → agregado + MRR + lista de clientes
   GET /api/admin/results?email=X    → detalhe de 1 cliente (curva, drawdown)
   Regra: resultado = SOMA de trades (profit+commission+swap), nunca saldo. */
// fuso do SERVIDOR da corretora (offset em min vs UTC). Os close_time dos trades
// vêm neste fuso; usamos ele pra fechar "o dia/semana/mês" sem erro de virada.
// Ajuste aqui se a corretora mudar de servidor (típico MT5: UTC+2/+3).
const EA_SERVER_OFFSET_MIN = 180;
function serverWindows() {
  const now = new Date(Date.now() + EA_SERVER_OFFSET_MIN * 60000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate(), wd = now.getUTCDay();
  const dot = (dt) => dt.toISOString().slice(0, 10).replace(/-/g, '.');
  const monday = new Date(Date.UTC(y, m, d - ((wd + 6) % 7)));
  return { today: dot(new Date(Date.UTC(y, m, d))), week: dot(monday), month: dot(new Date(Date.UTC(y, m, 1))) };
}
async function handleAdminResults(request, env, json, url) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);

  const W = serverWindows();
  const NET = '(COALESCE(profit,0)+COALESCE(commission,0)+COALESCE(swap,0))';
  const DP = "replace(substr(close_time,1,10),'-','.')";
  const target = url.searchParams.get('email');

  // ───── DETALHE de 1 cliente ─────
  if (target) {
    const t = String(target).trim().toLowerCase();
    const agg = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(${NET}),0) AS total,
              COALESCE(SUM(CASE WHEN ${DP} >= ? THEN ${NET} ELSE 0 END),0) AS today,
              COALESCE(SUM(CASE WHEN ${DP} >= ? THEN ${NET} ELSE 0 END),0) AS week,
              COALESCE(SUM(CASE WHEN ${DP} >= ? THEN ${NET} ELSE 0 END),0) AS month,
              SUM(CASE WHEN ${NET} > 0 THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN ${NET} < 0 THEN 1 ELSE 0 END) AS losses
       FROM trades WHERE email = ?`
    ).bind(W.today, W.week, W.month, t).first();
    const dayRows = await env.DB.prepare(
      `SELECT substr(close_time,1,10) AS d, SUM(${NET}) AS pnl FROM trades
       WHERE email = ? AND ${DP} >= ? GROUP BY d ORDER BY d ASC`
    ).bind(t, W.month).all();
    let cum = 0, peak = 0, maxDD = 0;
    const curve = (dayRows.results || []).map(r => { const p = +(+r.pnl || 0).toFixed(2); cum = +(cum + p).toFixed(2); if (cum > peak) peak = cum; if (peak - cum > maxDD) maxDD = peak - cum; return { day: String(r.d || '').replace(/\./g, '-'), pnl: p, cumulative: cum }; });
    const bal = await env.DB.prepare("SELECT COALESCE(SUM(balance),0) AS bal FROM ea_status_acc WHERE email = ? AND balance IS NOT NULL").bind(t).first();
    const balance = bal ? +(+bal.bal).toFixed(2) : 0;
    const u = await env.DB.prepare('SELECT name, plan, license_status, mt5_accounts, monthly_amount, is_courtesy FROM users WHERE email = ?').bind(t).first();
    const n = agg ? +agg.n : 0;
    const today = +(+(agg && agg.today || 0)).toFixed(2);
    const startDay = balance - today;
    return json({
      ok: true, email: t, name: (u && u.name) || t, plan: (u && u.plan) || null, status: (u && u.license_status) || null,
      accounts: (function () { try { const a = u && u.mt5_accounts ? JSON.parse(u.mt5_accounts) : []; return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } })(),
      currency: 'USD', balance, today, todayPct: (startDay > 0) ? +(today / startDay * 100).toFixed(2) : null,
      week: +(+(agg && agg.week || 0)).toFixed(2), month: +(+(agg && agg.month || 0)).toFixed(2), total: +(+(agg && agg.total || 0)).toFixed(2),
      trades: n, wins: agg ? +agg.wins : 0, losses: agg ? +agg.losses : 0, winRate: n ? +((agg.wins / n) * 100).toFixed(2) : 0,
      maxDrawdown: +maxDD.toFixed(2), curve
    });
  }

  // ───── AGREGADO + lista ─────
  const pnlRows = await env.DB.prepare(
    `SELECT email, COUNT(*) AS n, COALESCE(SUM(${NET}),0) AS total,
            COALESCE(SUM(CASE WHEN ${DP} >= ? THEN ${NET} ELSE 0 END),0) AS today,
            COALESCE(SUM(CASE WHEN ${DP} >= ? THEN ${NET} ELSE 0 END),0) AS week,
            COALESCE(SUM(CASE WHEN ${DP} >= ? THEN ${NET} ELSE 0 END),0) AS month
     FROM trades GROUP BY email`
  ).bind(W.today, W.week, W.month).all();
  const pnlByEmail = {}; (pnlRows.results || []).forEach(r => { pnlByEmail[String(r.email).toLowerCase()] = r; });
  const balRows = await env.DB.prepare("SELECT email, COALESCE(SUM(balance),0) AS bal FROM ea_status_acc WHERE balance IS NOT NULL GROUP BY email").all();
  const balByEmail = {}; (balRows.results || []).forEach(r => { balByEmail[String(r.email).toLowerCase()] = +r.bal; });
  const urows = await env.DB.prepare(
    `SELECT u.email, u.name, u.plan, u.license_status, u.monthly_amount, u.is_courtesy, u.mt5_accounts, u.role, u.created_at,
            (SELECT MAX(s.last_seen) FROM ea_status_acc s WHERE s.email=u.email) AS last_seen
     FROM users u WHERE (u.role='client' OR u.license_key IS NOT NULL) ORDER BY u.created_at DESC`
  ).all();

  let aggToday = 0, aggWeek = 0, aggMonth = 0, aggTotal = 0, mrr = 0, paying = 0, active = 0;
  const clients = (urows.results || [])
    .filter(r => !DEMO_ACCOUNTS.includes(String(r.email).toLowerCase()))
    .map(r => {
      const em = String(r.email).toLowerCase();
      const p = pnlByEmail[em] || {};
      const today = +(+(p.today || 0)).toFixed(2), week = +(+(p.week || 0)).toFixed(2), month = +(+(p.month || 0)).toFixed(2), total = +(+(p.total || 0)).toFixed(2);
      const balance = balByEmail[em] != null ? +(balByEmail[em]).toFixed(2) : null;
      const amount = (r.monthly_amount != null) ? +r.monthly_amount : 0;
      const st = r.license_status || null;
      const isActive = (st === 'active');
      // v34: CORTESIA só quando marcado de propósito (is_courtesy). NUNCA por valor 0
      // — quem pagou mas está sem monthly_amount (compra antiga / cupom) é PAGANTE.
      let pay; if (!isActive) pay = 'pendente'; else if (r.is_courtesy) pay = 'cortesia'; else pay = 'pagando';
      if (isActive) { active++; if (pay === 'pagando') { paying++; mrr += amount; } }
      aggToday += today; aggWeek += week; aggMonth += month; aggTotal += total;
      return {
        email: em, name: r.name || em, plan: r.plan || null, status: st, is_admin: r.role === 'admin',
        payment: pay, monthly_amount: amount, balance, today, week, month, total,
        accounts: (function () { try { const a = r.mt5_accounts ? JSON.parse(r.mt5_accounts) : []; return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } })(),
        last_seen: r.last_seen || null
      };
    });

  return json({
    ok: true, currency: 'USD',
    aggregate: { today: +aggToday.toFixed(2), week: +aggWeek.toFixed(2), month: +aggMonth.toFixed(2), total: +aggTotal.toFixed(2) },
    mrr: +mrr.toFixed(2), clientsActive: active, clientsPaying: paying, clientsTotal: clients.length,
    serverOffsetMin: EA_SERVER_OFFSET_MIN, clients
  });
}

/* ───────────────── DIAGNÓSTICO (v29) ─────────────────
   GET /api/diag  (admin) → por que os dados do robô não chegam?
   Mostra: tabelas existentes (com o CREATE real, p/ ver se falta chave única),
   quais tabelas OBRIGATÓRIAS estão faltando, contagens, os ÚLTIMOS ERROS que os
   robôs receberam (last_error) e os últimos trades/heartbeats. Cada consulta é
   isolada: se uma tabela não existir, ela aparece como "faltando" em vez de
   derrubar tudo. */
async function handleDiag(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);

  const REQUIRED = ['users','onboarding','trades','ea_status','ea_status_acc','balance_history','license_accounts','license_events','config_log'];
  const q = async (sql, ...b) => { try { const r = await env.DB.prepare(sql).bind(...b).all(); return r.results || []; } catch (e) { return { __error: String(e && e.message || e) }; } };
  const one = async (sql, ...b) => { try { return await env.DB.prepare(sql).bind(...b).first(); } catch (e) { return { __error: String(e && e.message || e) }; } };

  // tabelas presentes + o SQL real de criação (revela se falta PRIMARY KEY/UNIQUE)
  const master = await q("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name");
  const present = Array.isArray(master) ? master.map(r => r.name) : [];
  const missing = REQUIRED.filter(t => !present.includes(t));

  // contagens (tabela faltando → aparece como erro naquela contagem)
  const counts = {};
  for (const t of REQUIRED) { const r = await one(`SELECT COUNT(*) AS n FROM ${t}`); counts[t] = (r && r.__error) ? ('ERRO: ' + r.__error) : (r ? r.n : null); }

  // últimos erros que os robôs receberam (a pista mais direta do problema)
  const eaErrors = await q("SELECT email, account, last_seen, last_error FROM ea_status_acc WHERE last_error IS NOT NULL ORDER BY last_seen DESC LIMIT 25");
  const eaErrorsGlobal = await q("SELECT email, account, last_seen, last_error FROM ea_status WHERE last_error IS NOT NULL ORDER BY last_seen DESC LIMIT 25");
  // heartbeats mais recentes (robô chegou ao servidor?) e últimos trades gravados
  const lastSeen = await q("SELECT email, account, ea_version, balance, last_seen, last_error FROM ea_status_acc ORDER BY last_seen DESC LIMIT 15");
  const lastTrades = await q("SELECT email, account, symbol, close_time, profit, created_at FROM trades ORDER BY created_at DESC LIMIT 8");

  // veredito automático em linguagem simples
  const notes = [];
  if (missing.length) notes.push('TABELAS FALTANDO no banco: ' + missing.join(', ') + '. Rode o schema.sql no Console do D1 — é a causa mais provável de "nada chega".');
  if (Array.isArray(eaErrors) && eaErrors.length) {
    const kinds = [...new Set(eaErrors.map(e => e.last_error))];
    notes.push('Os robôs estão CHEGANDO ao servidor, mas sendo rejeitados. Erros: ' + kinds.join(', ') + '.');
  }
  if (!missing.length && (!Array.isArray(lastSeen) || lastSeen.length === 0)) {
    notes.push('Nenhum robô apareceu no servidor (0 heartbeats). Provável: URL do worker errada no robô, ou a URL não foi liberada no MT5 (Ferramentas → Opções → Expert Advisors → permitir WebRequest para a URL).');
  }
  if (typeof counts.trades === 'number' && counts.trades > 0) notes.push('Já existem ' + counts.trades + ' trade(s) gravados — o caminho de dados funciona.');
  if (!notes.length) notes.push('Sem anomalias óbvias. Veja lastSeen/eaErrors para detalhe.');

  return json({ ok: true, version: 'v37', now: new Date().toISOString(),
    tablesPresent: present, tablesMissing: missing, counts,
    eaErrors, eaErrorsGlobal, lastSeen, lastTrades,
    schema: master, notes });
}

/* ═══════════════ COMUNICADOS + REENVIO DE LICENÇA (v31) ═══════════════
   E-mail em massa PERSONALIZADO pros assinantes (manutenção, nova versão do robô,
   promo) e reemissão de licença. Reusa a Resend (já usada nas boas-vindas/reset).
   Sem IA: é template + merge determinístico dos dados do banco. */

// formata a validade da licença por idioma ('sem vencimento' se vitalícia)
function fmtValidade(x, lang) {
  const none = lang === 'en' ? 'no expiration' : lang === 'es' ? 'sin vencimiento' : 'sem vencimento';
  const ep = toEpoch(x); if (!ep) return none;
  try { return new Date(ep * 1000).toISOString().slice(0, 10); } catch (e) { return none; }
}
// nº de contas do plano ('ilimitado' quando -1)
function fmtContas(limit, lang) {
  if (limit === -1) return lang === 'en' ? 'unlimited' : lang === 'es' ? 'ilimitadas' : 'ilimitadas';
  const n = (limit != null ? limit : 1);
  return String(n) + ' ' + (n === 1 ? (lang === 'en' ? 'account' : lang === 'es' ? 'cuenta' : 'conta') : (lang === 'en' ? 'accounts' : lang === 'es' ? 'cuentas' : 'contas'));
}
// escapa HTML e vira <br> nas quebras de linha (o texto do admin vira corpo do e-mail)
function nl2brEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n/g, '<br>');
}
// substitui {{nome}}, {{plano}}, {{contas}}, {{validade}}, {{licenca}} por valores do aluno
function mergeTokens(str, tk) {
  return String(str == null ? '' : str).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (tk[k] != null ? String(tk[k]) : m));
}
function tokensFor(u) {
  const lang = ['pt', 'en', 'es'].includes(u.lang) ? u.lang : 'pt';
  const nome = (u.display_name || u.name || String(u.email || '').split('@')[0] || '').trim();
  return { nome, plano: u.plan || '—', contas: fmtContas(u.account_limit, lang), validade: fmtValidade(u.license_expires_at, lang), licenca: u.license_key || '—', lang };
}
// e-mail de COMUNICADO (título + corpo do admin + botão do painel)
function broadcastEmailHtml(title, bodyHtml, panelUrl, lang, isPromo) {
  const cta = ctaButton(panelUrl, lang === 'en' ? 'Open my panel &rarr;' : lang === 'es' ? 'Abrir mi panel &rarr;' : 'Acessar meu painel &rarr;');
  const unsub = isPromo ? `<p style="margin:14px 0 0;font-size:11px;color:#6b7280;line-height:1.55;">${lang === 'en' ? 'You receive offers because you opted in. Reply STOP to opt out.' : lang === 'es' ? 'Recibes ofertas porque lo autorizaste. Responde BAJA para no recibir más.' : 'Você recebe ofertas porque autorizou. Responda SAIR para não receber mais.'}</p>` : '';
  const inner = `
    <h1 style="margin:0 0 14px;font-size:23px;color:#ffffff;font-weight:800;line-height:1.25;">${title}</h1>
    <div style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#aeb4c0;">${bodyHtml}</div>
    ${cta}${unsub}`;
  return emailShell(title, inner);
}
// e-mail de LICENÇA (nova/reenvio) — mostra plano, nº de contas e validade REAIS
function licenseEmailHtml(u, panelUrl) {
  const t = tokensFor(u), lang = t.lang;
  const L = lang === 'en' ? { h: 'Your Black Wolf license', hi: 'Hi', intro: 'here is your access license. Paste this key into the robot (license field, inside MetaTrader) to activate it.', plan: 'Plan', acc: 'Accounts', val: 'Valid until', keep: 'This key is your credential — keep it safe.', cta: 'Open my panel &rarr;' }
    : lang === 'es' ? { h: 'Tu licencia Black Wolf', hi: 'Hola', intro: 'esta es tu licencia de acceso. Pega esta clave en el robot (campo de licencia, dentro de MetaTrader) para activarlo.', plan: 'Plan', acc: 'Cuentas', val: 'Válida hasta', keep: 'Esta clave es tu credencial — guárdala con seguridad.', cta: 'Abrir mi panel &rarr;' }
    : { h: 'Sua licença Black Wolf', hi: 'Olá', intro: 'esta é a sua licença de acesso. Cole esta chave no robô (campo de licença, dentro do MetaTrader) para ativá-lo.', plan: 'Plano', acc: 'Contas', val: 'Válida até', keep: 'Esta chave é a sua credencial — guarde com segurança.', cta: 'Acessar meu painel &rarr;' };
  const inner = `
    <h1 style="margin:0 0 8px;font-size:23px;color:#ffffff;font-weight:800;line-height:1.25;">${L.h}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#aeb4c0;">${L.hi} <b style="color:#E8EAED;">${nl2brEsc(t.nome)}</b>, ${L.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#0a0c12;border:1px solid #1c2230;border-radius:14px;"><tr><td width="4" style="background:#2D6CFF;font-size:0;line-height:0;">&nbsp;</td><td style="padding:20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">${L.h}</div>
      <div style="font-family:'Courier New',monospace;font-size:17px;color:#7fa6ff;font-weight:bold;letter-spacing:.06em;word-break:break-all;">${nl2brEsc(t.licenca)}</div>
      <div style="margin-top:14px;font-size:13px;color:#8b92a0;line-height:1.7;">${L.plan}: <b style="color:#E8EAED;">${nl2brEsc(t.plano)}</b><br>${L.acc}: <b style="color:#E8EAED;">${nl2brEsc(t.contas)}</b><br>${L.val}: <b style="color:#E8EAED;">${nl2brEsc(t.validade)}</b></div>
      <div style="font-size:12px;color:#6b7280;margin-top:11px;line-height:1.55;">${L.keep}</div>
    </td></tr></table>
    ${ctaButton(panelUrl, L.cta)}`;
  return emailShell(L.h, inner);
}

// seleciona os assinantes por público. b: { scope, plan, days, promoOnly }
async function selectSubscribers(env, b) {
  let where = "u.license_key IS NOT NULL";
  const binds = [];
  const scope = (b && b.scope) || 'active';
  if (scope === 'active') where += " AND u.license_status = 'active'";
  else if (scope === 'plan' && b.plan) { where += " AND u.plan = ?"; binds.push(String(b.plan)); }
  else if (scope === 'expiring') {
    const days = Math.max(1, Math.min(365, parseInt(b.days, 10) || 7));
    const lim = new Date(Date.now() + days * 86400000).toISOString();
    where += " AND u.license_expires_at IS NOT NULL AND u.license_expires_at <= ? AND u.license_status = 'active'";
    binds.push(lim);
  }
  const rows = await env.DB.prepare(
    `SELECT u.email, u.name, u.display_name, u.plan, u.account_limit, u.license_expires_at, u.license_key, u.lang,
            (SELECT o.marketing_opt_in FROM onboarding o WHERE o.email = u.email) AS mkt
     FROM users u WHERE ${where} ORDER BY u.created_at DESC`
  ).bind(...binds).all();
  let list = (rows.results || []).filter(r => !DEMO_ACCOUNTS.includes(String(r.email).toLowerCase()));
  if (b && b.promoOnly) list = list.filter(r => r.mkt === 1);
  return list;
}
// envia em LOTE pela Resend (100 por chamada). items: [{to,subject,html}]
async function sendResendBatch(env, items) {
  let sent = 0, failed = 0;
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100).map(e => ({ from: env.EMAIL_FROM, to: [e.to], subject: e.subject, html: e.html }));
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk)
      });
      if (r.ok) sent += chunk.length; else failed += chunk.length;
    } catch (e) { failed += chunk.length; }
  }
  return { sent, failed };
}

/* POST /api/admin/broadcast
   { scope, plan?, days?, subject, title?, message, type:'service'|'promo', test?:bool } */
async function handleAdminBroadcast(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role, name, display_name, plan, account_limit, license_expires_at, license_key, lang FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return json({ error: 'email_not_configured' }, 400);
  const b = await request.json();
  const subject = capStr(b.subject, 200), message = capStr(b.message, 8000);
  if (!subject || !message) return json({ error: 'missing_fields' }, 400);
  const title = capStr(b.title, 200) || subject;
  const isPromo = b.type === 'promo';
  const panelUrl = env.PANEL_URL || 'https://painel.blackwolfea.com';

  // TESTE: manda só pro próprio admin (com os dados dele), pra conferir antes de disparar
  let recips;
  if (b.test) recips = [{ email, name: me.name, display_name: me.display_name, plan: me.plan, account_limit: me.account_limit, license_expires_at: me.license_expires_at, license_key: me.license_key, lang: me.lang }];
  else { recips = await selectSubscribers(env, { scope: b.scope, plan: b.plan, days: b.days, promoOnly: isPromo }); }

  const CAP = 500; // teto por disparo (paginação futura via scope se crescer)
  const capped = recips.slice(0, CAP);
  const items = capped.map(u => {
    const tk = tokensFor(u);
    const subj = mergeTokens(subject, tk);
    const bodyHtml = nl2brEsc(mergeTokens(message, tk));
    const html = broadcastEmailHtml(nl2brEsc(mergeTokens(title, tk)), bodyHtml, panelUrl, tk.lang, isPromo);
    return { to: u.email, subject: subj, html };
  });
  const res = await sendResendBatch(env, items);
  logEvent({ evt: 'broadcast', by: email, scope: b.scope || 'active', promo: isPromo, total: recips.length, sent: res.sent, failed: res.failed, test: !!b.test });
  return json({ ok: true, total: recips.length, attempted: capped.length, sent: res.sent, failed: res.failed, truncated: recips.length > CAP, test: !!b.test });
}

/* POST /api/admin/reissue-license
   { emails:[...] }  ou  { scope, plan?, days? }  → gera licença nova + e-mail. */
async function handleAdminReissue(request, env, json) {
  const admin = await getSessionEmail(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const meRow = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(admin).first();
  if (!meRow || meRow.role !== 'admin') return json({ error: 'forbidden' }, 403);
  const b = await request.json();
  const panelUrl = env.PANEL_URL || 'https://painel.blackwolfea.com';

  let targets;
  if (Array.isArray(b.emails) && b.emails.length) {
    targets = b.emails.map(e => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 500);
  } else {
    const subs = await selectSubscribers(env, { scope: b.scope, plan: b.plan, days: b.days });
    targets = subs.map(s => String(s.email).toLowerCase()).slice(0, 500);
  }
  if (!targets.length) return json({ error: 'no_targets' }, 400);

  const items = [], results = [];
  for (const em of targets) {
    if (DEMO_ACCOUNTS.includes(em)) { results.push({ email: em, ok: false, reason: 'demo' }); continue; }
    const u = await env.DB.prepare('SELECT email, name, display_name, plan, account_limit, license_expires_at, license_key, lang FROM users WHERE email = ?').bind(em).first();
    if (!u) { results.push({ email: em, ok: false, reason: 'not_found' }); continue; }
    const oldKey = u.license_key;
    const newKey = generateLicenseKey();
    // troca a chave e SOLTA os vínculos/status da chave antiga (o robô novo reamarra;
    // o robô com a chave antiga passa a receber license_not_found e para).
    const stmts = [env.DB.prepare("UPDATE users SET license_key = ? WHERE email = ?").bind(newKey, em)];
    if (oldKey) {
      stmts.push(env.DB.prepare('DELETE FROM license_accounts WHERE license_key = ?').bind(oldKey));
      stmts.push(env.DB.prepare('DELETE FROM ea_status_acc WHERE license_key = ?').bind(oldKey));
      stmts.push(env.DB.prepare('DELETE FROM ea_status WHERE license_key = ?').bind(oldKey));
    }
    try { await env.DB.batch(stmts); } catch (e) { results.push({ email: em, ok: false, reason: 'db' }); continue; }
    u.license_key = newKey;
    if (b.notify !== false && env.RESEND_API_KEY && env.EMAIL_FROM) {
      const t = tokensFor(u);
      const subj = t.lang === 'en' ? 'Black Wolf — your new license' : t.lang === 'es' ? 'Black Wolf — tu nueva licencia' : 'Black Wolf — sua nova licença';
      items.push({ to: em, subject: subj, html: licenseEmailHtml(u, panelUrl) });
    }
    results.push({ email: em, ok: true });
  }
  let mail = { sent: 0, failed: 0 };
  if (items.length) mail = await sendResendBatch(env, items);
  logEvent({ evt: 'reissue', by: admin, count: results.filter(r => r.ok).length, emailed: mail.sent });
  return json({ ok: true, reissued: results.filter(r => r.ok).length, emailed: mail.sent, results });
}

/* ═══════════════ FINANCEIRO / PAGAMENTOS (v33) ═══════════════
   Ledger real de pagamentos do Stripe. A tabela é criada sozinha (zero setup). */
async function ensurePaymentsTable(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, amount REAL, currency TEXT DEFAULT 'USD', plan TEXT, type TEXT, event_id TEXT, created_at TEXT)").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_event ON payments (event_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_payments_created ON payments (created_at)").run();
}
async function handleAdminPayments(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  try { await ensurePaymentsTable(env); } catch (e) {}

  const nowIso = new Date().toISOString();
  const monthPrefix = nowIso.slice(0, 7);   // YYYY-MM
  const yearPrefix = nowIso.slice(0, 4);     // YYYY

  // totais do ledger (o que ENTROU de verdade). Ignora contas demo.
  const notDemo = "email NOT IN ('" + DEMO_ACCOUNTS.join("','") + "')";
  const tot = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN substr(created_at,1,7)=? THEN amount ELSE 0 END),0) AS month,
            COALESCE(SUM(CASE WHEN substr(created_at,1,4)=? THEN amount ELSE 0 END),0) AS year
     FROM payments WHERE ${notDemo}`
  ).bind(monthPrefix, yearPrefix).first();

  // MRR + assinantes pagantes (do cadastro de usuários — igual ao /api/admin/results)
  const urows = await env.DB.prepare(
    `SELECT email, name, plan, license_status, monthly_amount, is_courtesy, license_expires_at, created_at
     FROM users WHERE license_key IS NOT NULL ORDER BY created_at DESC`
  ).all();
  let mrr = 0, paying = 0;
  const subscribers = (urows.results || [])
    .filter(r => !DEMO_ACCOUNTS.includes(String(r.email).toLowerCase()))
    .map(r => {
      const amount = (r.monthly_amount != null) ? +r.monthly_amount : 0;
      const isActive = r.license_status === 'active';
      // v34: CORTESIA só quando marcado de propósito (is_courtesy). NUNCA por valor 0
      // — quem pagou mas está sem monthly_amount (compra antiga / cupom) é PAGANTE.
      let pay; if (!isActive) pay = 'pendente'; else if (r.is_courtesy) pay = 'cortesia'; else pay = 'pagando';
      if (pay === 'pagando') { paying++; mrr += amount; }
      return { email: String(r.email), name: r.name || String(r.email), plan: r.plan || '—', amount, status: r.license_status || null, payment: pay, expires: r.license_expires_at || null };
    });

  // histórico recente
  const recent = await env.DB.prepare(
    `SELECT p.email, p.amount, p.currency, p.plan, p.type, p.created_at, (SELECT u.name FROM users u WHERE u.email=p.email) AS name
     FROM payments p WHERE ${notDemo} ORDER BY p.created_at DESC LIMIT 60`
  ).all();

  // resumo de reembolsos/cancelamentos/falhas (preenchido na Sincronização com a Stripe)
  let fin = null; try { const s = await env.SESSIONS.get('fin_summary'); fin = s ? JSON.parse(s) : null; } catch (e) {}

  return json({
    ok: true, currency: 'USD',
    total: +(+tot.total).toFixed(2), month: +(+tot.month).toFixed(2), year: +(+tot.year).toFixed(2), count: +tot.n,
    mrr: +mrr.toFixed(2), payingCount: paying, subscriberCount: subscribers.length,
    refundsCount: (fin && fin.refundsCount) || 0, refundsAmount: (fin && fin.refundsAmount) || 0,
    canceledCount: (fin && fin.canceledCount) || 0, failedCount: (fin && fin.failedCount) || 0, syncedAt: (fin && fin.syncedAt) || null,
    subscribers, recent: (recent.results || [])
  });
}

/* ═══════════════ SINCRONIZAR COM A STRIPE (v34) ═══════════════
   Puxa o VALOR REAL que cada cliente paga por ciclo (último invoice pago — já com
   cupom aplicado) e grava em monthly_amount. Corrige MRR/valores das compras
   antigas (feitas antes do sistema guardar o valor). Exige STRIPE_SECRET_KEY. */
// devolve { ok, status, body } — assim dá pra distinguir chave inválida (401/403)
// de "não achou nada" (200 com lista vazia).
async function stripeGet(env, path) {
  try {
    const r = await fetch('https://api.stripe.com/v1' + path, { headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } });
    let body = null; try { body = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, body };
  } catch (e) { return { ok: false, status: 0, body: null }; }
}

// v37: Resolve o plano de um pagamento SEM usar o valor pago. O valor (com cupom/
// promoção) NUNCA decide o plano — isso era a origem do bug do limite de contas.
// Padrão da casa quando nada indica o plano: Wolf Pack (2 contas). Setar metadata.plan
// no Stripe (Payment Link ou Produto) deixa 100% correto p/ qualquer plano (1/2/3).
const DEFAULT_PLAN = 'Wolf Pack';
function looksLikePlan(s) { const p = String(s || '').toLowerCase(); return p.includes('alpha') || p.includes('pack') || p.includes('lone'); }
async function resolvePlan(env, obj, isCheckout) {
  // 1) metadata.plan da sessão/objeto (ex.: setada no Payment Link)
  if (obj && obj.metadata && looksLikePlan(obj.metadata.plan)) return { plan: obj.metadata.plan, explicit: true };
  // 2) metadata/nickname do PREÇO e do PRODUTO (à prova de desconto — só em checkout)
  if (isCheckout && obj && obj.id && env.STRIPE_SECRET_KEY) {
    try {
      const li = await stripeGet(env, '/checkout/sessions/' + obj.id + '/line_items?limit=1&expand[]=data.price.product');
      const item = li && li.ok && li.body && li.body.data && li.body.data[0];
      const price = item && item.price;
      const prod = price && price.product;
      const sigs = [
        price && price.metadata && price.metadata.plan,
        prod && prod.metadata && prod.metadata.plan,
        price && price.nickname,
        prod && prod.name,
      ];
      for (const sig of sigs) { if (looksLikePlan(sig)) return { plan: sig, explicit: true }; }
    } catch (e) { logEvent({ evt: 'plan_resolve_fail', detail: String(e && e.message || e) }); }
  }
  // 3) padrão da casa — NUNCA adivinha pelo valor pago
  return { plan: DEFAULT_PLAN, explicit: false };
}
async function handleAdminStripeSync(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_key_missing', message: 'Configure STRIPE_SECRET_KEY nas variáveis do worker.' }, 400);

  // 0) TESTA a chave antes de tudo (motivo do erro fica claro em vez de "falha")
  const probe = await stripeGet(env, '/customers?limit=1');
  if (!probe.ok) {
    const msg = (probe.body && probe.body.error && probe.body.error.message) || ('HTTP ' + probe.status);
    return json({ error: 'stripe_auth', status: probe.status, message: 'A chave da Stripe não autenticou (permissão/valor). Detalhe: ' + msg }, 400);
  }

  await ensurePaymentsTable(env);
  // TODOS os assinantes (mesmo sem stripe_customer salvo — a gente acha pelo e-mail)
  const rows = await env.DB.prepare("SELECT email, stripe_customer, plan FROM users WHERE license_key IS NOT NULL").all();
  const list = (rows.results || []).filter(u => !DEMO_ACCOUNTS.includes(String(u.email).toLowerCase())).slice(0, 300);
  let checked = 0, updated = 0, noCustomer = 0, noAmount = 0, backfilled = 0; const results = [];
  for (const u of list) {
    checked++;
    let cust = u.stripe_customer && String(u.stripe_customer).trim();
    // sem id salvo → procura o cliente na Stripe pelo e-mail
    if (!cust) {
      const cs = await stripeGet(env, '/customers?email=' + encodeURIComponent(String(u.email).toLowerCase()) + '&limit=1');
      if (cs.ok && cs.body && Array.isArray(cs.body.data) && cs.body.data[0]) cust = cs.body.data[0].id;
    }
    if (!cust) { noCustomer++; results.push({ email: u.email, ok: false, reason: 'no_customer' }); continue; }
    let amount = null;
    // FATURAS PAGAS (histórico): a mais recente vira o monthly_amount; TODAS entram
    // no ledger (backfill) com a data real — preenche recebido total/mês/ano/histórico.
    const inv = await stripeGet(env, '/invoices?customer=' + encodeURIComponent(cust) + '&status=paid&limit=24');
    const invoices = (inv.ok && inv.body && Array.isArray(inv.body.data)) ? inv.body.data : [];
    if (invoices[0]) amount = (invoices[0].amount_paid || 0) / 100;
    for (const f of invoices) {
      try {
        const r = await env.DB.prepare("INSERT OR IGNORE INTO payments (email, amount, currency, plan, type, event_id, created_at) VALUES (?,?,?,?,?,?,?)")
          .bind(u.email, (f.amount_paid || 0) / 100, (f.currency || 'usd').toUpperCase(), u.plan || null, 'invoice', f.id, f.created ? new Date(f.created * 1000).toISOString() : new Date().toISOString()).run();
        if (r && r.meta && r.meta.changes) backfilled += r.meta.changes;
      } catch (e) {}
    }
    // fallback: assinatura ativa → preço recorrente (se nunca teve fatura paga)
    if (amount == null) {
      const sub = await stripeGet(env, '/subscriptions?customer=' + encodeURIComponent(cust) + '&status=active&limit=1');
      const it = sub.ok && sub.body && sub.body.data && sub.body.data[0] && sub.body.data[0].items && sub.body.data[0].items.data && sub.body.data[0].items.data[0];
      if (it && it.price && it.price.unit_amount != null) amount = it.price.unit_amount / 100;
    }
    if (amount != null) {
      await env.DB.prepare("UPDATE users SET monthly_amount = ?, stripe_customer = COALESCE(stripe_customer, ?), is_courtesy = CASE WHEN ? > 0 THEN 0 ELSE is_courtesy END WHERE email = ?")
        .bind(amount, cust, amount, u.email).run();
      updated++; results.push({ email: u.email, ok: true, amount });
    } else {
      await env.DB.prepare("UPDATE users SET stripe_customer = COALESCE(stripe_customer, ?) WHERE email = ?").bind(cust, u.email).run();
      noAmount++; results.push({ email: u.email, ok: false, reason: 'no_invoice' });
    }
  }

  // REEMBOLSOS + CANCELAMENTOS + FALHAS (visão do negócio) → resumo no KV
  let refundsCount = 0, refundsAmount = 0, canceledCount = 0, failedCount = 0;
  try {
    const rf = await stripeGet(env, '/refunds?limit=100');
    if (rf.ok && rf.body && Array.isArray(rf.body.data)) { refundsCount = rf.body.data.length; refundsAmount = rf.body.data.reduce((s, x) => s + (x.amount || 0) / 100, 0); }
    const cc = await stripeGet(env, '/subscriptions?status=canceled&limit=100');
    if (cc.ok && cc.body && Array.isArray(cc.body.data)) canceledCount = cc.body.data.length;
    const uf = await stripeGet(env, '/invoices?status=uncollectible&limit=100');
    if (uf.ok && uf.body && Array.isArray(uf.body.data)) failedCount = uf.body.data.length;
    await env.SESSIONS.put('fin_summary', JSON.stringify({ refundsCount, refundsAmount: +refundsAmount.toFixed(2), canceledCount, failedCount, syncedAt: new Date().toISOString() }));
  } catch (e) {}

  logEvent({ evt: 'stripe_sync', by: email, checked, updated, noCustomer, noAmount, backfilled });
  return json({ ok: true, checked, updated, noCustomer, noAmount, backfilled, refundsCount, canceledCount });
}

/* ═══════════════ MANUTENÇÃO + ROBÔ (v32, tudo em KV — zero setup) ═══════════════
   Estado de manutenção e o próprio arquivo do robô ficam no KV (env.SESSIONS),
   que já está ligado. Nada de tabela nova nem R2. */

// lê o estado de manutenção e resolve se está ATIVA agora (manual OU dentro da janela agendada)
async function readMaintenance(env) {
  let m = null;
  try { const s = await env.SESSIONS.get('maintenance'); m = s ? JSON.parse(s) : null; } catch (e) { m = null; }
  const now = Date.now();
  let active = false, message = '', upcoming = null;
  if (m) {
    if (m.on) { active = true; message = m.message || ''; }
    if (m.startAt && m.endAt) {
      if (now >= m.startAt && now < m.endAt) { active = true; message = m.message || message; }
      else if (now < m.startAt) { upcoming = { startAt: m.startAt, endAt: m.endAt, message: m.message || '' }; }
    }
  }
  return { active, message, upcoming, startAt: (m && m.startAt) || null, endAt: (m && m.endAt) || null, on: !!(m && m.on) };
}
// GET /api/maintenance — status público (o painel usa pro banner)
async function handleMaintenanceGet(request, env, json) {
  const st = await readMaintenance(env);
  return json({ ok: true, active: st.active, message: st.message, upcoming: st.upcoming, startAt: st.startAt, endAt: st.endAt });
}
// POST /api/admin/maintenance  { action:'on'|'off'|'schedule'|'clear', message?, startAt?, endAt? }
async function handleMaintenanceSet(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  const b = await request.json();
  const action = b.action;
  let cur = {};
  try { const s = await env.SESSIONS.get('maintenance'); cur = s ? JSON.parse(s) : {}; } catch (e) { cur = {}; }
  if (action === 'on') { cur.on = true; cur.message = capStr(b.message, 500) || ''; }
  else if (action === 'off') { cur.on = false; }
  else if (action === 'clear') { cur = {}; }
  else if (action === 'schedule') {
    const s = parseInt(b.startAt, 10), e = parseInt(b.endAt, 10);
    if (!s || !e || e <= s) return json({ error: 'invalid_window' }, 400);
    cur.startAt = s; cur.endAt = e; cur.message = capStr(b.message, 500) || '';
  } else return json({ error: 'invalid_action' }, 400);
  await env.SESSIONS.put('maintenance', JSON.stringify(cur));
  logEvent({ evt: 'maintenance', by: email, action });
  const st = await readMaintenance(env);
  return json({ ok: true, active: st.active, message: st.message, upcoming: st.upcoming, startAt: st.startAt, endAt: st.endAt, on: st.on });
}

// bytes <-> base64 (o robô é binário; guardamos base64 no KV)
function b64ToBytes(b64) { const bin = atob(b64); const n = bin.length; const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i); return out; }
// POST /api/admin/robot  { base64, version, size, filename?, mandatory? }
async function handleRobotUpload(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  if (!me || me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  const b = await request.json();
  const b64 = String(b.base64 || '').replace(/^data:[^,]*,/, '');   // aceita data-URL ou base64 puro
  if (!b64) return json({ error: 'no_file' }, 400);
  if (b64.length > 6 * 1024 * 1024) return json({ error: 'too_large', message: 'Máx ~4MB' }, 413); // ~4MB binário
  const size = Math.round(b64.length * 3 / 4);
  const meta = { version: capStr(b.version, 40) || '1.0', size, filename: capStr(b.filename, 80) || 'BLACK_WOLF_CLIENTE.ex5', mandatory: !!b.mandatory, updatedAt: new Date().toISOString(), by: email };
  await env.SESSIONS.put('robot_ex5', b64);
  await env.SESSIONS.put('robot_meta', JSON.stringify(meta));
  logEvent({ evt: 'robot_upload', by: email, version: meta.version, size });
  return json({ ok: true, meta });
}
// GET /api/robot/meta — versão/tamanho/data (qualquer usuário logado)
async function handleRobotMeta(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  let meta = null;
  try { const s = await env.SESSIONS.get('robot_meta'); meta = s ? JSON.parse(s) : null; } catch (e) { meta = null; }
  return json({ ok: true, hasFile: !!meta, meta });
}
// GET /api/robot/download — baixa o .ex5 guardado (exige licença ativa; admin sempre)
async function handleRobotDownload(request, env, json, url) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const u = await env.DB.prepare('SELECT role, license_status, license_key, license_expires_at FROM users WHERE email = ?').bind(email).first();
  if (!u) return json({ error: 'unauthorized' }, 401);
  const isAdmin = u.role === 'admin';
  if (!isAdmin && !licenseState(u).active) return json({ error: 'license_inactive' }, 403);
  const b64 = await env.SESSIONS.get('robot_ex5');
  if (!b64) return json({ error: 'no_robot', hint: 'Nenhum robô enviado ainda.' }, 404);
  let meta = {}; try { meta = JSON.parse(await env.SESSIONS.get('robot_meta') || '{}'); } catch (e) {}
  const bytes = b64ToBytes(b64);
  return new Response(bytes, { status: 200, headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="' + (meta.filename || 'BLACK_WOLF_CLIENTE.ex5') + '"',
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Cache-Control': 'no-store'
  } });
}

/* ───────────────── CONFIG DO ROBÔ (gestão de risco) ─────────────────
   O ALUNO salva os parâmetros pelo painel (sessão autenticada). */
const EA_ALLOWED_KEYS = ['riskPerTrade','lotMode','fixedLot','maxLot','leverage','dailyTarget','dailyLoss','maxTrades','maxSimultaneous','equityStop','spreadFilter','timezone','newsPause','profile'];
// v22: faixas de validação por chave numérica (o servidor NUNCA confia no cliente)
const EA_NUM_RANGES = { riskPerTrade:[0,10], fixedLot:[0,100], maxLot:[0,100], dailyTarget:[0,100], dailyLoss:[0,100], maxTrades:[0,100], maxSimultaneous:[0,50], equityStop:[0,100], spreadFilter:[0,1000] };
// nomes EXATOS das sessões que o robô procura no sessionRisk (não mudar sem alinhar com o robô)
// v19: robô v1.2 tem 8 sessões no Operacional 1 (M5-09h, M5-15h30 e M1-18h são novas) + OP2
const SESSION_RISK_KEYS = ['M5-01h','M15-01h','M1-02h','M1-11h','M1-17h','M5-09h','M5-15h30','M1-18h','OP2'];
function sanitizeSessionRisk(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of SESSION_RISK_KEYS) {
      if (k in raw) {
        const v = Number(raw[k]);
        if (isFinite(v) && v >= 0 && v <= 10) out[k] = Math.round(v * 100) / 100;
      }
    }
  }
  return out;
}
function sanitizeConfig(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of EA_ALLOWED_KEYS) {
      if (!(k in raw)) continue;
      const rg = EA_NUM_RANGES[k];
      if (rg) {
        // campo numérico: valida tipo e faixa (bloqueia riskPerTrade:100 via API direta)
        const v = Number(raw[k]);
        if (Number.isFinite(v)) out[k] = Math.min(rg[1], Math.max(rg[0], v));
      } else {
        // v27: campos não-numéricos — valida tipo/enum/tamanho (antes gravava
        // qualquer coisa, inclusive um blob de MB → inflava o banco / DoS).
        const val = raw[k];
        if (k === 'newsPause') { out[k] = !!val; }
        else if (k === 'lotMode') { if (['percent','fixed'].includes(val)) out[k] = val; }
        else if (k === 'profile') { if (typeof val === 'string' && val.length <= 32) out[k] = val; }
        else if (typeof val === 'string') { out[k] = val.slice(0, 64); } // leverage/timezone
      }
    }
    if (raw.sessionRisk && typeof raw.sessionRisk === 'object') {
      const sr = sanitizeSessionRisk(raw.sessionRisk);
      if (Object.keys(sr).length) out.sessionRisk = sr;
    }
    // v26: liga/desliga por sessão POR CONTA (override parcial do padrão global)
    if (raw.sessionOn && typeof raw.sessionOn === 'object') {
      const so = sanitizeSessionOnPartial(raw.sessionOn);
      if (Object.keys(so).length) out.sessionOn = so;
    }
  }
  return out;
}
async function handleSaveConfig(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  let body; try { body = await request.json(); } catch(e){ return json({ error:'invalid_json' }, 400); }
  const cfg = sanitizeConfig(body && body.config ? body.config : body);
  const account = (body && body.account != null && String(body.account).trim() !== '') ? String(body.account).trim() : null;
  const now = new Date().toISOString();

  // Sócios (results_source) co-gerenciam a config do POOL: salva na conta-dona
  // (é a licença que o robô realmente usa). Os demais salvam na própria conta.
  const meRow = await env.DB.prepare('SELECT results_source, ea_config, ea_config_version FROM users WHERE email = ?').bind(email).first();
  const target = (meRow && meRow.results_source) ? meRow.results_source : email;

  // carrega a estrutura atual do ALVO (para preservar as configs das outras contas)
  const targetRow = (target === email)
    ? meRow
    : await env.DB.prepare('SELECT ea_config, ea_config_version FROM users WHERE email = ?').bind(target).first();
  const struct = normalizeEaConfig(targetRow ? targetRow.ea_config : null);
  const curVer = (targetRow && targetRow.ea_config_version) || 0;

  // v23: controle de concorrência otimista (opt-in). Se o painel enviar
  // base_version e ela não bater com a atual, alguém salvou no meio → 409.
  if (body && body.base_version != null && Number(body.base_version) !== curVer) {
    return json({ error: 'conflict', message: 'A configuração foi alterada em outro lugar. Recarregue e tente de novo.', current_version: curVer }, 409);
  }

  if (account) {
    struct.accounts = struct.accounts || {};
    struct.accounts[account] = { ...cfg, updated_at: now };
  } else {
    struct.default = { ...cfg, updated_at: now };
  }
  struct.updated_at = now;
  const newVer = curVer + 1;

  // v23: UPDATE condicional (WHERE version=cur) — se outra escrita entrou entre
  // o SELECT e aqui, changes=0 e devolvemos 409 (last-write não vence em silêncio).
  const res = await env.DB.prepare('UPDATE users SET ea_config = ?, ea_config_version = ? WHERE email = ? AND COALESCE(ea_config_version,0) = ?')
    .bind(JSON.stringify(struct), newVer, target, curVer).run();
  if (!res.meta || res.meta.changes === 0) {
    return json({ error: 'conflict', message: 'Salvamento concorrente detectado. Recarregue e tente de novo.', current_version: curVer }, 409);
  }
  try {
    await env.DB.prepare('INSERT INTO config_log (email, target, account, config_json, created_at) VALUES (?,?,?,?,?)')
      .bind(email, target, account || '_default', JSON.stringify(cfg), now).run();
  } catch (e) { logEvent({ evt:'config_log_fail', target }); }
  return json({ ok: true, account: account || null, config: cfg, ea_config: struct, config_version: newVer });
}

/* ─────────────── AUTENTICAÇÃO DO ROBÔ (token simples) ───────────────
   A própria CHAVE DE LICENÇA funciona como credencial (token), enviada por HTTPS.
   Aceita em: Authorization: Bearer <licença>  |  cabeçalho X-License  |  ?license=
   HMAC é OPCIONAL: só é exigido se um X-Signature/sig for enviado (defesa extra,
   ativável no futuro sem mexer no servidor). */
function getEaLicense(request, url) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return (url.searchParams.get('license') || request.headers.get('X-License') || bearer || '').trim();
}
async function eaSignatureOk(request, env, url, license) {
  const sig = url.searchParams.get('sig') || request.headers.get('X-Signature') || '';
  if (!sig) return true;                 // modo token simples (sem assinatura)
  if (!env.EA_SHARED_SECRET) return true; // sem segredo configurado, não dá pra verificar
  const ts = url.searchParams.get('ts') || request.headers.get('X-Timestamp') || '';
  const t = parseInt(ts, 10);
  if (!t || Math.abs(Math.floor(Date.now()/1000) - t) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.EA_SHARED_SECRET), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(license + ':' + ts));
  return safeEqual(bufToHex(mac), String(sig).toLowerCase());
}
function num(v){ const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }
function intOrNull(v){ const n = parseInt(v,10); return Number.isFinite(n) ? n : null; }

/* ─── TRAVA DE CÓPIA: 1 licença = 1 conta MT5 ───
   O robô envia o número da conta (AccountInfoInteger(ACCOUNT_LOGIN)) em toda chamada.
   - Se a licença ainda não tem conta amarrada → amarra a primeira que aparecer.
   - Se já tem conta amarrada e vier OUTRA conta → rejeita (a mesma chave não roda em
     duas contas). Trocar de conta só pelo painel do aluno (POST /api/mt5-account) ou
     pelo admin (limpando o campo). Isso impede revenda/multi-conta da mesma licença. */
function getEaAccount(request, url, body){
  let a = url.searchParams.get('account') || request.headers.get('X-Account') ||
          (body && body.account != null ? body.account : null);
  if (a == null) return null;
  const s = String(a).trim();
  // conta MT5 (ACCOUNT_LOGIN) é SEMPRE um inteiro. Aceitar só dígitos fecha o vetor
  // de XSS armazenado: um robô adulterado poderia mandar um "número" com aspas/HTML
  // que seria ecoado no painel do admin. Não-numérico → tratado como sem conta.
  return /^\d{1,20}$/.test(s) ? s : null;
}
// v23: vínculo ATÔMICO via tabela license_accounts (PK license_key+account).
// O INSERT condicional deixa o SQLite arbitrar o limite — sem corrida entre
// robôs simultâneos. users.mt5_accounts é mantido como espelho (só p/ o painel).
async function bindOrCheckAccount(env, row, account){
  if(!account) return { mismatch:false, bound: row.mt5_account || null };
  const acc = String(account);
  const lic = row.license_key;
  if(!lic) return { mismatch:false, bound: acc }; // sem licença amarrável (não deveria ocorrer nas rotas EA)
  const limit = (row.account_limit === -1) ? 1000000
              : ((row.account_limit && row.account_limit > 1) ? row.account_limit : 1);
  const now = new Date().toISOString();
  // INSERT atômico: entra se JÁ pertence (idempotente) OU se há vaga. ON CONFLICT
  // evita erro em corrida; a cláusula WHERE garante o teto sem ler-antes-de-escrever.
  await env.DB.prepare(
    `INSERT INTO license_accounts (license_key, account, email, bound_at)
     SELECT ?1, ?2, ?3, ?4
     WHERE EXISTS (SELECT 1 FROM license_accounts WHERE license_key=?1 AND account=?2)
        OR (SELECT COUNT(*) FROM license_accounts WHERE license_key=?1) < ?5
     ON CONFLICT(license_key, account) DO NOTHING`
  ).bind(lic, acc, row.email || null, now, limit).run();
  // agora consulta o veredito real (pós-escrita atômica)
  const bound = await env.DB.prepare('SELECT 1 FROM license_accounts WHERE license_key=? AND account=?').bind(lic, acc).first();
  if(!bound){
    // não coube (limite atingido) → mismatch; devolve a 1ª conta amarrada como referência
    const first = await env.DB.prepare('SELECT account FROM license_accounts WHERE license_key=? ORDER BY bound_at LIMIT 1').bind(lic).first();
    return { mismatch:true, bound: (first && first.account) || row.mt5_account || null };
  }
  // sincroniza o espelho users.mt5_accounts / mt5_account (display only; não é a fonte da trava)
  try{
    const rows = await env.DB.prepare('SELECT account FROM license_accounts WHERE license_key=? ORDER BY bound_at').bind(lic).all();
    const list = (rows.results||[]).map(r=>String(r.account));
    await env.DB.prepare('UPDATE users SET mt5_accounts = ?, mt5_account = COALESCE(mt5_account, ?) WHERE email = ?')
      .bind(JSON.stringify(list), acc, row.email).run();
  }catch(e){ logEvent({ evt:'mirror_sync_fail', lic: lic.slice(-6) }); }
  return { mismatch:false, bound: acc };
}

/* Marca "robô visto/online" (conta + horário) já na checagem de licença (GET),
   sem esperar o heartbeat de saldo. NÃO sobrescreve saldo/equity/posições — só
   cria a linha se ainda não existir e atualiza conta + last_seen. Assim, no
   instante em que o robô conecta, o painel já mostra "online" e a conta certa. */
async function touchEaSeen(env, license, email, account) {
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO ea_status (license_key, email, account, last_seen)
       VALUES (?,?,?,?)
       ON CONFLICT(license_key) DO UPDATE SET
         account = COALESCE(excluded.account, ea_status.account),
         email   = COALESCE(ea_status.email, excluded.email),
         last_seen = excluded.last_seen`
    ).bind(license, email || null, account != null ? String(account) : null, now).run();
    // v21: presença POR CONTA (multi-conta na mesma licença não se sobrescreve)
    if (account != null && String(account).trim() !== '') {
      await env.DB.prepare(
        `INSERT INTO ea_status_acc (license_key, account, email, last_seen)
         VALUES (?,?,?,?)
         ON CONFLICT(license_key, account) DO UPDATE SET
           email = COALESCE(ea_status_acc.email, excluded.email),
           last_seen = excluded.last_seen`
      ).bind(license, String(account), email || null, now).run();
    }
  } catch (e) { /* nunca quebra a resposta ao robô por causa do heartbeat */ }
}
// v21: registra um erro de comunicação do robô (visível no diagnóstico)
async function recordEaError(env, license, email, account, err) {
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO ea_status (license_key, email, last_seen, last_error) VALUES (?,?,?,?)
       ON CONFLICT(license_key) DO UPDATE SET last_seen=excluded.last_seen, last_error=excluded.last_error`
    ).bind(license, email || null, now, err).run();
    if (account != null && String(account).trim() !== '') {
      await env.DB.prepare(
        `INSERT INTO ea_status_acc (license_key, account, email, last_seen, last_error) VALUES (?,?,?,?,?)
         ON CONFLICT(license_key, account) DO UPDATE SET last_seen=excluded.last_seen, last_error=excluded.last_error`
      ).bind(license, String(account), email || null, now, err).run();
    }
  } catch (e) {}
}

/* O ROBÔ lê a configuração de risco do aluno.
   GET /api/ea/config   (Authorization: Bearer <licença>  ou  ?license=<licença>) */
async function handleEaConfig(request, env, json, url) {
  const license = getEaLicense(request, url);
  if (!license) return json({ error: 'missing_license' }, 401);
  if (!(await eaSignatureOk(request, env, url, license))) return json({ error: 'bad_signature' }, 403);
  const row = await env.DB.prepare('SELECT email, role, ea_config, plan, license_key, license_status, license_expires_at, mt5_account, account_limit, mt5_accounts FROM users WHERE license_key = ?').bind(license).first();
  if (!row) return json({ error: 'license_not_found', active: false }, 404);
  // v23: verifica status E EXPIRAÇÃO (licença vencida parava? nunca — agora sim)
  const ls = licenseState(row);
  if (!ls.active) { await recordEaError(env, license, row.email, getEaAccount(request, url, null), 'license_' + ls.status); return json({ error: 'license_' + ls.status, active: false, status: ls.status }, 403); }
  // v32: MODO MANUTENÇÃO (global/agendado) — pausa TODOS os robôs sem mexer em licença.
  // O robô só lê active/plan: devolvemos active:false e ele para de abrir ordens; volta
  // sozinho quando a manutenção acaba (o robô relê a config a cada ciclo).
  const maint = await readMaintenance(env);
  if (maint.active) { return json({ ok: true, active: false, status: 'maintenance', maintenance: true, message: maint.message || '' }); }
  // trava: 1 licença = 1 conta
  const account = getEaAccount(request, url, null);
  const acc = await bindOrCheckAccount(env, row, account);
  if (acc.mismatch) {
    await recordEaError(env, license, row.email, account, 'account_mismatch');
    return json({ error: 'account_mismatch', active: false, message: 'Licença já vinculada a outra conta MT5' }, 403);
  }
  await touchEaSeen(env, license, row.email, acc.bound || account);   // marca robô online já na checagem
  // config específica DESTA conta (o robô manda a conta em toda chamada)
  const struct = normalizeEaConfig(row.ea_config);
  const cfg = effectiveConfig(struct, acc.bound || account, {});
  const config = {
    profile: cfg.profile ?? null,
    riskPerTrade: cfg.riskPerTrade ?? 1.0,
    lotMode: cfg.lotMode ?? 'percent',
    fixedLot: cfg.fixedLot ?? 0.1,
    maxLot: cfg.maxLot ?? 0.5,
    leverage: cfg.leverage ?? '1:100',
    dailyTarget: cfg.dailyTarget ?? 0,
    dailyLoss: cfg.dailyLoss ?? 0,
    maxTrades: cfg.maxTrades ?? 0,
    maxSimultaneous: cfg.maxSimultaneous ?? 1,
    equityStop: cfg.equityStop ?? 0,
    spreadFilter: cfg.spreadFilter ?? null,
    timezone: cfg.timezone ?? null,
    newsPause: cfg.newsPause ?? true,
  };
  // risco POR SESSÃO (o robô usa cada valor na sua sessão; se faltar, cai no riskPerTrade)
  if (cfg.sessionRisk && typeof cfg.sessionRisk === 'object' && Object.keys(cfg.sessionRisk).length)
    config.sessionRisk = cfg.sessionRisk;
  // v18: PERFIS GLOBAIS — se o aluno está em um dos 3 padrões (não 'custom'),
  // usa os valores ATUAIS definidos pelo admin (mudou o padrão → muda para todos)
  // v21: SÓ para alunos (role=client) — a conta do admin NUNCA é sobrescrita por perfil
  if (row.role === 'client' && config.profile && RISK_PROFILE_NAMES.includes(String(config.profile))) {
    const profs = await getRiskProfiles(env);
    const p = profs[String(config.profile)];
    if (p) {
      const sr = {};
      for (const k of SESSION_RISK_KEYS) if (p[k] != null) sr[k] = p[k];
      if (Object.keys(sr).length) config.sessionRisk = sr;
      if (p._risk != null) config.riskPerTrade = p._risk;
    }
  }
  // v19: LIGA/DESLIGA POR SESSÃO (robô v1.2) — sempre manda as 8 chaves "on_"
  // explícitas (contrato: chave ausente = robô mantém o estado atual; explícito
  // é determinístico).
  // v26 (decisão do Luiz — item 6): o padrão é GLOBAL (admin), mas cada CONTA
  // pode ter o seu próprio liga/desliga (contas de teste do sócio operam sessões
  // diferentes das de produção). Override por conta vence; chave sem override
  // herda o padrão global.
  const so = await getSessionOn(env);
  const accOn = (cfg.sessionOn && typeof cfg.sessionOn === 'object') ? cfg.sessionOn : {};
  const sessionOn = {};
  for (const k of SESSION_ON_KEYS) sessionOn['on_' + k] = (k in accOn) ? !!accOn[k] : !!so[k];
  config.sessionOn = sessionOn;
  // v23: config_version (ETag) — hash estável do config efetivo; o robô pode
  // mandar ?since=<v> e receber {changed:false} se nada mudou (economiza e é determinístico)
  const cv = cfgHash(config);
  const since = url.searchParams.get('since');
  logEvent({ evt:'ea_config', lic: license.slice(-6), acc: acc.bound || account, cv });
  if (since && since === cv) return json({ ok: true, active: true, changed: false, config_version: cv, account: acc.bound || null });
  return json({ ok: true, active: true, changed: true, config_version: cv, license, plan: row.plan || null, account: acc.bound || null, config, updated_at: cfg.updated_at || null });
}
// hash curto e estável de um objeto (djb2 sobre JSON com chaves ordenadas)
function cfgHash(obj){
  const norm = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 5381; for (let i=0;i<norm.length;i++) h = ((h*33) ^ norm.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* Teste leve de conectividade + validade da licença (útil para o dev testar).
   GET /api/ea/ping   (mesma autenticação) */
async function handleEaPing(request, env, json, url) {
  const license = getEaLicense(request, url);
  if (!license) return json({ ok:false, error: 'missing_license' }, 401);
  const row = await env.DB.prepare('SELECT email, plan, license_key, license_status, license_expires_at, mt5_account, account_limit, mt5_accounts FROM users WHERE license_key = ?').bind(license).first();
  if (!row) return json({ ok:false, active:false, error:'license_not_found' }, 404);
  const lp = licenseState(row);
  if (!lp.active) return json({ ok:true, active:false, status: lp.status }, 403);
  // trava: 1 licença = 1 conta
  const account = getEaAccount(request, url, null);
  const acc = await bindOrCheckAccount(env, row, account);
  if (acc.mismatch) return json({ ok:true, active:false, error:'account_mismatch', message:'Licença já vinculada a outra conta MT5' }, 403);
  await touchEaSeen(env, license, row.email, acc.bound || account);   // marca robô online já no ping
  return json({ ok:true, active:true, plan: row.plan || null, account: acc.bound || null, status: 'active' });
}

/* O ROBÔ envia os trades fechados + saldo/equity.
   POST /api/ea/trades   (mesma autenticação)
   Corpo: { account, balance, equity, open_positions, ea_version, trades:[ {ticket,symbol,type,lots,openTime,closeTime,openPrice,closePrice,profit,commission,swap} ] } */
async function handleEaTrades(request, env, json, url) {
  const license = getEaLicense(request, url);
  if (!license) return json({ error: 'missing_license' }, 401);
  if (!(await eaSignatureOk(request, env, url, license))) return json({ error: 'bad_signature' }, 403);
  const row = await env.DB.prepare('SELECT email, mt5_account, license_key, license_status, license_expires_at, account_limit, mt5_accounts FROM users WHERE license_key = ?').bind(license).first();
  if (!row) return json({ error: 'license_not_found', active:false }, 404);
  // v27 (P0-A): NÃO rejeitar aqui se a licença estiver vencida/revogada. O POST de
  // trades é o CANAL DE DADOS, não a permissão de operar. Rejeitar perderia PARA
  // SEMPRE os trades que o robô ainda está fechando (buraco no histórico + falso
  // depósito no relatório). Gravamos o histórico e devolvemos active:false — o robô
  // deve parar de ABRIR trades novos, mas continuar reportando até receber o ACK.
  const lt = licenseState(row);
  const licenseActive = lt.active;

  let body; try { body = await request.json(); } catch(e){
    await recordEaError(env, license, row.email, getEaAccount(request, url, null), 'invalid_json');
    return json({ error:'invalid_json' }, 400);
  }
  const account = getEaAccount(request, url, body);
  const hasAccount = account != null && String(account).trim() !== '';
  const now = new Date().toISOString();

  // trava ANTI-REVENDA: 1 licença = 1 conta. Mismatch continua rejeitando (é a
  // fronteira de autorização; o robô legítimo da conta vinculada segue normal).
  const acc = await bindOrCheckAccount(env, row, account);
  if (acc.mismatch) {
    await recordEaError(env, license, row.email, account, 'account_mismatch');
    return json({ error:'account_mismatch', active:false, message:'Licença já vinculada a outra conta MT5' }, 403);
  }

  // v23: monta TUDO como um único env.DB.batch (atômico: ou grava tudo, ou nada).
  // COALESCE preserva o último saldo bom se o heartbeat vier parcial/nulo.
  const bal = num(body.balance), eq = num(body.equity), op = intOrNull(body.open_positions), ver = body.ea_version ?? null;
  const stmts = [
    env.DB.prepare(
      `INSERT INTO ea_status (license_key, email, account, balance, equity, open_positions, ea_version, last_seen, last_error)
       VALUES (?,?,?,?,?,?,?,?,NULL)
       ON CONFLICT(license_key) DO UPDATE SET account=excluded.account,
         balance=COALESCE(excluded.balance, ea_status.balance),
         equity=COALESCE(excluded.equity, ea_status.equity),
         open_positions=COALESCE(excluded.open_positions, ea_status.open_positions),
         ea_version=COALESCE(excluded.ea_version, ea_status.ea_version),
         last_seen=excluded.last_seen, last_error=NULL`
    ).bind(license, row.email, account, bal, eq, op, ver, now)
  ];
  if (account != null && String(account).trim() !== '') {
    stmts.push(env.DB.prepare(
      `INSERT INTO ea_status_acc (license_key, account, email, balance, equity, open_positions, ea_version, last_seen, last_error)
       VALUES (?,?,?,?,?,?,?,?,NULL)
       ON CONFLICT(license_key, account) DO UPDATE SET email=excluded.email,
         balance=COALESCE(excluded.balance, ea_status_acc.balance),
         equity=COALESCE(excluded.equity, ea_status_acc.equity),
         open_positions=COALESCE(excluded.open_positions, ea_status_acc.open_positions),
         ea_version=COALESCE(excluded.ea_version, ea_status_acc.ea_version),
         last_seen=excluded.last_seen, last_error=NULL`
    ).bind(license, String(account), row.email, bal, eq, op, ver, now));
    // série temporal de saldo (1 ponto por heartbeat) — base p/ relatório de evolução
    if (bal != null || eq != null)
      stmts.push(env.DB.prepare('INSERT INTO balance_history (license_key, account, email, balance, equity, ts) VALUES (?,?,?,?,?,?)')
        .bind(license, String(account), row.email, bal, eq, now));
  }
  // trades fechados — dedupe por (licença, CONTA, ticket)
  const persisted = [];
  // v29: teto DURO no array cru ANTES de ordenar — uma licença válida não pode
  // mandar um array gigante e gastar CPU/memória do worker (o robô pagina de 500).
  let tradesArr = Array.isArray(body.trades) ? body.trades.slice(0, 2000).filter(t => t && t.ticket != null) : [];
  const totalTrades = tradesArr.length;
  // v27 (P0-B): NUNCA gravar trade sem CONTA. No SQLite, NULL é distinto no índice
  // UNIQUE, então trade sem conta furaria o dedup e DUPLICARIA a cada reenvio
  // (lucro dobrado no relatório). Sem conta: não grava e não dá ACK → o robô
  // reenvia quando incluir a conta. Fica registrado em last_error p/ o admin ver.
  let missingAccount = false;
  if (totalTrades && !hasAccount) {
    missingAccount = true;
    tradesArr = [];
    await recordEaError(env, license, row.email, account, 'missing_account');
  }
  // v27 (H1): ordena mais ANTIGO primeiro; se truncar em 500, os descartados são os
  // mais NOVOS (que o robô ainda tem na fila) — nunca perde o começo do backlog.
  tradesArr.sort((a, b) => {
    const ka = String(a.closeTime ?? a.close_time ?? ''), kb = String(b.closeTime ?? b.close_time ?? '');
    if (!ka && !kb) return 0; if (!ka) return 1; if (!kb) return -1;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const capped = tradesArr.slice(0, 500); // teto por POST; o robô pagina backlog maior
  const remaining = Math.max(0, tradesArr.length - capped.length);
  for (const tr of capped) {
    const ticket = String(tr.ticket);
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO trades (license_key,email,account,ticket,symbol,type,lots,open_time,close_time,open_price,close_price,profit,commission,swap,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(license, row.email, String(account), ticket, tr.symbol??null, tr.type??null, num(tr.lots),
           tr.openTime??tr.open_time??null, tr.closeTime??tr.close_time??null,
           num(tr.openPrice??tr.open_price), num(tr.closePrice??tr.close_price),
           num(tr.profit), num(tr.commission), num(tr.swap), now));
    persisted.push(ticket);
  }
  try {
    await env.DB.batch(stmts);   // ATÔMICO — tudo ou nada
  } catch (e) {
    // falha do banco: NÃO confirma nada; o robô mantém a fila e reenvia (idempotente)
    await recordEaError(env, license, row.email, account, 'db_batch_fail');
    logEvent({ evt:'ea_trades_fail', lic: license.slice(-6), acc: account, n: capped.length, err: String(e && e.message || e) });
    return json({ error:'server_busy', active: licenseActive, persisted: [], retry: true }, 503);
  }
  logEvent({ evt:'ea_trades', lic: license.slice(-6), acc: account, persisted: persisted.length, remaining, active: licenseActive, missing_account: missingAccount });
  // ACK: o robô só remove da fila os tickets que voltarem em "persisted".
  // active:false = licença vencida/revogada → robô para de ABRIR, mas segue reportando.
  const resp = { ok: true, active: licenseActive, status: lt.status, received: persisted.length, persisted, account: acc.bound || null, truncated: remaining > 0, remaining };
  if (missingAccount) resp.warning = 'missing_account';
  return json(resp);
}

/* ─────────────── RELATÓRIOS (v23) ───────────────
   GET /api/reports?period=week|month&from=YYYY-MM-DD&to=YYYY-MM-DD&account=
   REGRA CRÍTICA (spec do Luiz): resultado = SOMA de trades (profit+commission+
   swap), NUNCA diferença de saldo. Saldo inicial/final é só informação; se a
   variação de saldo não bate com a soma dos trades, a diferença é depósito/saque. */
async function handleReports(request, env, json, url) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const u = await env.DB.prepare('SELECT results_source, role FROM users WHERE email = ?').bind(email).first();
  const target = (u && u.results_source) ? u.results_source : email;
  const period = url.searchParams.get('period') || 'month';
  const account = url.searchParams.get('account');
  // janela de datas: usa from/to se vier; senão período corrente.
  // v29: usa o horário do SERVIDOR da corretora (+EA_SERVER_OFFSET_MIN), igual ao
  // /api/admin/results e ao close_time dos trades. Antes usava UTC puro → na virada
  // de dia/mês o cliente e o admin viam números diferentes e trades da borda sumiam.
  const now = new Date(Date.now() + EA_SERVER_OFFSET_MIN * 60000);
  let from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!from || !to) {
    const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate(), wd = now.getUTCDay();
    if (period === 'week') {
      const monday = new Date(Date.UTC(y, m, d - ((wd + 6) % 7)));
      from = monday.toISOString().slice(0, 10);
      to = new Date(Date.UTC(y, m, d + 1)).toISOString().slice(0, 10);
    } else {
      from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      to = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
    }
  }
  // v27 (P0-E): AGREGA NO SQL (SUM/COUNT/MAX/MIN), SEM teto. Antes puxava as linhas
  // e somava em JS com LIMIT 5000, o que TRUNCAVA silenciosamente e mostrava total
  // ERRADO (a menos) numa conta muito ativa. Agora soma tudo. close_time do MT5 é
  // "YYYY.MM.DD ..."; comparamos pelo prefixo de data normalizado.
  const fromN = from.replace(/-/g, '.'), toN = to.replace(/-/g, '.');
  const NET = '(COALESCE(profit,0)+COALESCE(commission,0)+COALESCE(swap,0))';
  let where = `email = ? AND replace(substr(close_time,1,10),'-','.') >= ? AND replace(substr(close_time,1,10),'-','.') < ?`;
  const binds = [target, fromN, toN];
  if (account) { where += ' AND account = ?'; binds.push(String(account)); }
  const agg = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(${NET}),0) AS gross,
            SUM(CASE WHEN ${NET} > 0 THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN ${NET} < 0 THEN 1 ELSE 0 END) AS losses,
            MAX(${NET}) AS best, MIN(${NET}) AS worst
     FROM trades WHERE ${where}`
  ).bind(...binds).first();
  const n = agg && agg.n ? +agg.n : 0;
  const gross = agg ? (+agg.gross || 0) : 0;
  const wins = agg && agg.wins ? +agg.wins : 0;
  const losses = agg && agg.losses ? +agg.losses : 0;
  const best = (n && agg.best != null) ? +agg.best : null;
  const worst = (n && agg.worst != null) ? +agg.worst : null;
  // curva de evolução: soma de trades por dia no SQL (nunca saldo), acumulada
  const dayRows = await env.DB.prepare(
    `SELECT substr(close_time,1,10) AS d, SUM(${NET}) AS pnl
     FROM trades WHERE ${where} GROUP BY d ORDER BY d ASC`
  ).bind(...binds).all();
  let cum = 0;
  const curve = (dayRows.results || []).map(r => {
    const day = String(r.d || '').replace(/\./g, '-');
    const pnl = +(+r.pnl || 0).toFixed(2);
    cum += pnl;
    return { day, pnl, cumulative: +cum.toFixed(2) };
  });

  // v24: saldo INÍCIO/FIM do período via balance_history (informativo). O % é
  // sobre o saldo INICIAL (regra do Luiz), NUNCA por diferença de saldo.
  let startBalance = null, endBalance = null, deposits = null;
  try {
    let bsql = "SELECT balance, ts FROM balance_history WHERE email = ? AND substr(ts,1,10) >= ? AND substr(ts,1,10) < ?";
    const bb = [target, from, to];
    if (account) { bsql += ' AND account = ?'; bb.push(String(account)); }
    bsql += ' ORDER BY ts ASC';
    const bh = await env.DB.prepare(bsql).bind(...bb).all();
    const brows = (bh.results || []).filter(r => r.balance != null);
    if (brows.length) {
      // com uma conta: primeiro/último direto. Com várias (geral): soma por conta
      if (account) { startBalance = +brows[0].balance; endBalance = +brows[brows.length - 1].balance; }
      else {
        // agrega por conta o primeiro e o último ponto de cada uma
        const firstByAcc = {}, lastByAcc = {};
        const bh2 = await env.DB.prepare("SELECT account, balance, ts FROM balance_history WHERE email = ? AND substr(ts,1,10) >= ? AND substr(ts,1,10) < ? AND balance IS NOT NULL ORDER BY ts ASC").bind(target, from, to).all();
        (bh2.results || []).forEach(r => { const a = String(r.account); if (!(a in firstByAcc)) firstByAcc[a] = +r.balance; lastByAcc[a] = +r.balance; });
        startBalance = Object.values(firstByAcc).reduce((s, v) => s + v, 0);
        endBalance = Object.values(lastByAcc).reduce((s, v) => s + v, 0);
      }
      startBalance = +startBalance.toFixed(2); endBalance = +endBalance.toFixed(2);
      // discrepância entre variação de saldo e soma de trades = depósito/saque
      const drift = endBalance - startBalance - gross;
      deposits = Math.abs(drift) > 0.5 ? +drift.toFixed(2) : 0;
    }
  } catch (e) { logEvent({ evt: 'reports_balance_fail', target }); }
  const resultPct = (startBalance && startBalance > 0) ? +(gross / startBalance * 100).toFixed(2) : null;

  return json({
    ok: true, period, from, to, account: account || null, shared: !!(u && u.results_source),
    summary: {
      result: +gross.toFixed(2), resultPct, trades: n, wins, losses,
      winRate: n ? +(wins / n * 100).toFixed(2) : 0,
      best: best != null ? +best.toFixed(2) : 0,
      worst: worst != null ? +worst.toFixed(2) : 0,
      startBalance, endBalance, deposits,
    },
    curve,
  });
}

/* ─────────────── ADMIN: revogar/reativar licença (v23) ───────────────
   POST /api/admin/license  { email, action:'revoke'|'reactivate', reason? } */
async function handleAdminLicense(request, env, json) {
  const me = await getSessionEmail(request, env);
  if (!me) return json({ error: 'unauthorized' }, 401);
  const admin = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(me).first();
  if (!admin || admin.role !== 'admin') return json({ error: 'forbidden' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }
  const target = String(b.email || '').trim().toLowerCase();
  const action = b.action;
  if (!target || (action !== 'revoke' && action !== 'reactivate')) return json({ error: 'bad_request' }, 400);
  const row = await env.DB.prepare('SELECT license_status FROM users WHERE email = ?').bind(target).first();
  if (!row) return json({ error: 'not_found' }, 404);
  const to = action === 'revoke' ? 'revoked' : 'active';
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET license_status = ? WHERE email = ?').bind(to, target),
    env.DB.prepare('INSERT INTO license_events (email, actor, from_status, to_status, reason, created_at) VALUES (?,?,?,?,?,?)')
      .bind(target, me, row.license_status || null, to, b.reason || null, now),
  ]);
  logEvent({ evt: 'admin_license', actor: me, target, to });
  return json({ ok: true, email: target, license_status: to });
}

/* ─────────────── ADMIN: gerenciar contas MT5 da licença (v23) ───────────────
   POST /api/admin/mt5-account  { email, account, op:'remove'|'clear'|'set' }
   Permite desamarrar uma conta revendida/errada (a trava não fica presa). */
async function handleAdminMt5(request, env, json) {
  const me = await getSessionEmail(request, env);
  if (!me) return json({ error: 'unauthorized' }, 401);
  const admin = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(me).first();
  if (!admin || admin.role !== 'admin') return json({ error: 'forbidden' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'invalid_json' }, 400); }
  const target = String(b.email || '').trim().toLowerCase();
  const op = b.op || 'remove';
  const account = b.account != null ? String(b.account).trim() : '';
  const row = await env.DB.prepare('SELECT license_key FROM users WHERE email = ?').bind(target).first();
  if (!row || !row.license_key) return json({ error: 'not_found' }, 404);
  const lic = row.license_key;
  const stmts = [];
  if (op === 'clear') {
    stmts.push(env.DB.prepare('DELETE FROM license_accounts WHERE license_key = ?').bind(lic));
    stmts.push(env.DB.prepare('DELETE FROM ea_status_acc WHERE license_key = ?').bind(lic));
    stmts.push(env.DB.prepare("UPDATE users SET mt5_accounts = '[]', mt5_account = NULL WHERE email = ?").bind(target));
  } else if (op === 'remove' && account) {
    stmts.push(env.DB.prepare('DELETE FROM license_accounts WHERE license_key = ? AND account = ?').bind(lic, account));
    stmts.push(env.DB.prepare('DELETE FROM ea_status_acc WHERE license_key = ? AND account = ?').bind(lic, account));
  } else if (op === 'set' && account) {
    stmts.push(env.DB.prepare('DELETE FROM license_accounts WHERE license_key = ?').bind(lic));
    stmts.push(env.DB.prepare('DELETE FROM ea_status_acc WHERE license_key = ?').bind(lic));
    stmts.push(env.DB.prepare('INSERT INTO license_accounts (license_key, account, email, bound_at) VALUES (?,?,?,?)').bind(lic, account, target, new Date().toISOString()));
  } else {
    return json({ error: 'bad_request' }, 400);
  }
  await env.DB.batch(stmts);
  // ressincroniza o espelho users.mt5_accounts
  const rows = await env.DB.prepare('SELECT account FROM license_accounts WHERE license_key = ? ORDER BY bound_at').bind(lic).all();
  const list = (rows.results || []).map(r => String(r.account));
  await env.DB.prepare('UPDATE users SET mt5_accounts = ?, mt5_account = ? WHERE email = ?')
    .bind(JSON.stringify(list), list[0] || null, target).run();
  logEvent({ evt: 'admin_mt5', actor: me, target, op, account });
  return json({ ok: true, email: target, mt5_accounts: list });
}

/* O PAINEL do aluno busca os trades + status do robô (sessão autenticada).
   GET /api/my-data → { status:{...}, trades:[...] } */
async function handleMyData(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  // Sócios compartilham um pool de resultados: se o usuário tem results_source,
  // ele vê os resultados dessa conta (as contas da sociedade). Senão, vê os próprios.
  const u = await env.DB.prepare('SELECT results_source FROM users WHERE email = ?')
    .bind(email).first();
  const target = (u && u.results_source) ? u.results_source : email;
  // v21: status POR CONTA (todas as contas do alvo), mais recente primeiro
  let statuses = [];
  try {
    const st = await env.DB.prepare(
      'SELECT account, balance, equity, open_positions, ea_version, last_seen, last_error FROM ea_status_acc WHERE email = ? ORDER BY last_seen DESC'
    ).bind(target).all();
    statuses = st.results || [];
  } catch (e) { statuses = []; }
  const status = statuses.length ? statuses[0] : await env.DB.prepare(
    'SELECT account, balance, equity, open_positions, ea_version, last_seen FROM ea_status WHERE email = ?'
  ).bind(target).first();
  const tr = await env.DB.prepare(
    `SELECT ticket, symbol, type, lots, open_time, close_time, open_price, close_price,
            profit, commission, swap, created_at, account
     FROM trades WHERE email = ? ORDER BY id DESC LIMIT 1000`
  ).bind(target).all();
  // v22: DESC pega os 1000 MAIS RECENTES; o painel reordena por data ao exibir.
  // (antes: ASC congelava o painel nos 1000 trades mais antigos)
  return json({ status: status || null, statuses, trades: (tr.results || []).reverse(), shared: !!(u && u.results_source) });
}

/* O ALUNO informa/confirma o número da conta MT5 pelo painel (sessão autenticada).
   POST /api/mt5-account  { account }
   - Plano de 1 conta: TROCA a conta (comportamento antigo preservado).
   - Plano multi-conta (2/3/ilimitado): ADICIONA à lista, respeitando o limite. */
async function handleMt5Account(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  let body; try { body = await request.json(); } catch(e){ return json({ error:'invalid_json' }, 400); }
  const accountRaw = body.account != null ? String(body.account).trim() : '';
  // conta MT5 é sempre numérica — valida (mesma regra do getEaAccount)
  if (!/^\d{1,20}$/.test(accountRaw)) return json({ error:'invalid_account' }, 400);
  const account = accountRaw;

  const row = await env.DB.prepare('SELECT account_limit, mt5_account, mt5_accounts, license_key FROM users WHERE email = ?').bind(email).first();
  const limit = row && row.account_limit === -1 ? -1
              : (row && row.account_limit && row.account_limit > 1 ? row.account_limit : 1);
  const lic = row && row.license_key ? row.license_key : null;
  let list = [];
  try { list = row && row.mt5_accounts ? JSON.parse(row.mt5_accounts) : []; } catch(e){ list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.map(a => String(a)).filter(a => a && a.trim() !== '');

  // Plano de 1 conta → troca (substitui a única conta)
  if (limit === 1) {
    // v29 (bug de trava): a trava real é a tabela license_accounts. Trocar só o
    // espelho (mt5_accounts) deixava a conta ANTIGA amarrada → o robô da conta NOVA
    // levava account_mismatch e o aluno ficava travado até um admin limpar. Agora a
    // troca solta o vínculo antigo (e o status) para o novo robô reamarrar sozinho.
    if (lic) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM license_accounts WHERE license_key = ?').bind(lic),
        env.DB.prepare('DELETE FROM ea_status_acc WHERE license_key = ?').bind(lic),
        env.DB.prepare('INSERT INTO license_accounts (license_key, account, email, bound_at) VALUES (?,?,?,?)').bind(lic, account, email, new Date().toISOString()),
      ]);
    }
    await env.DB.prepare('UPDATE users SET mt5_account = ?, mt5_accounts = ? WHERE email = ?')
      .bind(account, JSON.stringify([account]), email).run();
    return json({ ok: true, mt5_account: account, mt5_accounts: [account] });
  }

  // Plano multi-conta → adiciona (se ainda não tiver e houver vaga)
  if (!list.includes(account)) {
    if (limit !== -1 && list.length >= limit) {
      return json({ error: 'limit_reached', limit, mt5_accounts: list }, 409);
    }
    list.push(account);
  }
  const primary = row && row.mt5_account ? row.mt5_account : list[0];
  await env.DB.prepare('UPDATE users SET mt5_accounts = ?, mt5_account = COALESCE(mt5_account, ?) WHERE email = ?')
    .bind(JSON.stringify(list), primary, email).run();
  return json({ ok: true, mt5_account: primary, mt5_accounts: list });
}
