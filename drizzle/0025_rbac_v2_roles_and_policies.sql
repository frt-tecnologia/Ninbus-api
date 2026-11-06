-- 0025: RBAC v2 — company role rename + per-company permission overrides.
-- admin→manager, viewer→observer (docs/rbac-roles-and-permissions.md).
-- RENAME VALUE rewrites existing rows in place; defaults are re-declared after.

ALTER TYPE "public"."company_role" RENAME VALUE 'admin' TO 'manager';--> statement-breakpoint
ALTER TYPE "public"."company_role" RENAME VALUE 'viewer' TO 'observer';--> statement-breakpoint
ALTER TABLE "company_members" ALTER COLUMN "role" SET DEFAULT 'observer';--> statement-breakpoint
ALTER TABLE "pending_company_members" ALTER COLUMN "role" SET DEFAULT 'observer';--> statement-breakpoint
CREATE TABLE "company_role_policies" (
	"company_id" uuid NOT NULL,
	"role" "company_role" NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_role_policies_company_id_role_pk" PRIMARY KEY("company_id","role")
);--> statement-breakpoint
ALTER TABLE "company_role_policies" ADD CONSTRAINT "company_role_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_role_policies" ADD CONSTRAINT "company_role_policies_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
