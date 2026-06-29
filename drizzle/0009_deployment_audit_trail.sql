-- Deployment audit trail: capture artifact + target data at deployment time
-- so deployments remain visible after artifact deletion.
ALTER TABLE "deployments" ADD COLUMN "artifact_name" text;
ALTER TABLE "deployments" ADD COLUMN "artifact_version" text;
ALTER TABLE "deployments" ADD COLUMN "artifact_original_file" text;
ALTER TABLE "deployments" ADD COLUMN "target_count" integer DEFAULT 0;
ALTER TABLE "deployments" ADD COLUMN "target_ids" text DEFAULT '[]';
