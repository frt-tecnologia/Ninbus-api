ALTER TYPE "public"."activity_action" ADD VALUE 'firmware.artifact_downloaded';--> statement-breakpoint
ALTER TABLE "firmware_releases" ADD COLUMN "manifest_version" integer;--> statement-breakpoint
ALTER TABLE "firmware_releases" ADD COLUMN "manifest_flags" integer;--> statement-breakpoint
ALTER TABLE "firmware_releases" ADD COLUMN "gate" jsonb;--> statement-breakpoint
ALTER TABLE "firmware_releases" ADD COLUMN "gate_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "devices_company_id_idx" ON "devices" USING btree ("company_id");