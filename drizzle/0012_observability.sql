CREATE TYPE "public"."activity_action" AS ENUM('company.created', 'company.updated', 'company.deleted', 'company.suspended', 'company.activated', 'category.created', 'category.updated', 'category.deleted', 'member.added', 'member.role_changed', 'member.removed', 'designation.created', 'designation.cancelled', 'designation.claimed', 'device.provisioned', 'device.claimed', 'device.unclaimed', 'device.deprovisioned', 'device.renamed', 'device.category_changed', 'deployment.created', 'deployment.deleted', 'artifact.uploaded', 'artifact.deleted');--> statement-breakpoint
CREATE TYPE "public"."activity_entity" AS ENUM('company', 'category', 'device', 'deployment', 'artifact', 'member', 'designation', 'user');--> statement-breakpoint
CREATE TYPE "public"."connection_event" AS ENUM('online', 'offline');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"company_id" uuid,
	"action" "activity_action" NOT NULL,
	"entity_type" "activity_entity" NOT NULL,
	"entity_id" text NOT NULL,
	"entity_label" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_connections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"hawkbit_target_id" text,
	"device_name" text,
	"event" "connection_event" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ip_address" "inet",
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_connections" ADD CONSTRAINT "device_connections_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_connections" ADD CONSTRAINT "device_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_log_company_created" ON "activity_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_entity_created" ON "activity_log" USING btree ("entity_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_actor" ON "activity_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_device_connections_company_occurred" ON "device_connections" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_device_connections_device_occurred" ON "device_connections" USING btree ("device_id","occurred_at");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;