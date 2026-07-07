/**
 * ═══════════════════════════════════════════════════════════════
 *  BLACK WOLF — Back-end v19 (Cloudflare Worker)
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
  async fetch(request, env) {
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
      if (path === '/api/forgot-password' && request.method === 'POST')  return await handleForgot(request, env, json);
      if (path === '/api/reset-password' && request.method === 'POST')   return await handleReset(request, env, json);
      if (path === '/api/admin/clients' && request.method === 'GET')      return await handleAdminClients(request, env, json);
      if (path === '/api/config' && request.method === 'POST')           return await handleSaveConfig(request, env, json);
      if (path === '/api/mt5-account' && request.method === 'POST')      return await handleMt5Account(request, env, json);
      if (path === '/api/my-data' && request.method === 'GET')           return await handleMyData(request, env, json);
      if (path === '/api/risk-profiles' && request.method === 'GET')     return await handleRiskProfilesGet(request, env, json);
      if (path === '/api/admin/risk-profiles' && request.method === 'POST') return await handleRiskProfilesSave(request, env, json);
      if (path === '/api/ea/config' && request.method === 'GET')         return await handleEaConfig(request, env, json, url);
      if (path === '/api/ea/trades' && request.method === 'POST')        return await handleEaTrades(request, env, json, url);
      if (path === '/api/ea/ping' && request.method === 'GET')           return await handleEaPing(request, env, json, url);
      if (path === '/api/stripe-webhook' && request.method === 'POST')   return await handleStripeWebhook(request, env, json);
      if (path === '/api/health')                                        return json({ ok: true, service: 'blackwolf-api-v22' });

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err && err.message || err) }, 500);
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
// gera senha legível ex: Wolf#4829Azul
function generatePassword() {
  const words = ['Wolf','Gold','Pack','Lone','Alpha','Star','Moon','Dark','Blue','Fire'];
  const w1 = words[Math.floor(Math.random()*words.length)];
  const w2 = words[Math.floor(Math.random()*words.length)];
  const num = String(Math.floor(Math.random()*9000)+1000);
  return w1 + '#' + num + w2;
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

/* ───────────────── SESSÕES ───────────────── */
async function createSession(env, email) {
  const token = randomHex(32);
  await env.SESSIONS.put('sess:' + token, email, { expirationTtl: 60 * 60 * 24 * 30 });
  return token;
}
async function getSessionEmail(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
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

  // Verifica assinatura do Stripe (segurança)
  if (env.STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) return json({ error: 'invalid_signature' }, 400);
  }

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
        await env.DB.prepare('UPDATE users SET license_expires_at = ? WHERE stripe_customer = ?').bind(periodEnd, cust).run();
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

  // Identifica o plano: metadata explícita tem prioridade; valor é só fallback.
  // (v22: evita classificar errado por moeda/centavos/plano anual)
  let plan = (obj.metadata && obj.metadata.plan) || null;
  if (!plan) {
    const amount = obj.amount_total || obj.amount_paid || 0;
    if (amount >= 50000) plan = 'Alpha Pack External';
    else if (amount >= 29790) plan = 'Alpha Pack';
    else if (amount >= 24790) plan = 'Wolf Pack';
    else plan = 'Lone Wolf';
  }

  if (!email) return json({ error: 'no_email' }, 400);

  email = email.trim().toLowerCase();

  // v22: renovação (invoice.payment_succeeded) NUNCA muda o plano/limite —
  // só a compra/troca explícita (checkout.session.completed) pode. Isso impede
  // o rebaixamento silencioso (Alpha 3 contas → Lone 1 conta) por valor de invoice.
  const isCheckout = event.type === 'checkout.session.completed';

  // Verifica se já tem conta
  const existing = await env.DB.prepare('SELECT email, license_key FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    // Cliente já tem conta — garante licença ativa e cliente Stripe salvo
    let lic = existing.license_key;
    if (!lic) { lic = generateLicenseKey(); }
    if (isCheckout) {
      // compra/troca explícita: pode ajustar plano e limite
      await env.DB.prepare("UPDATE users SET license_key = ?, license_status = 'active', plan = ?, account_limit = ?, stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?")
        .bind(lic, plan, planAccountLimit(plan), stripeCustomer, email).run();
    } else {
      // renovação: só reafirma licença ativa e o customer, preserva plano/limite atuais
      await env.DB.prepare("UPDATE users SET license_key = ?, license_status = 'active', stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?")
        .bind(lic, stripeCustomer, email).run();
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
    `INSERT INTO users (email, password_hash, salt, name, role, lang, plan, license_key, license_status, account_limit, stripe_customer, created_at)
     VALUES (?, ?, ?, ?, 'client', 'pt', ?, ?, 'active', ?, ?, ?)`
  ).bind(email, hash, salt, name, plan, license, planAccountLimit(plan), stripeCustomer, now).run();

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
  return json({ ok: true });
}
async function handleProfile(request, env, json) {
  const email = await getSessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const b = await request.json();
  await env.DB.prepare(
    `UPDATE users SET display_name=?,photo=?,phone=?,whatsapp=?,country=?,city=?,lang=? WHERE email=?`
  ).bind(b.display_name??null,b.photo??null,b.phone??null,b.whatsapp??null,b.country??null,b.city??null,b.lang??'pt',email).run();
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
  ).bind(email,b.age??null,b.experience??null,b.goal??null,b.self_profile??null,b.family??null,b.source??null,b.country??null,b.state??null,b.city??null,b.marketing_opt_in??null,now).run();
  // mantém o país/cidade do cadastro do usuário em sincronia com o questionário
  if (b.country || b.city) {
    await env.DB.prepare('UPDATE users SET country=COALESCE(?,country), city=COALESCE(?,city) WHERE email=?')
      .bind(b.country??null, b.city??null, email).run();
  }
  return json({ ok: true });
}
async function handleForgot(request, env, json) {
  const { email } = await request.json();
  const e = String(email || '').trim().toLowerCase();
  const generic = { ok: true };
  if (!e) return json(generic);
  const row = await env.DB.prepare('SELECT email, name FROM users WHERE email = ?').bind(e).first();
  if (!row) return json(generic);
  const token = randomHex(32);
  await env.SESSIONS.put('reset:' + token, e, { expirationTtl: 60 * 60 });
  const panelUrl = env.PANEL_URL || 'https://painel.blackwolfea.com';
  const link = `${panelUrl}/?reset=${token}`;
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const html = resetEmailHtml(row.name, link);
    await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[e],subject:'Redefinir sua senha — Black Wolf',html})});
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

  const rows = await env.DB.prepare(
    `SELECT u.email, u.name, u.country, u.plan, u.created_at,
            u.license_key, u.license_status, u.license_expires_at, u.mt5_accounts, u.account_limit,
            o.age, o.experience, o.goal, o.self_profile, o.family, o.source,
            o.country AS o_country, o.state, o.city, o.marketing_opt_in
     FROM users u
     LEFT JOIN onboarding o ON o.email = u.email
     WHERE u.role = 'client'
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
      // v22: campos de licença que o painel admin já esperava (antes vinham vazios)
      license_key: r.license_key || null,
      license_status: r.license_status || (r.license_key ? 'active' : null),
      license_expires_at: r.license_expires_at || null,
      accounts_used: (function(){ try { const a = r.mt5_accounts ? JSON.parse(r.mt5_accounts) : []; return Array.isArray(a) ? a.length : 0; } catch(e){ return 0; } })(),
      account_limit: (r.account_limit != null ? r.account_limit : null),
      onboarding: (r.age || r.o_country || r.marketing_opt_in) ? {
        age: r.age, experience: r.experience, goal: r.goal,
        selfProfile: r.self_profile, family: r.family, source: r.source,
        country: r.o_country, state: r.state, city: r.city, marketing: r.marketing_opt_in
      } : null,
    }));

  return json({ clients });
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
        out[k] = raw[k]; // lotMode/leverage/timezone/newsPause/profile (não-numéricos)
      }
    }
    if (raw.sessionRisk && typeof raw.sessionRisk === 'object') {
      const sr = sanitizeSessionRisk(raw.sessionRisk);
      if (Object.keys(sr).length) out.sessionRisk = sr;
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
  const meRow = await env.DB.prepare('SELECT results_source, ea_config FROM users WHERE email = ?').bind(email).first();
  const target = (meRow && meRow.results_source) ? meRow.results_source : email;

  // carrega a estrutura atual do ALVO (para preservar as configs das outras contas)
  const targetRow = (target === email)
    ? meRow
    : await env.DB.prepare('SELECT ea_config FROM users WHERE email = ?').bind(target).first();
  const struct = normalizeEaConfig(targetRow ? targetRow.ea_config : null);

  if (account) {
    struct.accounts = struct.accounts || {};
    struct.accounts[account] = { ...cfg, updated_at: now };
  } else {
    struct.default = { ...cfg, updated_at: now };
  }
  struct.updated_at = now;

  await env.DB.prepare('UPDATE users SET ea_config = ? WHERE email = ?')
    .bind(JSON.stringify(struct), target).run();
  // v21: trilha de auditoria — todo salvamento fica registrado (quem/quando/o quê)
  try {
    await env.DB.prepare('INSERT INTO config_log (email, target, account, config_json, created_at) VALUES (?,?,?,?,?)')
      .bind(email, target, account || '_default', JSON.stringify(cfg), now).run();
  } catch (e) {}
  return json({ ok: true, account: account || null, config: cfg, ea_config: struct });
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
  return (a != null && String(a).trim() !== '') ? String(a).trim() : null;
}
// retorna {mismatch:bool} e amarra a conta se ainda não houver
async function bindOrCheckAccount(env, row, account){
  if(!account) return { mismatch:false, bound: row.mt5_account || null };
  const acc = String(account);
  // account_limit: 1 = normal (1 conta), N = ate N contas, -1 = ILIMITADO (licenca de dono)
  const limit = (row.account_limit === -1) ? -1
              : ((row.account_limit && row.account_limit > 1) ? row.account_limit : 1);

  // ── Licenca normal de 1 conta (comportamento padrao do aluno, INALTERADO) ──
  if(limit === 1){
    if(!row.mt5_account){
      await env.DB.prepare('UPDATE users SET mt5_account = ? WHERE email = ?').bind(acc, row.email).run();
      return { mismatch:false, bound: acc, justBound:true };
    }
    if(String(row.mt5_account) !== acc) return { mismatch:true, bound: row.mt5_account };
    return { mismatch:false, bound: row.mt5_account };
  }

  // ── Licenca de dono / multi-conta (limit > 1, ou -1 = ilimitado) ──
  let list = [];
  try { list = row.mt5_accounts ? JSON.parse(row.mt5_accounts) : []; } catch(e){ list = []; }
  if(list.length === 0 && row.mt5_account) list = [String(row.mt5_account)]; // herda conta antiga
  if(list.includes(acc)) return { mismatch:false, bound: acc };               // ja autorizada
  if(limit === -1 || list.length < limit){                                    // tem vaga
    list.push(acc);
    await env.DB.prepare('UPDATE users SET mt5_accounts = ?, mt5_account = COALESCE(mt5_account, ?) WHERE email = ?')
      .bind(JSON.stringify(list), acc, row.email).run();
    return { mismatch:false, bound: acc, justBound:true };
  }
  return { mismatch:true, bound: list[0] || null };                           // limite atingido
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
  const row = await env.DB.prepare('SELECT email, role, ea_config, plan, license_status, mt5_account, account_limit, mt5_accounts FROM users WHERE license_key = ?').bind(license).first();
  if (!row) return json({ error: 'license_not_found', active: false }, 404);
  if (row.license_status && row.license_status !== 'active')
    return json({ error: 'license_revoked', active: false, status: row.license_status }, 403);
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
  // é determinístico). Controle GLOBAL do admin, igual para todas as licenças.
  const so = await getSessionOn(env);
  const sessionOn = {};
  for (const k of SESSION_ON_KEYS) sessionOn['on_' + k] = !!so[k];
  config.sessionOn = sessionOn;
  return json({ ok: true, active: true, license, plan: row.plan || null, account: acc.bound || null, config, updated_at: cfg.updated_at || null });
}

/* Teste leve de conectividade + validade da licença (útil para o dev testar).
   GET /api/ea/ping   (mesma autenticação) */
async function handleEaPing(request, env, json, url) {
  const license = getEaLicense(request, url);
  if (!license) return json({ ok:false, error: 'missing_license' }, 401);
  const row = await env.DB.prepare('SELECT email, plan, license_status, mt5_account, account_limit, mt5_accounts FROM users WHERE license_key = ?').bind(license).first();
  if (!row) return json({ ok:false, active:false, error:'license_not_found' }, 404);
  if (row.license_status && row.license_status !== 'active')
    return json({ ok:true, active:false, status: row.license_status }, 403);
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
  const row = await env.DB.prepare('SELECT email, mt5_account, license_status, account_limit, mt5_accounts FROM users WHERE license_key = ?').bind(license).first();
  if (!row) return json({ error: 'license_not_found', active:false }, 404);
  if (row.license_status && row.license_status !== 'active') return json({ error:'license_revoked', active:false }, 403);

  let body; try { body = await request.json(); } catch(e){
    // v20/v21: registra a tentativa rejeitada (diagnóstico nunca mais fica cego)
    await recordEaError(env, license, row.email, getEaAccount(request, url, null), 'invalid_json');
    return json({ error:'invalid_json' }, 400);
  }
  const account = getEaAccount(request, url, body);
  const now = new Date().toISOString();

  // trava: 1 licença = 1 conta (rejeita se outra conta usar a mesma licença)
  const acc = await bindOrCheckAccount(env, row, account);
  if (acc.mismatch) {
    await recordEaError(env, license, row.email, account, 'account_mismatch');
    return json({ error:'account_mismatch', active:false, message:'Licença já vinculada a outra conta MT5' }, 403);
  }

  // heartbeat: saldo, equity e última vez online (sucesso limpa o last_error)
  await env.DB.prepare(
    `INSERT INTO ea_status (license_key, email, account, balance, equity, open_positions, ea_version, last_seen, last_error)
     VALUES (?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(license_key) DO UPDATE SET account=excluded.account, balance=excluded.balance,
       equity=excluded.equity, open_positions=excluded.open_positions, ea_version=excluded.ea_version, last_seen=excluded.last_seen, last_error=NULL`
  ).bind(license, row.email, account, num(body.balance), num(body.equity), intOrNull(body.open_positions), body.ea_version??null, now).run();
  // v21: heartbeat POR CONTA — dois robôs na mesma licença não se sobrescrevem
  if (account != null && String(account).trim() !== '') {
    await env.DB.prepare(
      `INSERT INTO ea_status_acc (license_key, account, email, balance, equity, open_positions, ea_version, last_seen, last_error)
       VALUES (?,?,?,?,?,?,?,?,NULL)
       ON CONFLICT(license_key, account) DO UPDATE SET email=excluded.email, balance=excluded.balance,
         equity=excluded.equity, open_positions=excluded.open_positions, ea_version=excluded.ea_version, last_seen=excluded.last_seen, last_error=NULL`
    ).bind(license, String(account), row.email, num(body.balance), num(body.equity), intOrNull(body.open_positions), body.ea_version??null, now).run();
  }

  // grava os trades fechados (duplicados são ignorados pelo par licença+ticket)
  let received = 0;
  const trades = Array.isArray(body.trades) ? body.trades : [];
  for (const tr of trades) {
    if (!tr) continue;
    const ticket = tr.ticket != null ? String(tr.ticket) : null;
    if (!ticket) continue;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO trades (license_key,email,account,ticket,symbol,type,lots,open_time,close_time,open_price,close_price,profit,commission,swap,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(license, row.email, account, ticket, tr.symbol??null, tr.type??null, num(tr.lots),
           tr.openTime??tr.open_time??null, tr.closeTime??tr.close_time??null,
           num(tr.openPrice??tr.open_price), num(tr.closePrice??tr.close_price),
           num(tr.profit), num(tr.commission), num(tr.swap), now).run();
    received++;
  }
  return json({ ok: true, received, account: acc.bound || null });
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
  const account = body.account != null ? String(body.account).trim() : '';
  if (!account) return json({ error:'missing_account' }, 400);

  const row = await env.DB.prepare('SELECT account_limit, mt5_account, mt5_accounts FROM users WHERE email = ?').bind(email).first();
  const limit = row && row.account_limit === -1 ? -1
              : (row && row.account_limit && row.account_limit > 1 ? row.account_limit : 1);
  let list = [];
  try { list = row && row.mt5_accounts ? JSON.parse(row.mt5_accounts) : []; } catch(e){ list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.map(a => String(a)).filter(a => a && a.trim() !== '');

  // Plano de 1 conta → troca (substitui a única conta)
  if (limit === 1) {
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
