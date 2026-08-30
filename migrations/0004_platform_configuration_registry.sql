CREATE TYPE "public"."platform_configuration_environment" AS ENUM('development', 'production', 'test');--> statement-breakpoint
CREATE TYPE "public"."platform_configuration_scope" AS ENUM('platform', 'environment');--> statement-breakpoint
CREATE TYPE "public"."platform_configuration_value_type" AS ENUM('boolean', 'integer', 'string', 'string_list');--> statement-breakpoint
CREATE TABLE "platform_configuration_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"scope" "platform_configuration_scope" NOT NULL,
	"environment" "platform_configuration_environment",
	"current_revision_id" uuid NOT NULL,
	"updated_by_operator_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_configuration_bindings_scope_environment" CHECK (("platform_configuration_bindings"."scope" = 'platform' AND "platform_configuration_bindings"."environment" IS NULL) OR ("platform_configuration_bindings"."scope" = 'environment' AND "platform_configuration_bindings"."environment" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_configuration_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"value_type" "platform_configuration_value_type" NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_value" jsonb NOT NULL,
	"is_mutable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_configuration_definitions_key_normalized" CHECK ("platform_configuration_definitions"."key" = lower("platform_configuration_definitions"."key") AND "platform_configuration_definitions"."key" ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'),
	CONSTRAINT "platform_configuration_definitions_key_nonsecret" CHECK ("platform_configuration_definitions"."key" !~ '(^|[._-])(secret|password|token|credential|private[_-]?key|api[_-]?key|access[_-]?key|signing[_-]?key|hmac)([._-]|$)'),
	CONSTRAINT "platform_configuration_definitions_category_normalized" CHECK ("platform_configuration_definitions"."category" = lower("platform_configuration_definitions"."category") AND "platform_configuration_definitions"."category" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "platform_configuration_definitions_validation_object" CHECK (jsonb_typeof("platform_configuration_definitions"."validation") = 'object'),
	CONSTRAINT "platform_configuration_definitions_default_type" CHECK (("platform_configuration_definitions"."value_type" = 'boolean' AND jsonb_typeof("platform_configuration_definitions"."default_value") = 'boolean') OR ("platform_configuration_definitions"."value_type" = 'integer' AND jsonb_typeof("platform_configuration_definitions"."default_value") = 'number') OR ("platform_configuration_definitions"."value_type" = 'string' AND jsonb_typeof("platform_configuration_definitions"."default_value") = 'string') OR ("platform_configuration_definitions"."value_type" = 'string_list' AND jsonb_typeof("platform_configuration_definitions"."default_value") = 'array' AND jsonb_array_length("platform_configuration_definitions"."default_value") > 0))
);
--> statement-breakpoint
CREATE TABLE "platform_configuration_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"scope" "platform_configuration_scope" NOT NULL,
	"environment" "platform_configuration_environment",
	"value" jsonb NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_configuration_revisions_number_positive" CHECK ("platform_configuration_revisions"."revision_number" > 0),
	CONSTRAINT "platform_configuration_revisions_scope_environment" CHECK (("platform_configuration_revisions"."scope" = 'platform' AND "platform_configuration_revisions"."environment" IS NULL) OR ("platform_configuration_revisions"."scope" = 'environment' AND "platform_configuration_revisions"."environment" IS NOT NULL)),
	CONSTRAINT "platform_configuration_revisions_value_supported" CHECK (jsonb_typeof("platform_configuration_revisions"."value") IN ('boolean', 'number', 'string', 'array'))
);
--> statement-breakpoint
ALTER TABLE "platform_configuration_bindings" ADD CONSTRAINT "platform_configuration_bindings_definition_id_platform_configuration_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."platform_configuration_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_configuration_bindings" ADD CONSTRAINT "platform_configuration_bindings_current_revision_id_platform_configuration_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."platform_configuration_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_configuration_bindings" ADD CONSTRAINT "platform_configuration_bindings_updated_by_operator_id_operators_id_fk" FOREIGN KEY ("updated_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_configuration_revisions" ADD CONSTRAINT "platform_configuration_revisions_definition_id_platform_configuration_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."platform_configuration_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_configuration_revisions" ADD CONSTRAINT "platform_configuration_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_configuration_bindings_platform_unique" ON "platform_configuration_bindings" USING btree ("definition_id") WHERE "platform_configuration_bindings"."scope" = 'platform';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_configuration_bindings_environment_unique" ON "platform_configuration_bindings" USING btree ("definition_id","environment") WHERE "platform_configuration_bindings"."scope" = 'environment';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_configuration_bindings_revision_unique" ON "platform_configuration_bindings" USING btree ("current_revision_id");--> statement-breakpoint
CREATE INDEX "platform_configuration_bindings_updated_by_idx" ON "platform_configuration_bindings" USING btree ("updated_by_operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_configuration_definitions_key_unique" ON "platform_configuration_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "platform_configuration_definitions_category_idx" ON "platform_configuration_definitions" USING btree ("category","key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_configuration_revisions_number_unique" ON "platform_configuration_revisions" USING btree ("definition_id","revision_number");--> statement-breakpoint
CREATE INDEX "platform_configuration_revisions_definition_created_idx" ON "platform_configuration_revisions" USING btree ("definition_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_configuration_revisions_correlation_idx" ON "platform_configuration_revisions" USING btree ("correlation_id");
--> statement-breakpoint
INSERT INTO "platform_configuration_definitions" ("id", "key", "category", "name", "description", "value_type", "validation", "default_value", "is_mutable") VALUES
  ('00000000-0000-4000-8000-000000000201', 'operator.invitation.lifetime_hours', 'operator-access', 'Invitation lifetime', 'Hours before a newly issued operator invitation expires.', 'integer', '{"minimum":1,"maximum":168}'::jsonb, '24'::jsonb, true),
  ('00000000-0000-4000-8000-000000000202', 'platform.signup.mode', 'operator-access', 'Operator signup mode', 'Controls whether operator access remains invitation-only or is fully disabled.', 'string', '{"allowedValues":["invitation_only","disabled"]}'::jsonb, '"invitation_only"'::jsonb, true),
  ('00000000-0000-4000-8000-000000000203', 'platform.release.channel', 'releases', 'Release channel', 'Default release channel used by platform rollout consumers.', 'string', '{"allowedValues":["stable","beta"]}'::jsonb, '"stable"'::jsonb, true),
  ('00000000-0000-4000-8000-000000000204', 'platform.preview.default_ttl_minutes', 'runtime', 'Preview lifetime', 'Default lifetime for preview environments before expiry processing.', 'integer', '{"minimum":5,"maximum":1440}'::jsonb, '60'::jsonb, true),
  ('00000000-0000-4000-8000-000000000205', 'platform.artifacts.retention_days', 'retention', 'Artifact retention', 'Default number of days platform artifacts are retained.', 'integer', '{"minimum":1,"maximum":3650}'::jsonb, '30'::jsonb, true),
  ('00000000-0000-4000-8000-000000000206', 'platform.support.access_requires_customer_approval', 'support', 'Customer approval for support access', 'Requires customer approval before a support-access workflow can be activated.', 'boolean', '{}'::jsonb, 'true'::jsonb, true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "prevent_platform_configuration_revision_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform configuration revisions are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "platform_configuration_revisions_immutable"
BEFORE UPDATE OR DELETE ON "platform_configuration_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_configuration_revision_mutation"();
