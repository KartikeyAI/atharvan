CREATE TYPE "public"."platform_integration_connection_mode" AS ENUM('direct', 'managed', 'claimable');--> statement-breakpoint
CREATE TYPE "public"."platform_integration_health_source" AS ENUM('operator_probe');--> statement-breakpoint
CREATE TYPE "public"."platform_integration_health_status" AS ENUM('healthy', 'degraded', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."platform_integration_lifecycle" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."platform_integration_operational_state" AS ENUM('enabled', 'maintenance', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."platform_integration_protocol" AS ENUM('oauth2', 'api_key', 'service_account', 'webhook');--> statement-breakpoint
CREATE TABLE "platform_integration_health_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"status" "platform_integration_health_status" NOT NULL,
	"source" "platform_integration_health_source" NOT NULL,
	"latency_ms" integer,
	"http_status_code" integer,
	"error_code" text,
	"recorded_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_integration_health_latency_bounds" CHECK ("platform_integration_health_observations"."latency_ms" IS NULL OR "platform_integration_health_observations"."latency_ms" BETWEEN 0 AND 120000),
	CONSTRAINT "platform_integration_health_http_status_bounds" CHECK ("platform_integration_health_observations"."http_status_code" IS NULL OR "platform_integration_health_observations"."http_status_code" BETWEEN 100 AND 599),
	CONSTRAINT "platform_integration_health_error_code_shape" CHECK ("platform_integration_health_observations"."error_code" IS NULL OR "platform_integration_health_observations"."error_code" ~ '^[a-z][a-z0-9_.-]{1,95}$'),
	CONSTRAINT "platform_integration_health_healthy_has_no_error" CHECK ("platform_integration_health_observations"."status" <> 'healthy' OR "platform_integration_health_observations"."error_code" IS NULL),
	CONSTRAINT "platform_integration_health_expiry_after_observation" CHECK ("platform_integration_health_observations"."expires_at" > "platform_integration_health_observations"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "platform_integration_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"protocol" "platform_integration_protocol" NOT NULL,
	"connection_mode" "platform_integration_connection_mode" NOT NULL,
	"capabilities" text[] NOT NULL,
	"adapter_package" text NOT NULL,
	"adapter_version" text NOT NULL,
	"documentation_url" text,
	"authorization_url" text,
	"token_url" text,
	"client_id" text,
	"client_secret_reference_id" uuid,
	"webhook_secret_reference_id" uuid,
	"callback_urls" text[] NOT NULL,
	"required_scopes" text[] NOT NULL,
	"optional_scopes" text[] NOT NULL,
	"lifecycle" "platform_integration_lifecycle" NOT NULL,
	"operational_state" "platform_integration_operational_state" NOT NULL,
	"maintenance_expires_at" timestamp with time zone,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_integration_revisions_number_positive" CHECK ("platform_integration_revisions"."revision_number" > 0),
	CONSTRAINT "platform_integration_revisions_name_nonempty" CHECK (length(btrim("platform_integration_revisions"."display_name")) BETWEEN 2 AND 120),
	CONSTRAINT "platform_integration_revisions_capabilities_nonempty" CHECK (cardinality("platform_integration_revisions"."capabilities") BETWEEN 1 AND 16),
	CONSTRAINT "platform_integration_revisions_callback_limit" CHECK (cardinality("platform_integration_revisions"."callback_urls") <= 16),
	CONSTRAINT "platform_integration_revisions_scope_limit" CHECK (cardinality("platform_integration_revisions"."required_scopes") <= 64 AND cardinality("platform_integration_revisions"."optional_scopes") <= 64),
	CONSTRAINT "platform_integration_revisions_adapter_shape" CHECK ("platform_integration_revisions"."adapter_package" ~ '^@[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*$' AND "platform_integration_revisions"."adapter_version" ~ '^[0-9]+.[0-9]+.[0-9]+'),
	CONSTRAINT "platform_integration_revisions_https_urls" CHECK (("platform_integration_revisions"."documentation_url" IS NULL OR "platform_integration_revisions"."documentation_url" ~ '^https://[^[:space:]@]+$') AND ("platform_integration_revisions"."authorization_url" IS NULL OR "platform_integration_revisions"."authorization_url" ~ '^https://[^[:space:]@]+$') AND ("platform_integration_revisions"."token_url" IS NULL OR "platform_integration_revisions"."token_url" ~ '^https://[^[:space:]@]+$')),
	CONSTRAINT "platform_integration_revisions_oauth_shape" CHECK (("platform_integration_revisions"."protocol" = 'oauth2' AND "platform_integration_revisions"."authorization_url" IS NOT NULL AND "platform_integration_revisions"."token_url" IS NOT NULL AND "platform_integration_revisions"."client_id" IS NOT NULL AND cardinality("platform_integration_revisions"."callback_urls") > 0) OR ("platform_integration_revisions"."protocol" <> 'oauth2' AND "platform_integration_revisions"."authorization_url" IS NULL AND "platform_integration_revisions"."token_url" IS NULL AND "platform_integration_revisions"."client_id" IS NULL AND cardinality("platform_integration_revisions"."callback_urls") = 0 AND cardinality("platform_integration_revisions"."required_scopes") = 0 AND cardinality("platform_integration_revisions"."optional_scopes") = 0)),
	CONSTRAINT "platform_integration_revisions_active_oauth_secret" CHECK ("platform_integration_revisions"."protocol" <> 'oauth2' OR "platform_integration_revisions"."lifecycle" <> 'active' OR "platform_integration_revisions"."client_secret_reference_id" IS NOT NULL),
	CONSTRAINT "platform_integration_revisions_maintenance_metadata" CHECK (("platform_integration_revisions"."operational_state" = 'maintenance' AND "platform_integration_revisions"."maintenance_expires_at" IS NOT NULL) OR ("platform_integration_revisions"."operational_state" <> 'maintenance' AND "platform_integration_revisions"."maintenance_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_integrations_key_normalized" CHECK ("platform_integrations"."key" = lower("platform_integrations"."key") AND "platform_integrations"."key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "platform_integrations_revision_positive" CHECK ("platform_integrations"."current_revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "platform_integration_health_observations" ADD CONSTRAINT "platform_integration_health_observations_integration_id_platform_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."platform_integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_integration_health_observations" ADD CONSTRAINT "platform_integration_health_observations_recorded_by_operator_id_operators_id_fk" FOREIGN KEY ("recorded_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_integration_revisions" ADD CONSTRAINT "platform_integration_revisions_integration_id_platform_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."platform_integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_integration_revisions" ADD CONSTRAINT "platform_integration_revisions_client_secret_reference_id_platform_secret_references_id_fk" FOREIGN KEY ("client_secret_reference_id") REFERENCES "public"."platform_secret_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_integration_revisions" ADD CONSTRAINT "platform_integration_revisions_webhook_secret_reference_id_platform_secret_references_id_fk" FOREIGN KEY ("webhook_secret_reference_id") REFERENCES "public"."platform_secret_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_integration_revisions" ADD CONSTRAINT "platform_integration_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_integration_health_correlation_unique" ON "platform_integration_health_observations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "platform_integration_health_integration_observed_idx" ON "platform_integration_health_observations" USING btree ("integration_id","observed_at");--> statement-breakpoint
CREATE INDEX "platform_integration_health_expiry_idx" ON "platform_integration_health_observations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_integration_revisions_number_unique" ON "platform_integration_revisions" USING btree ("integration_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_integration_revisions_correlation_unique" ON "platform_integration_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "platform_integration_revisions_integration_created_idx" ON "platform_integration_revisions" USING btree ("integration_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_integration_revisions_client_secret_idx" ON "platform_integration_revisions" USING btree ("client_secret_reference_id") WHERE "platform_integration_revisions"."client_secret_reference_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_integration_revisions_webhook_secret_idx" ON "platform_integration_revisions" USING btree ("webhook_secret_reference_id") WHERE "platform_integration_revisions"."webhook_secret_reference_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_integrations_key_environment_unique" ON "platform_integrations" USING btree ("key","environment");--> statement-breakpoint
CREATE INDEX "platform_integrations_environment_updated_idx" ON "platform_integrations" USING btree ("environment","updated_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_platform_integration_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform integration history cannot be mutated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "platform_integration_revisions_immutable"
BEFORE UPDATE OR DELETE ON "platform_integration_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_integration_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "platform_integration_health_observations_immutable"
BEFORE UPDATE OR DELETE ON "platform_integration_health_observations"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_integration_history_mutation"();
