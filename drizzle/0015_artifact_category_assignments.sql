CREATE TABLE "artifact_category_assignments" (
	"artifact_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_category_assignments_artifact_id_category_id_pk" PRIMARY KEY("artifact_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "artifact_category_assignments" ADD CONSTRAINT "artifact_category_assignments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_category_assignments" ADD CONSTRAINT "artifact_category_assignments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artifact_category_category" ON "artifact_category_assignments" USING btree ("category_id");