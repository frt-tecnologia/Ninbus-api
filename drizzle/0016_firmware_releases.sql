CREATE TABLE "firmware_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hawkbit_sm_id" integer NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"artifact_type" text NOT NULL,
	"description" text,
	"original_filename" text,
	"payload_size" integer,
	"package_size" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firmware_releases_description_length_check" CHECK ("firmware_releases"."description" IS NULL OR char_length("firmware_releases"."description") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "firmware_version" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "controller_firmware_version" text;--> statement-breakpoint
ALTER TABLE "firmware_releases" ADD CONSTRAINT "firmware_releases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_firmware_releases_hawkbit_sm_id" ON "firmware_releases" USING btree ("hawkbit_sm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_firmware_releases_type_version" ON "firmware_releases" USING btree ("artifact_type","version");--> statement-breakpoint
CREATE INDEX "idx_firmware_releases_type_created" ON "firmware_releases" USING btree ("artifact_type","created_at");