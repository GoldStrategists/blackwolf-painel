-- Black Wolf Trading Floor — esquema inicial.
-- Dados DEMO nunca são gravados nas tabelas financeiras (executions, equity_points,
-- activity_events): o simulador vive só em memória. Apenas a configuração (salas,
-- nomes, regras) é persistida com mode = 'demo' para permitir testar a organização.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS ingest_tokens (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('nt8', 'robot')),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rooms (
  mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
  id   TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mode, id)
);

CREATE TABLE IF NOT EXISTS accounts (
  mode             TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
  id               TEXT NOT NULL,
  name             TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  desk_index       INTEGER NOT NULL DEFAULT 0,
  platform         TEXT NOT NULL,
  provider         TEXT,
  connection_name  TEXT,
  firm             TEXT,
  plan             TEXT,
  nominal_size     NUMERIC(18,2),
  starting_balance NUMERIC(18,2),
  rule             JSONB NOT NULL,
  risk_state       JSONB NOT NULL,
  hidden           BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, id)
);

CREATE TABLE IF NOT EXISTS executions (
  account_id TEXT NOT NULL,
  exec_id    TEXT NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  instrument TEXT NOT NULL,
  side       TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity   INTEGER NOT NULL,
  price      DOUBLE PRECISION NOT NULL,
  order_id   TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, exec_id)
);
CREATE INDEX IF NOT EXISTS executions_ts_idx ON executions(account_id, ts);

CREATE TABLE IF NOT EXISTS equity_points (
  account_id TEXT NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  balance    DOUBLE PRECISION,
  equity     DOUBLE PRECISION,
  realized   DOUBLE PRECISION,
  unrealized DOUBLE PRECISION,
  PRIMARY KEY (account_id, ts)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id          TEXT PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL,
  kind        TEXT NOT NULL,
  type        TEXT NOT NULL,
  account_id  TEXT,
  severity    TEXT NOT NULL,
  message     TEXT NOT NULL,
  confirmed   BOOLEAN NOT NULL DEFAULT false,
  correlated_execution_id TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS activity_events_ts_idx ON activity_events(ts DESC);
CREATE INDEX IF NOT EXISTS activity_events_account_idx ON activity_events(account_id, ts DESC);
