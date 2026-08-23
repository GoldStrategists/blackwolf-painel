-- Rode no D1: blackwolf-db
-- Os comprovantes não entram no D1: este banco guarda somente os metadados.
-- O binário fica privado no bucket R2 blackwolf-withdrawal-proofs.
CREATE TABLE IF NOT EXISTS withdrawal_submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL,
  account         TEXT,
  amount          REAL NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  withdrawal_date TEXT NOT NULL,
  reference       TEXT,
  file_key        TEXT NOT NULL UNIQUE,
  file_name       TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'submitted',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_email_created ON withdrawal_submissions (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created ON withdrawal_submissions (created_at DESC);
