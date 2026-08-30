-- Rode somente no D1: blackwolf-course-leads
-- Ficha única progressiva: amplia o cadastro já existente sem apagar ou
-- duplicar nenhuma pessoa. Cada ALTER deve retornar sucesso uma única vez.
ALTER TABLE course_leads ADD COLUMN email_marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (email_marketing_consent IN (0, 1));
ALTER TABLE course_leads ADD COLUMN interest TEXT NOT NULL DEFAULT 'undecided' CHECK (interest IN ('course', 'ea', 'both', 'undecided'));
ALTER TABLE course_leads ADD COLUMN experience_level TEXT NOT NULL DEFAULT 'not_informed' CHECK (experience_level IN ('beginner', 'intermediate', 'advanced', 'not_informed'));
CREATE INDEX IF NOT EXISTS idx_course_leads_interest ON course_leads (interest, status, created_at DESC);
