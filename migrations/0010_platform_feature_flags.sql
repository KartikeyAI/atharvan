CREATE TYPE "public"."platform_feature_flag_lifecycle" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "platform_feature_flag_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flag_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"purpose" text NOT NULL,
	"owner_operator_id" uuid NOT NULL,
	"lifecycle" "platform_feature_flag_lifecycle" NOT NULL,
	"default_enabled" boolean NOT NULL,
	"emergency_disabled" boolean NOT NULL,
	"rules" jsonb NOT NULL,
	"review_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_feature_flag_revisions_number_positive" CHECK ("platform_feature_flag_revisions"."revision_number" > 0),
	CONSTRAINT "platform_feature_flag_revisions_name_nonempty" CHECK (length(btrim("platform_feature_flag_revisions"."display_name")) BETWEEN 2 AND 120),
	CONSTRAINT "platform_feature_flag_revisions_purpose_nonempty" CHECK (length(btrim("platform_feature_flag_revisions"."purpose")) BETWEEN 8 AND 500),
	CONSTRAINT "platform_feature_flag_revisions_rules_array" CHECK (jsonb_typeof("platform_feature_flag_revisions"."rules") = 'array' AND jsonb_array_length("platform_feature_flag_revisions"."rules") <= 50),
	CONSTRAINT "platform_feature_flag_revisions_expiry_after_review" CHECK ("platform_feature_flag_revisions"."expires_at" IS NULL OR "platform_feature_flag_revisions"."expires_at" > "platform_feature_flag_revisions"."review_at")
);
--> statement-breakpoint
CREATE TABLE "platform_feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_feature_flags_key_normalized" CHECK ("platform_feature_flags"."key" = lower("platform_feature_flags"."key") AND "platform_feature_flags"."key" ~ '^[a-z][a-z0-9_.-]{2,95}$'),
	CONSTRAINT "platform_feature_flags_revision_positive" CHECK ("platform_feature_flags"."current_revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "platform_feature_flag_revisions" ADD CONSTRAINT "platform_feature_flag_revisions_flag_id_platform_feature_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."platform_feature_flags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_feature_flag_revisions" ADD CONSTRAINT "platform_feature_flag_revisions_owner_operator_id_operators_id_fk" FOREIGN KEY ("owner_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_feature_flag_revisions" ADD CONSTRAINT "platform_feature_flag_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_feature_flag_revisions_number_unique" ON "platform_feature_flag_revisions" USING btree ("flag_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_feature_flag_revisions_correlation_unique" ON "platform_feature_flag_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "platform_feature_flag_revisions_flag_created_idx" ON "platform_feature_flag_revisions" USING btree ("flag_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_feature_flag_revisions_review_idx" ON "platform_feature_flag_revisions" USING btree ("lifecycle","review_at","expires_at");--> statement-breakpoint
CREATE INDEX "platform_feature_flag_revisions_owner_idx" ON "platform_feature_flag_revisions" USING btree ("owner_operator_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_feature_flags_key_environment_unique" ON "platform_feature_flags" USING btree ("key","environment");--> statement-breakpoint
CREATE INDEX "platform_feature_flags_environment_updated_idx" ON "platform_feature_flags" USING btree ("environment","updated_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_platform_feature_flag_revision_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform feature flag history cannot be mutated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "platform_feature_flag_revisions_immutable"
BEFORE UPDATE OR DELETE ON "platform_feature_flag_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_feature_flag_revision_mutation"();
