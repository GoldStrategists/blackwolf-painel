-- ═══════════════════════════════════════════════════════════════════════
-- Black Wolf — Portal do Curso — Esquema (Cloudflare D1 / SQLite)
-- ═══════════════════════════════════════════════════════════════════════
-- D1 próprio, separado do banco do robô (blackwolf-db) — decisão travada no
-- briefing (§01/§14): "Login separado do robô". Mesmo padrão de arquivo do
-- schema.sql do robô: idempotente, pode rodar quantas vezes quiser.
--
-- Como rodar: Cloudflare → Workers & Pages → D1 → blackwolf-curso-db →
-- Console → cole tudo → Run.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────── ALUNOS ───────────────
CREATE TABLE IF NOT EXISTS students (
  email          TEXT PRIMARY KEY,
  password_hash  TEXT,
  salt           TEXT,
  name           TEXT,
  role           TEXT DEFAULT 'student',   -- student | admin
  lang           TEXT DEFAULT 'pt',        -- pt | en | es — existia em users.lang no robô (schema.sql:27) e tinha ficado de fora do briefing original (achado F-05 da auditoria)
  stripe_customer TEXT,
  created_at     TEXT,
  last_login     TEXT
);
CREATE INDEX IF NOT EXISTS idx_students_stripe ON students (stripe_customer);

-- ─────────────── MATRÍCULAS ───────────────
-- access_until = NULL → vitalício (pagamento único, decisão travada §00/§04).
CREATE TABLE IF NOT EXISTS enrollments (
  email         TEXT,
  course        TEXT DEFAULT 'black-wolf',
  status        TEXT DEFAULT 'active',     -- active | revoked | refunded
  access_until  TEXT,
  source        TEXT,                      -- stripe | admin_manual | migration
  created_at    TEXT,
  PRIMARY KEY (email, course)
);

-- ─────────────── AUDITORIA DE MATRÍCULA ───────────────
-- Espelha license_events do robô (schema.sql:166-174) — achado F-03 da
-- auditoria: sem isso, revogar/reativar acesso não deixa rastro de quem/quando/por quê.
CREATE TABLE IF NOT EXISTS enrollment_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT,
  actor        TEXT,                       -- 'stripe' | 'admin:<email>' | 'system'
  from_status  TEXT,
  to_status    TEXT,
  reason       TEXT,                       -- purchase | refund | dispute | manual | bonus
  created_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrevents_email ON enrollment_events (email);

-- ─────────────── MÓDULOS ───────────────
CREATE TABLE IF NOT EXISTS modules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ord          INTEGER,
  title        TEXT,
  description  TEXT
);

-- ─────────────── AULAS ───────────────
-- video_status resolve o achado F-07: Stream processa vídeo de forma
-- assíncrona, sem esse campo uma aula "publicada" podia mostrar player
-- quebrado enquanto o vídeo ainda está codificando.
CREATE TABLE IF NOT EXISTS lessons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  module        INTEGER,
  ord           INTEGER,
  title         TEXT,
  description   TEXT,
  video_id      TEXT,
  video_status  TEXT DEFAULT 'uploading',  -- uploading | processing | ready | error
  duration_s    INTEGER,
  materials     TEXT,                      -- JSON: [{name,url}]
  is_core       INTEGER DEFAULT 0,
  published     INTEGER DEFAULT 0,
  created_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_order ON lessons (module, ord);

-- ─────────────── PROGRESSO ───────────────
CREATE TABLE IF NOT EXISTS progress (
  email             TEXT,
  lesson_id         INTEGER,
  completed         INTEGER DEFAULT 0,
  last_position_s   INTEGER DEFAULT 0,
  updated_at        TEXT,
  PRIMARY KEY (email, lesson_id)
);

-- ─────────────── LEDGER DE PAGAMENTOS (idempotência do webhook) ───────────────
-- Resolve o achado F-01: índice único em event_id + INSERT OR IGNORE antes de
-- qualquer efeito colateral do webhook — sem isso, um reenvio do Stripe
-- (comportamento padrão dele, não uma falha rara) gera senha nova e pode
-- emitir o cupom de bônus (§07b) mais de uma vez pela mesma compra.
CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT,
  amount      REAL,
  currency    TEXT DEFAULT 'USD',
  product     TEXT DEFAULT 'curso',
  event_id    TEXT,
  created_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_event ON payments (event_id);

-- ═══════════════════════════════════════════════════════════════════════
-- FIM. Depois de rodar, confira com:
--   SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- Devem aparecer: enrollment_events, enrollments, lessons, modules,
--   payments, progress, students.
-- ═══════════════════════════════════════════════════════════════════════
