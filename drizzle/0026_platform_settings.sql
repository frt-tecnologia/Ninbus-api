-- 0026: Platform settings KV store — runtime-editable platform configuration
-- (dashboard, super admin). First key: hawkbit_polling_time (seconds as text).
-- HAWKBIT_POLLING_TIME (.env) becomes the bootstrap default only; a row in this
-- table always wins and is re-pushed to hawkBit on API startup.

CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
