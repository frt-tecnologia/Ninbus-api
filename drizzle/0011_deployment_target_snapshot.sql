-- Per-target status snapshot — preserves deployment history when hawkBit
-- drops cancelled/superseded actions. See deployments.targetStatusSnapshot docs.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS target_status_snapshot JSONB DEFAULT '{}'::jsonb;
