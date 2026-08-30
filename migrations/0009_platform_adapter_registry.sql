CREATE TYPE "public"."platform_adapter_category" AS ENUM('language', 'framework', 'package_manager', 'build', 'test', 'database', 'deployment', 'cloud', 'source_control', 'observability', 'security', 'model', 'design_system', 'private_enterprise');--> statement-breakpoint
CREATE TYPE "public"."platform_adapter_lifecycle" AS ENUM('draft', 'active', 'deprecated', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."platform_adapter_release_channel" AS ENUM('internal', 'canary', 'beta', 'stable');--> statement-breakpoint
CREATE TYPE "public"."platform_adapter_security_review_status" AS ENUM('pending', 'approved', 'changes_required', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."platform_adapter_signature_status" AS ENUM('unverified', 'verified', 'invalid');--> statement-breakpoint
CREATE TABLE "platform_adapter_release_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"category" "platform_adapter_category" NOT NULL,
	"package_name" text NOT NULL,
	"package_digest_sha256" text NOT NULL,
	"documentation_url" text,
	"capabilities" jsonb NOT NULL,
	"declared_permissions" text[] NOT NULL,
	"configuration_fields" jsonb NOT NULL,
	"commands" jsonb NOT NULL,
	"supported_environments" text[] NOT NULL,
	"compatibility_tags" text[] NOT NULL,
	"required_secret_purposes" text[] NOT NULL,
	"health_checks" jsonb NOT NULL,
	"release_channel" "platform_adapter_release_channel" NOT NULL,
	"signature_status" "platform_adapter_signature_status" NOT NULL,
	"security_review_status" "platform_adapter_security_review_status" NOT NULL,
	"security_review_reference" text,
	"lifecycle" "platform_adapter_lifecycle" NOT NULL,
	"block_reason" text,
	"deprecated_at" timestamp with time zone,
	"sunset_at" timestamp with time zone,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_adapter_release_revisions_number_positive" CHECK ("platform_adapter_release_revisions"."revision_number" > 0),
	CONSTRAINT "platform_adapter_release_revisions_name_nonempty" CHECK (length(btrim("platform_adapter_release_revisions"."display_name")) BETWEEN 2 AND 120),
	CONSTRAINT "platform_adapter_release_revisions_package_shape" CHECK ("platform_adapter_release_revisions"."package_name" ~ '^@[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*$' AND "platform_adapter_release_revisions"."package_digest_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "platform_adapter_release_revisions_documentation_https" CHECK ("platform_adapter_release_revisions"."documentation_url" IS NULL OR "platform_adapter_release_revisions"."documentation_url" ~ '^https://[^[:space:]@]+$'),
	CONSTRAINT "platform_adapter_release_revisions_json_arrays" CHECK (jsonb_typeof("platform_adapter_release_revisions"."capabilities") = 'array' AND jsonb_array_length("platform_adapter_release_revisions"."capabilities") = 8 AND jsonb_typeof("platform_adapter_release_revisions"."configuration_fields") = 'array' AND jsonb_typeof("platform_adapter_release_revisions"."commands") = 'array' AND jsonb_typeof("platform_adapter_release_revisions"."health_checks") = 'array'),
	CONSTRAINT "platform_adapter_release_revisions_array_limits" CHECK (cardinality("platform_adapter_release_revisions"."declared_permissions") <= 64 AND cardinality("platform_adapter_release_revisions"."supported_environments") BETWEEN 1 AND 5 AND cardinality("platform_adapter_release_revisions"."compatibility_tags") <= 64 AND cardinality("platform_adapter_release_revisions"."required_secret_purposes") <= 32),
	CONSTRAINT "platform_adapter_release_revisions_activation_evidence" CHECK ("platform_adapter_release_revisions"."lifecycle" <> 'active' OR ("platform_adapter_release_revisions"."signature_status" = 'verified' AND "platform_adapter_release_revisions"."security_review_status" = 'approved' AND "platform_adapter_release_revisions"."security_review_reference" IS NOT NULL)),
	CONSTRAINT "platform_adapter_release_revisions_stable_active" CHECK ("platform_adapter_release_revisions"."release_channel" <> 'stable' OR "platform_adapter_release_revisions"."lifecycle" = 'active'),
	CONSTRAINT "platform_adapter_release_revisions_block_metadata" CHECK (("platform_adapter_release_revisions"."lifecycle" = 'blocked' AND "platform_adapter_release_revisions"."block_reason" IS NOT NULL) OR ("platform_adapter_release_revisions"."lifecycle" <> 'blocked' AND "platform_adapter_release_revisions"."block_reason" IS NULL)),
	CONSTRAINT "platform_adapter_release_revisions_unsafe_blocked" CHECK (("platform_adapter_release_revisions"."signature_status" <> 'invalid' AND "platform_adapter_release_revisions"."security_review_status" <> 'rejected') OR "platform_adapter_release_revisions"."lifecycle" = 'blocked'),
	CONSTRAINT "platform_adapter_release_revisions_deprecation_metadata" CHECK (("platform_adapter_release_revisions"."lifecycle" = 'deprecated' AND "platform_adapter_release_revisions"."deprecated_at" IS NOT NULL AND ("platform_adapter_release_revisions"."sunset_at" IS NULL OR "platform_adapter_release_revisions"."sunset_at" > "platform_adapter_release_revisions"."deprecated_at")) OR ("platform_adapter_release_revisions"."lifecycle" <> 'deprecated' AND "platform_adapter_release_revisions"."deprecated_at" IS NULL AND "platform_adapter_release_revisions"."sunset_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_adapter_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_adapter_releases_key_normalized" CHECK ("platform_adapter_releases"."key" = lower("platform_adapter_releases"."key") AND "platform_adapter_releases"."key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "platform_adapter_releases_version_shape" CHECK ("platform_adapter_releases"."version" ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
	CONSTRAINT "platform_adapter_releases_revision_positive" CHECK ("platform_adapter_releases"."current_revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "platform_adapter_release_revisions" ADD CONSTRAINT "platform_adapter_release_revisions_release_id_platform_adapter_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."platform_adapter_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_adapter_release_revisions" ADD CONSTRAINT "platform_adapter_release_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_adapter_release_revisions_number_unique" ON "platform_adapter_release_revisions" USING btree ("release_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_adapter_release_revisions_correlation_unique" ON "platform_adapter_release_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "platform_adapter_release_revisions_release_created_idx" ON "platform_adapter_release_revisions" USING btree ("release_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_adapter_release_revisions_lifecycle_idx" ON "platform_adapter_release_revisions" USING btree ("lifecycle","release_channel");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_adapter_releases_identity_unique" ON "platform_adapter_releases" USING btree ("key","version","environment");--> statement-breakpoint
CREATE INDEX "platform_adapter_releases_environment_updated_idx" ON "platform_adapter_releases" USING btree ("environment","updated_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_platform_adapter_revision_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform adapter release history cannot be mutated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "enforce_platform_adapter_artifact_identity"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "platform_adapter_release_revisions" existing
    WHERE existing."release_id" = NEW."release_id"
      AND (
        existing."package_name" <> NEW."package_name"
        OR existing."package_digest_sha256" <> NEW."package_digest_sha256"
      )
  ) THEN
    RAISE EXCEPTION 'adapter package identity and digest are immutable for a release version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "platform_adapter_release_revisions_artifact_identity"
BEFORE INSERT ON "platform_adapter_release_revisions"
FOR EACH ROW EXECUTE FUNCTION "enforce_platform_adapter_artifact_identity"();
--> statement-breakpoint
CREATE TRIGGER "platform_adapter_release_revisions_immutable"
BEFORE UPDATE OR DELETE ON "platform_adapter_release_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_adapter_revision_mutation"();
