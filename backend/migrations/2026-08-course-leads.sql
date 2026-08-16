-- Rode somente no D1: blackwolf-course-leads
CREATE TABLE IF NOT EXISTS course_leads (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  whatsapp           TEXT NOT NULL,
  whatsapp_consent   INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_consent IN (0, 1)),
  consent_at         TEXT NOT NULL,
  source             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'group', 'closed')),
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_course_leads_status ON course_leads (status, created_at DESC);
