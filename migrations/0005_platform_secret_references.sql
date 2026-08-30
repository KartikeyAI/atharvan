CREATE TYPE "public"."platform_secret_provider" AS ENUM('cloudflare_secrets_store');--> statement-breakpoint
CREATE TYPE "public"."platform_secret_reference_status" AS ENUM('provisioning', 'active', 'provisioning_failed', 'rotating', 'rotation_failed', 'revoking', 'revocation_failed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."platform_secret_version_status" AS ENUM('pending', 'active', 'retired', 'failed');--> statement-breakpoint
CREATE TABLE "platform_secret_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"purpose" text NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"provider" "platform_secret_provider" NOT NULL,
	"provider_name" text NOT NULL,
	"provider_secret_id" text,
	"status" "platform_secret_reference_status" DEFAULT 'provisioning' NOT NULL,
	"current_version_number" integer,
	"created_by_operator_id" uuid NOT NULL,
	"revoked_by_operator_id" uuid,
	"revoked_reason" text,
	"revoked_correlation_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_secret_references_key_normalized" CHECK ("platform_secret_references"."key" = lower("platform_secret_references"."key") AND "platform_secret_references"."key" ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'),
	CONSTRAINT "platform_secret_references_no_value_columns" CHECK ("platform_secret_references"."provider_name" <> '' AND "platform_secret_references"."purpose" <> ''),
	CONSTRAINT "platform_secret_references_active_metadata" CHECK ("platform_secret_references"."status" NOT IN ('active', 'rotating', 'rotation_failed', 'revoking', 'revocation_failed', 'revoked') OR ("platform_secret_references"."provider_secret_id" IS NOT NULL AND "platform_secret_references"."current_version_number" IS NOT NULL AND "platform_secret_references"."current_version_number" > 0)),
	CONSTRAINT "platform_secret_references_revocation_metadata" CHECK (("platform_secret_references"."status" = 'revoked' AND "platform_secret_references"."revoked_at" IS NOT NULL AND "platform_secret_references"."revoked_by_operator_id" IS NOT NULL AND "platform_secret_references"."revoked_reason" IS NOT NULL AND "platform_secret_references"."revoked_correlation_id" IS NOT NULL) OR ("platform_secret_references"."status" <> 'revoked' AND "platform_secret_references"."revoked_at" IS NULL AND "platform_secret_references"."revoked_by_operator_id" IS NULL AND "platform_secret_references"."revoked_reason" IS NULL AND "platform_secret_references"."revoked_correlation_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_secret_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "platform_secret_version_status" DEFAULT 'pending' NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "platform_secret_versions_number_positive" CHECK ("platform_secret_versions"."version_number" > 0),
	CONSTRAINT "platform_secret_versions_terminal_metadata" CHECK (("platform_secret_versions"."status" = 'pending' AND "platform_secret_versions"."activated_at" IS NULL AND "platform_secret_versions"."retired_at" IS NULL AND "platform_secret_versions"."failed_at" IS NULL) OR ("platform_secret_versions"."status" = 'active' AND "platform_secret_versions"."activated_at" IS NOT NULL AND "platform_secret_versions"."retired_at" IS NULL AND "platform_secret_versions"."failed_at" IS NULL) OR ("platform_secret_versions"."status" = 'retired' AND "platform_secret_versions"."activated_at" IS NOT NULL AND "platform_secret_versions"."retired_at" IS NOT NULL AND "platform_secret_versions"."failed_at" IS NULL) OR ("platform_secret_versions"."status" = 'failed' AND "platform_secret_versions"."activated_at" IS NULL AND "platform_secret_versions"."retired_at" IS NULL AND "platform_secret_versions"."failed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_secret_references" ADD CONSTRAINT "platform_secret_references_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_secret_references" ADD CONSTRAINT "platform_secret_references_revoked_by_operator_id_operators_id_fk" FOREIGN KEY ("revoked_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_secret_versions" ADD CONSTRAINT "platform_secret_versions_reference_id_platform_secret_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."platform_secret_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_secret_versions" ADD CONSTRAINT "platform_secret_versions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_references_key_environment_unique" ON "platform_secret_references" USING btree ("key","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_references_provider_name_unique" ON "platform_secret_references" USING btree ("provider","provider_name");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_references_provider_id_unique" ON "platform_secret_references" USING btree ("provider","provider_secret_id") WHERE "platform_secret_references"."provider_secret_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_secret_references_status_idx" ON "platform_secret_references" USING btree ("environment","status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_versions_number_unique" ON "platform_secret_versions" USING btree ("reference_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_versions_correlation_unique" ON "platform_secret_versions" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_versions_one_active" ON "platform_secret_versions" USING btree ("reference_id") WHERE "platform_secret_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_secret_versions_one_pending" ON "platform_secret_versions" USING btree ("reference_id") WHERE "platform_secret_versions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "platform_secret_versions_reference_created_idx" ON "platform_secret_versions" USING btree ("reference_id","created_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_platform_secret_metadata_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform secret lifecycle metadata cannot be deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "platform_secret_references_no_delete"
BEFORE DELETE ON "platform_secret_references"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_secret_metadata_delete"();
--> statement-breakpoint
CREATE TRIGGER "platform_secret_versions_no_delete"
BEFORE DELETE ON "platform_secret_versions"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_secret_metadata_delete"();
