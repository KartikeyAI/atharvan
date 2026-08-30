CREATE TYPE "public"."model_catalogue_lifecycle" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."model_data_classification" AS ENUM('public', 'internal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."model_kind" AS ENUM('generation', 'embedding');--> statement-breakpoint
CREATE TYPE "public"."model_provider_adapter_kind" AS ENUM('openai', 'anthropic', 'google', 'azure_openai', 'openai_compatible', 'self_hosted');--> statement-breakpoint
CREATE TYPE "public"."model_provider_health_source" AS ENUM('operator_probe');--> statement-breakpoint
CREATE TYPE "public"."model_provider_health_status" AS ENUM('healthy', 'degraded', 'unavailable');--> statement-breakpoint
CREATE TABLE "model_provider_health_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"status" "model_provider_health_status" NOT NULL,
	"source" "model_provider_health_source" NOT NULL,
	"latency_ms" integer,
	"http_status_code" integer,
	"error_code" text,
	"recorded_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_health_latency_bounds" CHECK ("model_provider_health_observations"."latency_ms" IS NULL OR "model_provider_health_observations"."latency_ms" BETWEEN 0 AND 120000),
	CONSTRAINT "model_provider_health_http_status_bounds" CHECK ("model_provider_health_observations"."http_status_code" IS NULL OR "model_provider_health_observations"."http_status_code" BETWEEN 100 AND 599),
	CONSTRAINT "model_provider_health_error_code_shape" CHECK ("model_provider_health_observations"."error_code" IS NULL OR "model_provider_health_observations"."error_code" ~ '^[a-z][a-z0-9_.-]{1,95}$'),
	CONSTRAINT "model_provider_health_healthy_has_no_error" CHECK ("model_provider_health_observations"."status" <> 'healthy' OR "model_provider_health_observations"."error_code" IS NULL),
	CONSTRAINT "model_provider_health_expiry_after_observation" CHECK ("model_provider_health_observations"."expires_at" > "model_provider_health_observations"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "model_provider_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"adapter_kind" "model_provider_adapter_kind" NOT NULL,
	"base_url" text,
	"credential_reference_id" uuid,
	"regions" text[] NOT NULL,
	"maximum_data_classification" "model_data_classification" NOT NULL,
	"lifecycle" "model_catalogue_lifecycle" NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_revisions_number_positive" CHECK ("model_provider_revisions"."revision_number" > 0),
	CONSTRAINT "model_provider_revisions_name_nonempty" CHECK (length(btrim("model_provider_revisions"."display_name")) BETWEEN 2 AND 120),
	CONSTRAINT "model_provider_revisions_regions_nonempty" CHECK (cardinality("model_provider_revisions"."regions") BETWEEN 1 AND 32),
	CONSTRAINT "model_provider_revisions_base_url_https" CHECK ("model_provider_revisions"."base_url" IS NULL OR "model_provider_revisions"."base_url" ~ '^https://[^[:space:]@]+$')
);
--> statement-breakpoint
CREATE TABLE "model_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_providers_key_normalized" CHECK ("model_providers"."key" = lower("model_providers"."key") AND "model_providers"."key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "model_providers_revision_positive" CHECK ("model_providers"."current_revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "model_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"model_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"kind" "model_kind" NOT NULL,
	"capabilities" text[] NOT NULL,
	"context_window_tokens" integer NOT NULL,
	"maximum_output_tokens" integer,
	"input_price_microunits_per_million" bigint NOT NULL,
	"output_price_microunits_per_million" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"regions" text[] NOT NULL,
	"maximum_data_classification" "model_data_classification" NOT NULL,
	"lifecycle" "model_catalogue_lifecycle" NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_revisions_number_positive" CHECK ("model_revisions"."revision_number" > 0),
	CONSTRAINT "model_revisions_name_nonempty" CHECK (length(btrim("model_revisions"."display_name")) BETWEEN 2 AND 120),
	CONSTRAINT "model_revisions_capabilities_nonempty" CHECK (cardinality("model_revisions"."capabilities") > 0),
	CONSTRAINT "model_revisions_regions_nonempty" CHECK (cardinality("model_revisions"."regions") BETWEEN 1 AND 32),
	CONSTRAINT "model_revisions_token_bounds" CHECK ("model_revisions"."context_window_tokens" > 0 AND (("model_revisions"."kind" = 'generation' AND "model_revisions"."maximum_output_tokens" > 0) OR ("model_revisions"."kind" = 'embedding' AND "model_revisions"."maximum_output_tokens" IS NULL))),
	CONSTRAINT "model_revisions_price_nonnegative" CHECK ("model_revisions"."input_price_microunits_per_million" >= 0 AND "model_revisions"."output_price_microunits_per_million" >= 0),
	CONSTRAINT "model_revisions_currency_usd" CHECK ("model_revisions"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_key_shape" CHECK ("models"."key" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
	CONSTRAINT "models_revision_positive" CHECK ("models"."current_revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "model_provider_health_observations" ADD CONSTRAINT "model_provider_health_observations_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_health_observations" ADD CONSTRAINT "model_provider_health_observations_recorded_by_operator_id_operators_id_fk" FOREIGN KEY ("recorded_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_revisions" ADD CONSTRAINT "model_provider_revisions_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_revisions" ADD CONSTRAINT "model_provider_revisions_credential_reference_id_platform_secret_references_id_fk" FOREIGN KEY ("credential_reference_id") REFERENCES "public"."platform_secret_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_revisions" ADD CONSTRAINT "model_provider_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD CONSTRAINT "model_revisions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD CONSTRAINT "model_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_health_correlation_unique" ON "model_provider_health_observations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "model_provider_health_provider_observed_idx" ON "model_provider_health_observations" USING btree ("provider_id","observed_at");--> statement-breakpoint
CREATE INDEX "model_provider_health_expiry_idx" ON "model_provider_health_observations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_revisions_number_unique" ON "model_provider_revisions" USING btree ("provider_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_revisions_correlation_unique" ON "model_provider_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "model_provider_revisions_provider_created_idx" ON "model_provider_revisions" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "model_provider_revisions_credential_reference_idx" ON "model_provider_revisions" USING btree ("credential_reference_id") WHERE "model_provider_revisions"."credential_reference_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_providers_key_environment_unique" ON "model_providers" USING btree ("key","environment");--> statement-breakpoint
CREATE INDEX "model_providers_environment_updated_idx" ON "model_providers" USING btree ("environment","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_revisions_number_unique" ON "model_revisions" USING btree ("model_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "model_revisions_correlation_unique" ON "model_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "model_revisions_model_created_idx" ON "model_revisions" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_key_unique" ON "models" USING btree ("provider_id","key");--> statement-breakpoint
CREATE INDEX "models_provider_updated_idx" ON "models" USING btree ("provider_id","updated_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_model_catalogue_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'model catalogue history cannot be mutated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "model_provider_revisions_immutable"
BEFORE UPDATE OR DELETE ON "model_provider_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_catalogue_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_revisions_immutable"
BEFORE UPDATE OR DELETE ON "model_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_catalogue_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_provider_health_observations_immutable"
BEFORE UPDATE OR DELETE ON "model_provider_health_observations"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_catalogue_history_mutation"();
