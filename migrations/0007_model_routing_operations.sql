CREATE TYPE "public"."model_routing_control_state" AS ENUM('enabled', 'maintenance', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."model_routing_control_target_kind" AS ENUM('provider', 'model');--> statement-breakpoint
CREATE TABLE "model_operational_control_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"control_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"state" "model_routing_control_state" NOT NULL,
	"maintenance_expires_at" timestamp with time zone,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_operational_control_revisions_number_positive" CHECK ("model_operational_control_revisions"."revision_number" > 0),
	CONSTRAINT "model_operational_control_revisions_maintenance_metadata" CHECK (("model_operational_control_revisions"."state" = 'maintenance' AND "model_operational_control_revisions"."maintenance_expires_at" IS NOT NULL AND "model_operational_control_revisions"."maintenance_expires_at" > "model_operational_control_revisions"."created_at") OR ("model_operational_control_revisions"."state" <> 'maintenance' AND "model_operational_control_revisions"."maintenance_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "model_operational_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_kind" "model_routing_control_target_kind" NOT NULL,
	"provider_id" uuid,
	"model_id" uuid,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_operational_controls_target_shape" CHECK (("model_operational_controls"."target_kind" = 'provider' AND "model_operational_controls"."provider_id" IS NOT NULL AND "model_operational_controls"."model_id" IS NULL) OR ("model_operational_controls"."target_kind" = 'model' AND "model_operational_controls"."provider_id" IS NULL AND "model_operational_controls"."model_id" IS NOT NULL)),
	CONSTRAINT "model_operational_controls_revision_positive" CHECK ("model_operational_controls"."current_revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "model_routing_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_routing_policies_key_normalized" CHECK ("model_routing_policies"."key" = lower("model_routing_policies"."key") AND "model_routing_policies"."key" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "model_routing_policies_revision_positive" CHECK ("model_routing_policies"."current_revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "model_routing_policy_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policy_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"required_capabilities" text[] NOT NULL,
	"maximum_data_classification" "model_data_classification" NOT NULL,
	"allowed_regions" text[] NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_routing_policy_revisions_number_positive" CHECK ("model_routing_policy_revisions"."revision_number" > 0),
	CONSTRAINT "model_routing_policy_revisions_name_nonempty" CHECK (length(btrim("model_routing_policy_revisions"."display_name")) BETWEEN 2 AND 120),
	CONSTRAINT "model_routing_policy_revisions_capabilities_nonempty" CHECK (cardinality("model_routing_policy_revisions"."required_capabilities") BETWEEN 1 AND 7),
	CONSTRAINT "model_routing_policy_revisions_regions_nonempty" CHECK (cardinality("model_routing_policy_revisions"."allowed_regions") BETWEEN 1 AND 32)
);
--> statement-breakpoint
CREATE TABLE "model_routing_policy_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"rollout_basis_points" integer NOT NULL,
	"allow_degraded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_routing_policy_targets_priority_bounds" CHECK ("model_routing_policy_targets"."priority" BETWEEN 1 AND 16),
	CONSTRAINT "model_routing_policy_targets_rollout_bounds" CHECK ("model_routing_policy_targets"."rollout_basis_points" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "model_operational_control_revisions" ADD CONSTRAINT "model_operational_control_revisions_control_id_model_operational_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."model_operational_controls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_operational_control_revisions" ADD CONSTRAINT "model_operational_control_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_operational_controls" ADD CONSTRAINT "model_operational_controls_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_operational_controls" ADD CONSTRAINT "model_operational_controls_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routing_policy_revisions" ADD CONSTRAINT "model_routing_policy_revisions_policy_id_model_routing_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."model_routing_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routing_policy_revisions" ADD CONSTRAINT "model_routing_policy_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routing_policy_targets" ADD CONSTRAINT "model_routing_policy_targets_policy_revision_id_model_routing_policy_revisions_id_fk" FOREIGN KEY ("policy_revision_id") REFERENCES "public"."model_routing_policy_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routing_policy_targets" ADD CONSTRAINT "model_routing_policy_targets_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_operational_control_revisions_number_unique" ON "model_operational_control_revisions" USING btree ("control_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "model_operational_control_revisions_correlation_unique" ON "model_operational_control_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "model_operational_control_revisions_control_created_idx" ON "model_operational_control_revisions" USING btree ("control_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_operational_controls_provider_unique" ON "model_operational_controls" USING btree ("provider_id") WHERE "model_operational_controls"."provider_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_operational_controls_model_unique" ON "model_operational_controls" USING btree ("model_id") WHERE "model_operational_controls"."model_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_routing_policies_key_environment_unique" ON "model_routing_policies" USING btree ("key","environment");--> statement-breakpoint
CREATE INDEX "model_routing_policies_environment_updated_idx" ON "model_routing_policies" USING btree ("environment","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_routing_policy_revisions_number_unique" ON "model_routing_policy_revisions" USING btree ("policy_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "model_routing_policy_revisions_correlation_unique" ON "model_routing_policy_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "model_routing_policy_revisions_policy_created_idx" ON "model_routing_policy_revisions" USING btree ("policy_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_routing_policy_targets_priority_unique" ON "model_routing_policy_targets" USING btree ("policy_revision_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "model_routing_policy_targets_model_unique" ON "model_routing_policy_targets" USING btree ("policy_revision_id","model_id");--> statement-breakpoint
CREATE INDEX "model_routing_policy_targets_model_idx" ON "model_routing_policy_targets" USING btree ("model_id");
--> statement-breakpoint
CREATE FUNCTION "prevent_model_routing_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'model routing history cannot be mutated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "model_routing_policy_revisions_immutable"
BEFORE UPDATE OR DELETE ON "model_routing_policy_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_routing_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_routing_policy_targets_immutable"
BEFORE UPDATE OR DELETE ON "model_routing_policy_targets"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_routing_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "model_operational_control_revisions_immutable"
BEFORE UPDATE OR DELETE ON "model_operational_control_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_routing_history_mutation"();
