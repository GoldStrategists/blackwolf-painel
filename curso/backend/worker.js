/**
 * ═══════════════════════════════════════════════════════════════
 *  BLACK WOLF — Portal do Curso — Back-end v1 (Cloudflare Worker)
 * ═══════════════════════════════════════════════════════════════
 *  Base: arquitetura copiada do worker do robô (blackwolf-painel/backend/worker.js)
 *  — PBKDF2, sessão em KV, rate limit, webhook Stripe assinado — trocando
 *  licença/EA por aulas/módulos/progresso. Ver curso/README.md para o
 *  racional de cada correção em relação ao briefing original (docportalcurso.pdf).
 *
 *  Bindings:
 *    DB        → D1 database  "blackwolf-curso-db"   (separado do banco do robô)
 *    SESSIONS  → KV namespace "blackwolf-curso-sessions"
 *
 *  Secrets (Cloudflare → Worker → Settings → Variables):
 *    RESEND_API_KEY        → chave da Resend
 *    EMAIL_FROM             → "Black Wolf <no-reply@blackwolfea.com>"
 *    PORTAL_URL              → "https://curso.blackwolfea.com"
 *    STRIPE_SECRET_KEY       → sk_live_... (chamadas à API do Stripe: cupom de bônus)
 *    STRIPE_WEBHOOK_SECRET   → whsec_... (endpoint de webhook do produto "Curso")
 *    CF_STREAM_ACCOUNT_ID    → account id do Cloudflare (Stream)
 *    CF_STREAM_API_TOKEN     → token com permissão Stream:Edit
 *    STREAM_WEBHOOK_SECRET   → segredo do webhook de status do Stream (opcional, recomendado)
 *    ROBO_BONUS_MONTHS       → "1".."10" — nº de meses grátis do robô (§07b, a confirmar)
 *    ROBO_STRIPE_COUPON_BASE → id do "amount_off"/"percent_off" base já cadastrado no Stripe do robô,
 *                              OU deixe vazio para o worker criar o cupom on-the-fly (ver issueRoboBonus)
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
      // ── Público ──
      if (path === '/api/login' && request.method === 'POST')           return await handleLogin(request, env, json);
      if (path === '/api/forgot-password' && request.method === 'POST') return await handleForgot(request, env, json, ctx);
      if (path === '/api/reset-password' && request.method === 'POST')  return await handleReset(request, env, json);
      if (path === '/api/health')                                       return json({ ok: true, service: 'blackwolf-curso-api', version: 'v1' });

      // ── Stripe / Stream (assinados, não usam sessão de aluno) ──
      if (path === '/api/stripe-webhook' && request.method === 'POST')  return await handleStripeWebhook(request, env, json, ctx);
      if (path === '/api/webhooks/stream' && request.method === 'POST') return await handleStreamWebhook(request, env, json);

      // ── Aluno (Bearer obrigatório) ──
      if (path === '/api/logout' && request.method === 'POST')          return await handleLogout(request, env, json);
      if (path === '/api/me' && request.method === 'GET')               return await handleMe(request, env, json);
      if (path === '/api/change-password' && request.method === 'POST') return await handleChangePassword(request, env, json);
      if (path === '/api/profile' && request.method === 'POST')         return await handleProfile(request, env, json);
      if (path === '/api/lessons' && request.method === 'GET')          return await handleLessons(request, env, json);
      if (path.match(/^\/api\/lesson\/\d+\/token$/) && request.method === 'GET')
        return await handleLessonToken(request, env, json, path.split('/')[3]);
      if (path === '/api/progress' && request.method === 'POST')        return await handleProgress(request, env, json);
      if (path.match(/^\/api\/material\/\d+\/\d+$/) && request.method === 'GET')
        return await handleMaterial(request, env, json, path.split('/'));

      // ── Admin (role=admin) ──
      if (path === '/api/admin/students' && request.method === 'GET')          return await handleAdminStudents(request, env, json, url);
      if (path === '/api/admin/enroll' && request.method === 'POST')           return await handleAdminEnroll(request, env, json);
      if (path === '/api/admin/module' && request.method === 'POST')           return await handleAdminModule(request, env, json);
      if (path === '/api/admin/lesson' && request.method === 'POST')           return await handleAdminLesson(request, env, json);
      if (path.match(/^\/api\/admin\/lesson\/\d+\/upload-url$/) && request.method === 'POST')
        return await handleAdminUploadUrl(request, env, json, path.split('/')[4]);
      if (path === '/api/admin/broadcast' && request.method === 'POST')        return await handleAdminBroadcast(request, env, json, ctx);
      if (path === '/api/admin/metrics' && request.method === 'GET')           return await handleAdminMetrics(request, env, json);

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      try { logEvent({ evt: 'server_error', detail: String(err && err.message || err), stack: String(err && err.stack || '').slice(0, 500) }); } catch (e) {}
      return json({ error: 'server_error' }, 500);
    }
  },
};

/* ───────────────── CRIPTOGRAFIA (idêntico ao robô) ───────────────── */
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bufToHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function pbkdf2(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return bufToHex(bits);
}
function randomHex(bytes = 16) { return bufToHex(crypto.getRandomValues(new Uint8Array(bytes))); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % max;
}
function generatePassword() {
  const words = ['Wolf', 'Gold', 'Curso', 'Alpha', 'Star', 'Moon', 'Blue', 'Fire'];
  const w1 = words[randInt(words.length)];
  const w2 = words[randInt(words.length)];
  const num = String(1000 + randInt(9000));
  return w1 + '#' + num + w2 + '-' + randomHex(6);
}
function capStr(v, max) { if (v == null) return null; const s = String(v); return s.length > max ? s.slice(0, max) : s; }

/* ───────────────── RATE LIMIT + LOG (idêntico ao robô) ───────────────── */
async function rateLimited(env, key, limit, windowSec) {
  try {
    const k = 'rl:' + key;
    const cur = parseInt((await env.SESSIONS.get(k)) || '0', 10) || 0;
    if (cur >= limit) return true;
    await env.SESSIONS.put(k, String(cur + 1), { expirationTtl: windowSec });
    return false;
  } catch (e) { return false; }
}
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'; }
function logEvent(obj) { try { console.log(JSON.stringify({ t: new Date().toISOString(), ...obj })); } catch (e) {} }

/* ───────────────── SESSÕES (idêntico ao robô — Bearer puro, sem cookie: fecha o achado F-02) ───────────────── */
async function createSession(env, email) {
  const token = randomHex(32);
  await env.SESSIONS.put('sess:' + token, email, { expirationTtl: 60 * 60 * 24 * 30 });
  try {
    const k = 'usess:' + email;
    let arr = []; try { arr = JSON.parse(await env.SESSIONS.get(k) || '[]'); } catch (e) {}
    if (!Array.isArray(arr)) arr = [];
    arr.push(token);
    if (arr.length > 25) arr = arr.slice(-25);
    await env.SESSIONS.put(k, JSON.stringify(arr), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (e) {}
  return token;
}
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
// aluno logado + matrícula ativa (não só login) — regra do §11 do briefing
async function requireActiveStudent(request, env) {
  const email = await getSessionEmail(request, env);
  if (!email) return { error: 'unauthorized', status: 401 };
  const student = await env.DB.prepare('SELECT * FROM students WHERE email = ?').bind(email).first();
  if (!student) return { error: 'unauthorized', status: 401 };
  const enr = await env.DB.prepare("SELECT * FROM enrollments WHERE email = ? AND course = 'black-wolf'").bind(email).first();
  const active = enr && enr.status === 'active' && (!enr.access_until || new Date(enr.access_until) > new Date());
  if (!active && student.role !== 'admin') return { error: 'no_access', status: 403 };
  return { email, student, enrollment: enr };
}
async function requireAdmin(request, env) {
  const email = await getSessionEmail(request, env);
  if (!email) return { error: 'unauthorized', status: 401 };
  const student = await env.DB.prepare('SELECT * FROM students WHERE email = ?').bind(email).first();
  if (!student || student.role !== 'admin') return { error: 'forbidden', status: 403 };
  return { email, student };
}
function publicStudent(row) {
  if (!row) return null;
  return { email: row.email, name: row.name, role: row.role, lang: row.lang || 'pt', created_at: row.created_at };
}

/* ───────────────── AUTENTICAÇÃO ───────────────── */
async function handleLogin(request, env, json) {
  const { email, password } = await request.json();
  if (!email || !password) return json({ error: 'missing_fields' }, 400);
  const e = String(email).trim().toLowerCase();
  if (await rateLimited(env, 'login:' + clientIp(request) + ':' + e, 10, 300)) {
    logEvent({ evt: 'login_ratelimited', ip: clientIp(request) });
    return json({ error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos.' }, 429);
  }
  const row = await env.DB.prepare('SELECT * FROM students WHERE email = ?').bind(e).first();
  // pbkdf2 dummy mesmo sem usuário — anti-enumeração por timing (mesma defesa do robô)
  if (!row) { await pbkdf2(password, 'ffffffffffffffffffffffffffffffff'); return json({ error: 'invalid_credentials' }, 401); }
  const computed = await pbkdf2(password, row.salt);
  if (!safeEqual(computed, row.password_hash)) return json({ error: 'invalid_credentials' }, 401);
  await env.DB.prepare('UPDATE students SET last_login = ? WHERE email = ?').bind(new Date().toISOString(), e).run();
  const token = await createSession(env, e);
  const enr = await env.DB.prepare("SELECT * FROM enrollments WHERE email = ? AND course = 'black-wolf'").bind(e).first();
  return json({ token, user: publicStudent(row), enrollment: enr || null });
}
async function handleLogout(request, env, json) {
  const token = bearerToken(request);
  if (token) await env.SESSIONS.delete('sess:' + token);
  return json({ ok: true });
}
async function handleMe(request, env, json) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const total = await env.DB.prepare("SELECT COUNT(*) n FROM lessons WHERE published = 1").first();
  const done = await env.DB.prepare(
    "SELECT COUNT(*) n FROM progress WHERE email = ? AND completed = 1"
  ).bind(gate.email).first();
  return json({
    user: publicStudent(gate.student),
    enrollment: gate.enrollment || null,
    progress: { done: (done && done.n) || 0, total: (total && total.n) || 0 },
  });
}
async function handleChangePassword(request, env, json) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const { current, new_password } = await request.json();
  if (!current || !new_password) return json({ error: 'missing_fields' }, 400);
  if (String(new_password).length < 8) return json({ error: 'weak_password' }, 400);
  const computed = await pbkdf2(current, gate.student.salt);
  if (!safeEqual(computed, gate.student.password_hash)) return json({ error: 'wrong_current' }, 403);
  const salt = randomHex(16);
  const hash = await pbkdf2(new_password, salt);
  await env.DB.prepare('UPDATE students SET password_hash = ?, salt = ? WHERE email = ?').bind(hash, salt, gate.email).run();
  await revokeSessions(env, gate.email, bearerToken(request));
  return json({ ok: true });
}
async function handleProfile(request, env, json) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const b = await request.json();
  const lang = ['pt', 'en', 'es'].includes(b.lang) ? b.lang : gate.student.lang || 'pt';
  await env.DB.prepare('UPDATE students SET name = COALESCE(?, name), lang = ? WHERE email = ?')
    .bind(capStr(b.name, 80), lang, gate.email).run();
  const fresh = await env.DB.prepare('SELECT * FROM students WHERE email = ?').bind(gate.email).first();
  return json({ ok: true, user: publicStudent(fresh) });
}
async function handleForgot(request, env, json, ctx) {
  const { email } = await request.json();
  const e = String(email || '').trim().toLowerCase();
  const generic = { ok: true };
  if (!e) return json(generic);
  if (await rateLimited(env, 'forgot:' + e, 1, 900)) return json(generic); // sem oráculo de timing
  const row = await env.DB.prepare('SELECT email, name FROM students WHERE email = ?').bind(e).first();
  if (row) {
    const token = randomHex(32);
    await env.SESSIONS.put('reset:' + token, e, { expirationTtl: 60 * 60 });
    const portalUrl = env.PORTAL_URL || 'https://curso.blackwolfea.com';
    const link = `${portalUrl}/?reset=${token}`;
    if (env.RESEND_API_KEY && env.EMAIL_FROM) {
      const html = resetEmailHtml(row.name, link);
      const send = sendMail(env, e, 'Redefinir sua senha — Black Wolf', html).catch(() => {});
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
  await env.DB.prepare('UPDATE students SET password_hash=?, salt=? WHERE email=?').bind(hash, salt, email).run();
  await env.SESSIONS.delete('reset:' + token);
  await revokeSessions(env, email); // recuperação derruba TODAS as sessões (mesma defesa do robô)
  return json({ ok: true });
}

/* ───────────────── AULAS / PROGRESSO ───────────────── */
async function handleLessons(request, env, json) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const mods = await env.DB.prepare('SELECT * FROM modules ORDER BY ord ASC').all();
  const lessons = await env.DB.prepare(
    'SELECT id, module, ord, title, description, duration_s, video_status, is_core, materials FROM lessons WHERE published = 1 ORDER BY module ASC, ord ASC'
  ).all();
  const prog = await env.DB.prepare('SELECT lesson_id, completed, last_position_s FROM progress WHERE email = ?').bind(gate.email).all();
  const progByLesson = {};
  for (const p of (prog.results || [])) progByLesson[p.lesson_id] = { completed: !!p.completed, last_position_s: p.last_position_s };
  const out = (lessons.results || []).map(l => ({
    ...l,
    materials: safeJson(l.materials, []),
    progress: progByLesson[l.id] || { completed: false, last_position_s: 0 },
  }));
  return json({ modules: mods.results || [], lessons: out });
}
function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }

// URL assinada de reprodução — nunca embute URL pública fixa (regra inegociável do §07)
async function handleLessonToken(request, env, json, lessonId) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const lesson = await env.DB.prepare('SELECT * FROM lessons WHERE id = ? AND published = 1').bind(lessonId).first();
  if (!lesson) return json({ error: 'not_found' }, 404);
  if (lesson.video_status !== 'ready') return json({ error: 'video_not_ready', status: lesson.video_status }, 409);
  if (!env.CF_STREAM_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) return json({ error: 'stream_not_configured' }, 500);
  // Cloudflare Stream: gera token assinado de curta duração (signed URL), com domain-lock
  // configurado no vídeo (allowedOrigins). Requer signing key habilitada na conta Stream.
  const exp = Math.floor(Date.now() / 1000) + 60 * 30; // 30 min
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/${lesson.video_id}/token`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.CF_STREAM_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ exp, downloadable: false }),
    }
  );
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.success) {
    logEvent({ evt: 'stream_token_fail', lesson: lessonId, status: r.status });
    return json({ error: 'stream_token_failed' }, 502);
  }
  return json({ token: data.result.token, expires_at: exp });
}

async function handleProgress(request, env, json) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const b = await request.json();
  const lessonId = parseInt(b.lesson_id, 10);
  if (!lessonId) return json({ error: 'missing_fields' }, 400);
  await env.DB.prepare(
    `INSERT INTO progress (email, lesson_id, completed, last_position_s, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(email, lesson_id) DO UPDATE SET
       completed = excluded.completed,
       last_position_s = excluded.last_position_s,
       updated_at = excluded.updated_at`
  ).bind(gate.email, lessonId, b.completed ? 1 : 0, Math.max(0, parseInt(b.position, 10) || 0), new Date().toISOString()).run();
  return json({ ok: true });
}

async function handleMaterial(request, env, json, pathParts) {
  const gate = await requireActiveStudent(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const lessonId = pathParts[3], idx = parseInt(pathParts[4], 10);
  const lesson = await env.DB.prepare('SELECT materials FROM lessons WHERE id = ? AND published = 1').bind(lessonId).first();
  if (!lesson) return json({ error: 'not_found' }, 404);
  const mats = safeJson(lesson.materials, []);
  const mat = mats[idx];
  if (!mat || !mat.url) return json({ error: 'not_found' }, 404);
  return Response.redirect(mat.url, 302);
}

/* ───────────────── ADMIN ───────────────── */
async function handleAdminStudents(request, env, json, url) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 50));
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const offset = (page - 1) * limit;
  const rows = await env.DB.prepare(
    `SELECT s.email, s.name, s.created_at, s.last_login, e.status, e.access_until, e.source,
            (SELECT COUNT(*) FROM progress p WHERE p.email = s.email AND p.completed = 1) as completed_lessons
     FROM students s LEFT JOIN enrollments e ON e.email = s.email AND e.course = 'black-wolf'
     WHERE s.role = 'student'
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const total = await env.DB.prepare("SELECT COUNT(*) n FROM students WHERE role = 'student'").first();
  return json({ students: rows.results || [], page, limit, total: (total && total.n) || 0 });
}

async function handleAdminEnroll(request, env, json) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const b = await request.json();
  const email = String(b.email || '').trim().toLowerCase();
  const action = b.action; // 'grant' | 'revoke'
  if (!email || !['grant', 'revoke'].includes(action)) return json({ error: 'missing_fields' }, 400);
  const student = await env.DB.prepare('SELECT * FROM students WHERE email = ?').bind(email).first();
  if (!student) return json({ error: 'student_not_found' }, 404);
  const before = await env.DB.prepare("SELECT * FROM enrollments WHERE email = ? AND course = 'black-wolf'").bind(email).first();
  const newStatus = action === 'grant' ? 'active' : 'revoked';
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO enrollments (email, course, status, access_until, source, created_at)
     VALUES (?, 'black-wolf', ?, NULL, 'admin_manual', ?)
     ON CONFLICT(email, course) DO UPDATE SET status = excluded.status`
  ).bind(email, newStatus, now).run();
  await env.DB.prepare(
    `INSERT INTO enrollment_events (email, actor, from_status, to_status, reason, created_at) VALUES (?,?,?,?,?,?)`
  ).bind(email, 'admin:' + gate.email, (before && before.status) || null, newStatus, 'manual', now).run();
  return json({ ok: true });
}

async function handleAdminModule(request, env, json) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const b = await request.json();
  if (b.id) {
    await env.DB.prepare('UPDATE modules SET ord=?, title=?, description=? WHERE id=?')
      .bind(b.ord || 0, capStr(b.title, 200), capStr(b.description, 2000), b.id).run();
    return json({ ok: true, id: b.id });
  }
  const r = await env.DB.prepare('INSERT INTO modules (ord, title, description) VALUES (?,?,?)')
    .bind(b.ord || 0, capStr(b.title, 200), capStr(b.description, 2000)).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function handleAdminLesson(request, env, json) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const b = await request.json();
  const materials = JSON.stringify(Array.isArray(b.materials) ? b.materials.slice(0, 20) : []);
  if (b.id) {
    await env.DB.prepare(
      `UPDATE lessons SET module=?, ord=?, title=?, description=?, materials=?, is_core=?, published=? WHERE id=?`
    ).bind(b.module || 0, b.ord || 0, capStr(b.title, 200), capStr(b.description, 4000), materials, b.is_core ? 1 : 0, b.published ? 1 : 0, b.id).run();
    return json({ ok: true, id: b.id });
  }
  const r = await env.DB.prepare(
    `INSERT INTO lessons (module, ord, title, description, materials, is_core, published, video_status, created_at)
     VALUES (?,?,?,?,?,?,0,'uploading',?)`
  ).bind(b.module || 0, b.ord || 0, capStr(b.title, 200), capStr(b.description, 4000), materials, b.is_core ? 1 : 0, new Date().toISOString()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

// Passo 2 do fluxo de vídeo do §07 — a peça que o briefing original descrevia
// em prosa mas nunca listava na tabela de endpoints (achado F-06).
async function handleAdminUploadUrl(request, env, json, lessonId) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const lesson = await env.DB.prepare('SELECT id FROM lessons WHERE id = ?').bind(lessonId).first();
  if (!lesson) return json({ error: 'not_found' }, 404);
  if (!env.CF_STREAM_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) return json({ error: 'stream_not_configured' }, 500);
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/direct_upload`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.CF_STREAM_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxDurationSeconds: 7200,
        requireSignedURLs: true,
        allowedOrigins: [new URL(env.PORTAL_URL || 'https://curso.blackwolfea.com').hostname],
        meta: { lesson_id: String(lessonId) },
      }),
    }
  );
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.success) {
    logEvent({ evt: 'stream_upload_url_fail', lesson: lessonId, status: r.status });
    return json({ error: 'stream_upload_failed' }, 502);
  }
  await env.DB.prepare("UPDATE lessons SET video_id = ?, video_status = 'uploading' WHERE id = ?")
    .bind(data.result.uid, lessonId).run();
  return json({ ok: true, uploadURL: data.result.uploadURL, video_id: data.result.uid });
}

async function handleAdminBroadcast(request, env, json, ctx) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const b = await request.json();
  const subject = capStr(b.subject, 200), html = b.html || '';
  if (!subject || !html) return json({ error: 'missing_fields' }, 400);
  const rows = await env.DB.prepare(
    "SELECT s.email FROM students s JOIN enrollments e ON e.email = s.email WHERE e.course='black-wolf' AND e.status='active'"
  ).all();
  const list = rows.results || [];
  const send = async () => { for (const r of list) { await sendMail(env, r.email, subject, html); } };
  if (ctx && ctx.waitUntil) ctx.waitUntil(send()); else await send();
  return json({ ok: true, sent_to: list.length });
}

async function handleAdminMetrics(request, env, json) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return json({ error: gate.error }, gate.status);
  const students = await env.DB.prepare("SELECT COUNT(*) n FROM students WHERE role='student'").first();
  const active = await env.DB.prepare("SELECT COUNT(*) n FROM enrollments WHERE status='active'").first();
  const lessonsTotal = await env.DB.prepare('SELECT COUNT(*) n FROM lessons WHERE published=1').first();
  const avgProgress = await env.DB.prepare(
    `SELECT AVG(pct) as avg_pct FROM (
       SELECT p.email, (CAST(SUM(p.completed) AS REAL) / NULLIF((SELECT COUNT(*) FROM lessons WHERE published=1),0)) as pct
       FROM progress p GROUP BY p.email
     )`
  ).first();
  const revenue = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM payments").first();
  return json({
    students: (students && students.n) || 0,
    active_enrollments: (active && active.n) || 0,
    lessons_published: (lessonsTotal && lessonsTotal.n) || 0,
    avg_completion_pct: Math.round(((avgProgress && avgProgress.avg_pct) || 0) * 100),
    revenue_total: (revenue && revenue.total) || 0,
    payments_count: (revenue && revenue.n) || 0,
  });
}

/* ───────────────── WEBHOOK DO CLOUDFLARE STREAM ─────────────────
   Resolve o achado F-07: sem isso, video_status nunca sai de 'uploading'/
   'processing' sozinho. Configurar em Cloudflare → Stream → Webhooks. */
async function handleStreamWebhook(request, env, json) {
  const body = await request.text();
  if (env.STREAM_WEBHOOK_SECRET) {
    const sig = request.headers.get('webhook-signature') || '';
    const ok = await verifyStreamSignature(body, sig, env.STREAM_WEBHOOK_SECRET);
    if (!ok) return json({ error: 'invalid_signature' }, 400);
  }
  let evt; try { evt = JSON.parse(body); } catch (e) { return json({ error: 'invalid_json' }, 400); }
  const uid = evt.uid || (evt.data && evt.data.uid);
  const status = evt.status && evt.status.state; // 'ready' | 'error' | 'inprogress' (Stream)
  const duration = evt.duration || (evt.data && evt.data.duration);
  if (!uid) return json({ error: 'missing_uid' }, 400);
  const mapped = status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'processing';
  await env.DB.prepare('UPDATE lessons SET video_status = ?, duration_s = COALESCE(?, duration_s) WHERE video_id = ?')
    .bind(mapped, duration ? Math.round(duration) : null, uid).run();
  return json({ ok: true });
}
async function verifyStreamSignature(payload, sigHeader, secret) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return safeEqual(bufToHex(sig), sigHeader.replace(/^sha256=/, ''));
  } catch (e) { return false; }
}

/* ───────────────── STRIPE ───────────────── */
async function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    const parts = sigHeader.split(',');
    const tPart = parts.find(p => p.startsWith('t='));
    const v1Part = parts.find(p => p.startsWith('v1='));
    if (!tPart || !v1Part) return false;
    const timestamp = tPart.split('=')[1];
    const expected = v1Part.split('=')[1];
    const ts = parseInt(timestamp, 10);
    if (!ts || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false; // anti-replay
    const signed = timestamp + '.' + payload;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signed));
    return safeEqual(bufToHex(sig), expected);
  } catch (e) { return false; }
}

// Resolve o achado F-01 (idempotência) e F-04 (reembolso/disputa nunca eram tratados).
async function handleStripeWebhook(request, env, json, ctx) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  if (!env.STRIPE_WEBHOOK_SECRET) {
    logEvent({ evt: 'stripe_webhook_misconfigured' });
    return json({ error: 'webhook_not_configured' }, 500); // falha fechado, nunca aceita sem verificar
  }
  const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'invalid_signature' }, 400);

  let event; try { event = JSON.parse(body); } catch (e) { return json({ error: 'invalid_json' }, 400); }
  const obj = event.data.object;

  // ── Passo 1: idempotência — antes de qualquer efeito colateral ──
  const payKey = obj.id || event.id;
  const already = await env.DB.prepare(
    'INSERT OR IGNORE INTO payments (email, amount, currency, product, event_id, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(
    obj.customer_details?.email || obj.customer_email || null,
    (obj.amount_total || obj.amount_paid || 0) / 100,
    (obj.currency || 'usd').toUpperCase(),
    'curso',
    payKey,
    new Date().toISOString()
  ).run();
  if (already.meta.changes === 0) {
    logEvent({ evt: 'stripe_webhook_duplicate', event_id: payKey });
    return json({ ok: true, duplicate: true });
  }

  // ── Reembolso / disputa: revoga acesso (achado F-04 — não existia no briefing original) ──
  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    const customerEmail = await resolveEmailFromCharge(env, obj);
    if (customerEmail) {
      const before = await env.DB.prepare("SELECT status FROM enrollments WHERE email=? AND course='black-wolf'").bind(customerEmail).first();
      await env.DB.prepare(
        "UPDATE enrollments SET status='revoked' WHERE email=? AND course='black-wolf'"
      ).bind(customerEmail).run();
      await env.DB.prepare(
        'INSERT INTO enrollment_events (email, actor, from_status, to_status, reason, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(customerEmail, 'stripe', (before && before.status) || null, 'revoked',
        event.type === 'charge.refunded' ? 'refund' : 'dispute', new Date().toISOString()).run();
      logEvent({ evt: 'access_revoked', email: customerEmail, reason: event.type });
    }
    return json({ ok: true, action: event.type });
  }

  if (event.type !== 'checkout.session.completed') return json({ ok: true, ignored: true });

  // Nunca pelo valor pago — sempre pelo produto/metadata (regra travada no briefing §04)
  const product = obj.metadata && obj.metadata.product;
  if (product !== 'curso') return json({ ok: true, ignored: true, reason: 'not_course_product' });

  let email = obj.customer_details?.email || obj.customer_email || null;
  const name = obj.customer_details?.name || 'Aluno';
  if (!email) return json({ error: 'no_email' }, 400);
  email = email.trim().toLowerCase();
  const stripeCustomer = obj.customer || null;

  const existing = await env.DB.prepare('SELECT email FROM students WHERE email = ?').bind(email).first();
  const isNew = !existing;
  let plainPassword = null;
  if (isNew) {
    plainPassword = generatePassword();
    const salt = randomHex(16);
    const hash = await pbkdf2(plainPassword, salt);
    await env.DB.prepare(
      'INSERT INTO students (email, password_hash, salt, name, role, lang, stripe_customer, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(email, hash, salt, capStr(name, 80), 'student', 'pt', stripeCustomer, new Date().toISOString()).run();
  } else {
    await env.DB.prepare('UPDATE students SET stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?')
      .bind(stripeCustomer, email).run();
  }

  const beforeEnr = await env.DB.prepare("SELECT status FROM enrollments WHERE email=? AND course='black-wolf'").bind(email).first();
  await env.DB.prepare(
    `INSERT INTO enrollments (email, course, status, access_until, source, created_at)
     VALUES (?, 'black-wolf', 'active', NULL, 'stripe', ?)
     ON CONFLICT(email, course) DO UPDATE SET status='active'`
  ).bind(email, new Date().toISOString()).run();
  await env.DB.prepare(
    'INSERT INTO enrollment_events (email, actor, from_status, to_status, reason, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(email, 'stripe', (beforeEnr && beforeEnr.status) || null, 'active', 'purchase', new Date().toISOString()).run();

  // Bônus (§07b, Opção A — cupom Stripe). Nunca deixa o webhook falhar por causa disso.
  let bonusInfo = null;
  try { bonusInfo = await issueRoboBonus(env, email); } catch (e) { logEvent({ evt: 'bonus_fail', detail: String(e && e.message || e) }); }

  const portalUrl = env.PORTAL_URL || 'https://curso.blackwolfea.com';
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const html = welcomeEmailHtml(name, isNew ? plainPassword : null, portalUrl, bonusInfo);
    const send = sendMail(env, email, 'Black Wolf — seu curso está liberado', html);
    if (ctx && ctx.waitUntil) ctx.waitUntil(send); else await send();
  }

  return json({ ok: true, email, is_new: isNew });
}

async function resolveEmailFromCharge(env, obj) {
  const customerId = obj.customer || null;
  if (!customerId) return null;
  const row = await env.DB.prepare('SELECT email FROM students WHERE stripe_customer = ?').bind(customerId).first();
  return row ? row.email : null;
}

// Opção A do §07b: gera um cupom 100% off (N meses) no Stripe do robô e devolve
// as instruções para o e-mail de boas-vindas. N vem de env.ROBO_BONUS_MONTHS
// (1 a 10, "a confirmar" no briefing §14) — se não configurado, pula sem quebrar
// o resto do webhook (o bônus nunca pode travar a liberação do curso em si).
async function issueRoboBonus(env, email) {
  if (!env.STRIPE_SECRET_KEY || !env.ROBO_BONUS_MONTHS) return null;
  const months = Math.min(10, Math.max(1, parseInt(env.ROBO_BONUS_MONTHS, 10) || 0));
  if (!months) return null;
  const params = new URLSearchParams({
    duration: 'repeating',
    duration_in_months: String(months),
    percent_off: '100',
    max_redemptions: '1',
    name: `Bonus Curso - ${months}m - ${email}`,
  });
  const r = await fetch('https://api.stripe.com/v1/coupons', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.id) {
    logEvent({ evt: 'robo_bonus_coupon_fail', status: r.status });
    return null;
  }
  return { months, coupon_id: data.id };
}

/* ───────────────── E-MAIL (Resend — mesmo padrão do robô) ───────────────── */
async function sendMail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false, status: 0, body: 'email_not_configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, status: 0, body: String(e && e.message || e) }; }
}
function emailShell(inner) {
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"></head>
  <body style="background:#07080B;color:#ECEDF3;font-family:Arial,sans-serif;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#0E1016;border:1px solid #232733;border-radius:12px;padding:32px;">
  ${inner}
  <p style="color:#656B80;font-size:12px;margin-top:32px;">Black Wolf · Gold Strategists LLC</p>
  </div></body></html>`;
}
function welcomeEmailHtml(name, password, portalUrl, bonusInfo) {
  const passBlock = password
    ? `<p>Sua senha de acesso: <strong style="color:#8E7CF9;">${password}</strong></p><p style="color:#9CA1B4;font-size:13px;">Recomendamos trocar a senha assim que entrar, em Configurações.</p>`
    : `<p>Use a senha da sua conta para entrar.</p>`;
  const bonus = bonusInfo
    ? `<p style="margin-top:16px;">🎁 Bônus: <strong>${bonusInfo.months} ${bonusInfo.months === 1 ? 'mês grátis' : 'meses grátis'}</strong> do robô Black Wolf. Cupom: <code>${bonusInfo.coupon_id}</code></p>`
    : '';
  return emailShell(`
    <h2 style="color:#fff;">Bem-vindo(a) ao curso, ${name}!</h2>
    <p>Seu acesso ao Portal do Curso está liberado — vitalício, sem mensalidade.</p>
    ${passBlock}
    ${bonus}
    <p style="margin-top:24px;"><a href="${portalUrl}" style="background:#2D6CFF;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;">Acessar o curso</a></p>
  `);
}
function resetEmailHtml(name, link) {
  return emailShell(`
    <h2 style="color:#fff;">Redefinir sua senha</h2>
    <p>Olá${name ? ', ' + name : ''}. Clique no link abaixo para criar uma nova senha (expira em 1 hora):</p>
    <p><a href="${link}" style="background:#2D6CFF;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;">Redefinir senha</a></p>
    <p style="color:#656B80;font-size:12px;">Se você não pediu isso, ignore este e-mail.</p>
  `);
}
