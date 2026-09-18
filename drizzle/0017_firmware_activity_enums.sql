ALTER TYPE "public"."activity_action" ADD VALUE 'firmware.published';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'firmware.deleted';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'firmware_release' BEFORE 'member';