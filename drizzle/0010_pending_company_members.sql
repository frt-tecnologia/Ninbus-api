CREATE TABLE IF NOT EXISTS pending_company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role company_role NOT NULL,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  claimed_at TIMESTAMP,
  claimed_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_members_company_email ON pending_company_members(company_id, email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pending_members_email ON pending_company_members(email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pending_members_claimed_at ON pending_company_members(claimed_at);
