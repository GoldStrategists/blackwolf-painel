-- Rode somente no D1: blackwolf-course-bonus
CREATE TABLE IF NOT EXISTS course_ea_bonus (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_session_id TEXT NOT NULL UNIQUE,
  email               TEXT NOT NULL UNIQUE,
  stripe_customer     TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'redeemed', 'revoked')),
  eligible_at         TEXT NOT NULL,
  redeemed_at         TEXT,
  redeemed_by         TEXT
);
CREATE INDEX IF NOT EXISTS idx_course_bonus_status ON course_ea_bonus (status, eligible_at DESC);
