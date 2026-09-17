CREATE TYPE "public"."firmware_release_status" AS ENUM('draft', 'published');--> statement-breakpoint
/* Pre-gate releases were already available to users — backfill as published; new rows default to draft (set below). */
ALTER TABLE "firmware_releases" ADD COLUMN "status" "firmware_release_status" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "firmware_releases" ALTER COLUMN "status" SET DEFAULT 'draft';
