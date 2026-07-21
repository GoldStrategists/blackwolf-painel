-- ═══════════════════════════════════════════════════════════════════════
-- Black Wolf — Esquema AUTORITATIVO do banco (Cloudflare D1 / SQLite)
-- ═══════════════════════════════════════════════════════════════════════
-- Fonte única de verdade do banco. Reconstruído a partir de TODAS as queries
-- do worker (backend/worker.js). É IDEMPOTENTE: pode rodar quantas vezes quiser
-- no Console do D1 sem apagar dados — só cria o que estiver faltando.
--
-- ⚠️ POR QUE ISSO IMPORTA: o POST /api/ea/trades grava tudo num único
-- env.DB.batch (atômico). Ele usa cláusulas ON CONFLICT(license_key) e
-- ON CONFLICT(license_key, account). Se qualquer uma destas tabelas NÃO existir,
-- ou existir SEM a chave única/primária correspondente, o batch INTEIRO falha e
-- o robô recebe 503 — NENHUM dado é gravado (nem trade, nem saldo, nem status).
-- Rodar este arquivo garante que o esquema bate exatamente com o que o código
-- espera.
--
-- Como rodar: Cloudflare → Workers & Pages → D1 → blackwolf-db → Console →
-- cole tudo → Run. (Faça um backup/export antes, por segurança.)
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────── USUÁRIOS / LICENÇAS ───────────────
CREATE TABLE IF NOT EXISTS users (
  email               TEXT PRIMARY KEY,
  password_hash       TEXT,
  salt                TEXT,
  name                TEXT,
  role                TEXT DEFAULT 'client',
  lang                TEXT DEFAULT 'pt',
  plan                TEXT,
  license_key         TEXT,
  license_status      TEXT,
  license_expires_at  TEXT,
  account_limit       INTEGER,
  monthly_amount      REAL,
  is_courtesy         INTEGER DEFAULT 0,
  stripe_customer     TEXT,
  mt5_account         TEXT,
  mt5_accounts        TEXT,
  ea_config           TEXT,
  ea_config_version   INTEGER,
  results_source      TEXT,
  display_name        TEXT,
  photo               TEXT,
  phone               TEXT,
  whatsapp            TEXT,
  country             TEXT,
  city                TEXT,
  last_login          TEXT,
  prev_login          TEXT,
  created_at          TEXT
);
-- Guardas para bancos ANTIGOS (a tabela já existe mas pode faltar coluna).
-- Se a coluna já existir, o D1 devolve "duplicate column name" — pode ignorar.
ALTER TABLE users ADD COLUMN monthly_amount     REAL;
ALTER TABLE users ADD COLUMN is_courtesy        INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN license_expires_at TEXT;
ALTER TABLE users ADD COLUMN account_limit      INTEGER;
ALTER TABLE users ADD COLUMN stripe_customer    TEXT;
ALTER TABLE users ADD COLUMN mt5_account        TEXT;
ALTER TABLE users ADD COLUMN mt5_accounts       TEXT;
ALTER TABLE users ADD COLUMN ea_config          TEXT;
ALTER TABLE users ADD COLUMN ea_config_version  INTEGER;
ALTER TABLE users ADD COLUMN results_source     TEXT;
ALTER TABLE users ADD COLUMN display_name       TEXT;
ALTER TABLE users ADD COLUMN photo              TEXT;
ALTER TABLE users ADD COLUMN phone              TEXT;
ALTER TABLE users ADD COLUMN whatsapp           TEXT;
ALTER TABLE users ADD COLUMN last_login         TEXT;
ALTER TABLE users ADD COLUMN prev_login         TEXT;
CREATE INDEX IF NOT EXISTS idx_users_license ON users (license_key);
CREATE INDEX IF NOT EXISTS idx_users_stripe  ON users (stripe_customer);

-- ─────────────── QUESTIONÁRIO (ONBOARDING) ───────────────
-- ON CONFLICT(email) → email precisa ser PRIMARY KEY.
CREATE TABLE IF NOT EXISTS onboarding (
  email             TEXT PRIMARY KEY,
  age               TEXT,
  experience        TEXT,
  goal              TEXT,
  self_profile      TEXT,
  family            TEXT,
  source            TEXT,
  country           TEXT,
  state             TEXT,
  city              TEXT,
  marketing_opt_in  INTEGER DEFAULT 0,
  created_at        TEXT
);

-- ─────────────── TRADES FECHADOS (resultado real) ───────────────
-- INSERT OR IGNORE dedupe por (license_key, account, ticket) → precisa do índice único.
CREATE TABLE IF NOT EXISTS trades (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key  TEXT,
  email        TEXT,
  account      TEXT,
  ticket       TEXT,
  symbol       TEXT,
  type         TEXT,
  lots         REAL,
  open_time    TEXT,
  close_time   TEXT,
  open_price   REAL,
  close_price  REAL,
  profit       REAL,
  commission   REAL,
  swap         REAL,
  created_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_dedupe ON trades (license_key, account, ticket);
CREATE INDEX IF NOT EXISTS idx_trades_email ON trades (email);
CREATE INDEX IF NOT EXISTS idx_trades_close ON trades (close_time);

-- ─────────────── STATUS DO ROBÔ (1 linha por licença) ───────────────
-- ON CONFLICT(license_key) → license_key precisa ser PRIMARY KEY.
CREATE TABLE IF NOT EXISTS ea_status (
  license_key     TEXT PRIMARY KEY,
  email           TEXT,
  account         TEXT,
  balance         REAL,
  equity          REAL,
  open_positions  INTEGER,
  ea_version      TEXT,
  last_seen       TEXT,
  last_error      TEXT
);

-- ─────────────── STATUS DO ROBÔ POR CONTA (multi-conta) ───────────────
-- ON CONFLICT(license_key, account) → precisa da chave primária composta.
CREATE TABLE IF NOT EXISTS ea_status_acc (
  license_key     TEXT,
  account         TEXT,
  email           TEXT,
  balance         REAL,
  equity          REAL,
  open_positions  INTEGER,
  ea_version      TEXT,
  last_seen       TEXT,
  last_error      TEXT,
  PRIMARY KEY (license_key, account)
);
CREATE INDEX IF NOT EXISTS idx_easacc_email ON ea_status_acc (email);

-- ─────────────── SÉRIE DE SALDO (evolução) ───────────────
CREATE TABLE IF NOT EXISTS balance_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key  TEXT,
  account      TEXT,
  email        TEXT,
  balance      REAL,
  equity       REAL,
  ts           TEXT
);
CREATE INDEX IF NOT EXISTS idx_balhist_email ON balance_history (email, ts);

-- ─────────────── TRAVA 1 LICENÇA = N CONTAS ───────────────
-- ON CONFLICT(license_key, account) → precisa da chave primária composta.
CREATE TABLE IF NOT EXISTS license_accounts (
  license_key  TEXT,
  account      TEXT,
  email        TEXT,
  bound_at     TEXT,
  PRIMARY KEY (license_key, account)
);

-- ─────────────── AUDITORIA (opcionais, mas o código grava) ───────────────
CREATE TABLE IF NOT EXISTS license_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT,
  actor        TEXT,
  from_status  TEXT,
  to_status    TEXT,
  reason       TEXT,
  created_at   TEXT
);
CREATE TABLE IF NOT EXISTS config_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT,
  target       TEXT,
  account      TEXT,
  config_json  TEXT,
  created_at   TEXT
);

-- ═══════════════════════════════════════════════════════════════════════
-- FIM. Depois de rodar, confira com:
--   SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- Devem aparecer: balance_history, config_log, ea_status, ea_status_acc,
--   license_accounts, license_events, onboarding, trades, users.
-- ═══════════════════════════════════════════════════════════════════════
