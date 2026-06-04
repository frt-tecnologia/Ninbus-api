-- Create artifacts table (tenant isolation for hawkBit Software Modules)
CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  hawkbit_sm_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  description TEXT,
  original_filename TEXT,
  payload_size INTEGER,
  package_size INTEGER,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_hawkbit_sm_id ON artifacts(hawkbit_sm_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_company_id ON artifacts(company_id);

-- Create deployments table (tenant isolation for hawkBit Distribution Sets)
CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  hawkbit_ds_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_hawkbit_ds_id ON deployments(hawkbit_ds_id);
CREATE INDEX IF NOT EXISTS idx_deployments_company_id ON deployments(company_id);
