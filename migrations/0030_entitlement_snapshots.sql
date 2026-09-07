CREATE TYPE "public"."enterprise_entitlement_grant_lifecycle" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."entitlement_observation_state" AS ENUM('applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."entitlement_overage_policy" AS ENUM('denied', 'metered', 'contract');--> statement-breakpoint
CREATE TYPE "public"."entitlement_source_kind" AS ENUM('plan', 'enterprise_grant');--> statement-breakpoint
CREATE TYPE "public"."entitlement_value_type" AS ENUM('boolean', 'quantity');--> statement-breakpoint
CREATE TABLE "commercial_plan_entitlement_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_plan_entitlement_sets_reason_valid" CHECK (length(btrim("commercial_plan_entitlement_sets"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
CREATE TABLE "commercial_plan_entitlement_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitlement_set_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_type" "entitlement_value_type" NOT NULL,
	"enabled" boolean,
	"limit" bigint,
	"unit" text,
	"overage_policy" "entitlement_overage_policy" NOT NULL,
	CONSTRAINT "commercial_plan_entitlement_values_key_valid" CHECK ("commercial_plan_entitlement_values"."key" ~ '^[a-z][a-z0-9_.-]{1,63}$'),
	CONSTRAINT "commercial_plan_entitlement_values_shape_valid" CHECK (("commercial_plan_entitlement_values"."value_type" = 'boolean' AND "commercial_plan_entitlement_values"."enabled" IS NOT NULL AND "commercial_plan_entitlement_values"."limit" IS NULL AND "commercial_plan_entitlement_values"."unit" IS NULL AND "commercial_plan_entitlement_values"."overage_policy" = 'denied') OR ("commercial_plan_entitlement_values"."value_type" = 'quantity' AND "commercial_plan_entitlement_values"."enabled" IS NULL AND ("commercial_plan_entitlement_values"."limit" IS NULL OR "commercial_plan_entitlement_values"."limit" BETWEEN 0 AND 9000000000000) AND "commercial_plan_entitlement_values"."unit" ~ '^[a-z][a-z0-9_.-]{1,63}$'))
);
--> statement-breakpoint
CREATE TABLE "workspace_enterprise_entitlement_grant_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"value_type" "entitlement_value_type" NOT NULL,
	"enabled" boolean,
	"limit" bigint,
	"unit" text,
	"overage_policy" "entitlement_overage_policy" NOT NULL,
	"lifecycle" "enterprise_entitlement_grant_lifecycle" NOT NULL,
	"contract_reference" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_enterprise_entitlement_grant_revisions_number_positive" CHECK ("workspace_enterprise_entitlement_grant_revisions"."revision_number" > 0),
	CONSTRAINT "workspace_enterprise_entitlement_grant_revisions_shape_valid" CHECK (("workspace_enterprise_entitlement_grant_revisions"."value_type" = 'boolean' AND "workspace_enterprise_entitlement_grant_revisions"."enabled" IS NOT NULL AND "workspace_enterprise_entitlement_grant_revisions"."limit" IS NULL AND "workspace_enterprise_entitlement_grant_revisions"."unit" IS NULL AND "workspace_enterprise_entitlement_grant_revisions"."overage_policy" = 'denied') OR ("workspace_enterprise_entitlement_grant_revisions"."value_type" = 'quantity' AND "workspace_enterprise_entitlement_grant_revisions"."enabled" IS NULL AND ("workspace_enterprise_entitlement_grant_revisions"."limit" IS NULL OR "workspace_enterprise_entitlement_grant_revisions"."limit" BETWEEN 0 AND 9000000000000) AND "workspace_enterprise_entitlement_grant_revisions"."unit" ~ '^[a-z][a-z0-9_.-]{1,63}$')),
	CONSTRAINT "workspace_enterprise_entitlement_grant_revisions_term_valid" CHECK ("workspace_enterprise_entitlement_grant_revisions"."expires_at" > "workspace_enterprise_entitlement_grant_revisions"."starts_at" AND "workspace_enterprise_entitlement_grant_revisions"."expires_at" <= "workspace_enterprise_entitlement_grant_revisions"."starts_at" + interval '5 years 5 days'),
	CONSTRAINT "workspace_enterprise_entitlement_grant_revisions_contract_valid" CHECK (length(btrim("workspace_enterprise_entitlement_grant_revisions"."contract_reference")) BETWEEN 3 AND 200 AND length(btrim("workspace_enterprise_entitlement_grant_revisions"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
CREATE TABLE "workspace_enterprise_entitlement_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_enterprise_entitlement_grants_key_valid" CHECK ("workspace_enterprise_entitlement_grants"."key" ~ '^[a-z][a-z0-9_.-]{1,63}$'),
	CONSTRAINT "workspace_enterprise_entitlement_grants_revision_positive" CHECK ("workspace_enterprise_entitlement_grants"."current_revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_entitlement_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"workspace_source_id" text NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_entitlement_assignments_workspace_valid" CHECK (length(btrim("workspace_entitlement_assignments"."workspace_source_id")) BETWEEN 1 AND 200),
	CONSTRAINT "workspace_entitlement_assignments_revision_positive" CHECK ("workspace_entitlement_assignments"."current_revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_entitlement_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"desired_revision_number" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_state" "entitlement_observation_state" NOT NULL,
	"message" text,
	"observed_at" timestamp with time zone NOT NULL,
	"synchronized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_workload_key_id" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "workspace_entitlement_observations_revision_positive" CHECK ("workspace_entitlement_observations"."desired_revision_number" > 0 AND "workspace_entitlement_observations"."source_revision" > 0),
	CONSTRAINT "workspace_entitlement_observations_message_valid" CHECK ("workspace_entitlement_observations"."message" IS NULL OR length(btrim("workspace_entitlement_observations"."message")) BETWEEN 1 AND 500),
	CONSTRAINT "workspace_entitlement_observations_key_valid" CHECK ("workspace_entitlement_observations"."source_workload_key_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_entitlement_snapshot_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_type" "entitlement_value_type" NOT NULL,
	"enabled" boolean,
	"limit" bigint,
	"unit" text,
	"overage_policy" "entitlement_overage_policy" NOT NULL,
	"source_kind" "entitlement_source_kind" NOT NULL,
	"source_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "workspace_entitlement_snapshot_layers_key_valid" CHECK ("workspace_entitlement_snapshot_layers"."key" ~ '^[a-z][a-z0-9_.-]{1,63}$'),
	CONSTRAINT "workspace_entitlement_snapshot_layers_shape_valid" CHECK (("workspace_entitlement_snapshot_layers"."value_type" = 'boolean' AND "workspace_entitlement_snapshot_layers"."enabled" IS NOT NULL AND "workspace_entitlement_snapshot_layers"."limit" IS NULL AND "workspace_entitlement_snapshot_layers"."unit" IS NULL AND "workspace_entitlement_snapshot_layers"."overage_policy" = 'denied') OR ("workspace_entitlement_snapshot_layers"."value_type" = 'quantity' AND "workspace_entitlement_snapshot_layers"."enabled" IS NULL AND ("workspace_entitlement_snapshot_layers"."limit" IS NULL OR "workspace_entitlement_snapshot_layers"."limit" BETWEEN 0 AND 9000000000000) AND "workspace_entitlement_snapshot_layers"."unit" ~ '^[a-z][a-z0-9_.-]{1,63}$')),
	CONSTRAINT "workspace_entitlement_snapshot_layers_window_valid" CHECK ("workspace_entitlement_snapshot_layers"."expires_at" IS NULL OR "workspace_entitlement_snapshot_layers"."expires_at" > "workspace_entitlement_snapshot_layers"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "workspace_entitlement_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"entitlement_set_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_entitlement_snapshots_revision_positive" CHECK ("workspace_entitlement_snapshots"."revision_number" > 0),
	CONSTRAINT "workspace_entitlement_snapshots_reason_valid" CHECK (length(btrim("workspace_entitlement_snapshots"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
ALTER TABLE "commercial_plan_entitlement_sets" ADD CONSTRAINT "commercial_plan_entitlement_sets_plan_version_id_commercial_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."commercial_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_plan_entitlement_sets" ADD CONSTRAINT "commercial_plan_entitlement_sets_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_plan_entitlement_values" ADD CONSTRAINT "commercial_plan_entitlement_values_entitlement_set_id_commercial_plan_entitlement_sets_id_fk" FOREIGN KEY ("entitlement_set_id") REFERENCES "public"."commercial_plan_entitlement_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_enterprise_entitlement_grant_revisions" ADD CONSTRAINT "workspace_enterprise_entitlement_grant_revisions_grant_id_workspace_enterprise_entitlement_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."workspace_enterprise_entitlement_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_enterprise_entitlement_grant_revisions" ADD CONSTRAINT "workspace_enterprise_entitlement_grant_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_enterprise_entitlement_grants" ADD CONSTRAINT "workspace_enterprise_entitlement_grants_assignment_id_workspace_entitlement_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workspace_entitlement_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_observations" ADD CONSTRAINT "workspace_entitlement_observations_assignment_id_workspace_entitlement_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workspace_entitlement_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_snapshot_layers" ADD CONSTRAINT "workspace_entitlement_snapshot_layers_snapshot_id_workspace_entitlement_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."workspace_entitlement_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_snapshots" ADD CONSTRAINT "workspace_entitlement_snapshots_assignment_id_workspace_entitlement_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workspace_entitlement_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_snapshots" ADD CONSTRAINT "workspace_entitlement_snapshots_plan_version_id_commercial_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."commercial_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_snapshots" ADD CONSTRAINT "workspace_entitlement_snapshots_entitlement_set_id_commercial_plan_entitlement_sets_id_fk" FOREIGN KEY ("entitlement_set_id") REFERENCES "public"."commercial_plan_entitlement_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_snapshots" ADD CONSTRAINT "workspace_entitlement_snapshots_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_entitlement_sets_plan_version_unique" ON "commercial_plan_entitlement_sets" USING btree ("plan_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_entitlement_sets_correlation_unique" ON "commercial_plan_entitlement_sets" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_entitlement_values_key_unique" ON "commercial_plan_entitlement_values" USING btree ("entitlement_set_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_enterprise_entitlement_grant_revisions_number_unique" ON "workspace_enterprise_entitlement_grant_revisions" USING btree ("grant_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_enterprise_entitlement_grant_revisions_correlation_unique" ON "workspace_enterprise_entitlement_grant_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_enterprise_entitlement_grants_key_unique" ON "workspace_enterprise_entitlement_grants" USING btree ("assignment_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlement_assignments_workspace_unique" ON "workspace_entitlement_assignments" USING btree ("environment","workspace_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlement_observations_source_unique" ON "workspace_entitlement_observations" USING btree ("assignment_id","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlement_observations_correlation_unique" ON "workspace_entitlement_observations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "workspace_entitlement_observations_assignment_idx" ON "workspace_entitlement_observations" USING btree ("assignment_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlement_snapshot_layers_source_unique" ON "workspace_entitlement_snapshot_layers" USING btree ("snapshot_id","key","source_kind");--> statement-breakpoint
CREATE INDEX "workspace_entitlement_snapshot_layers_resolution_idx" ON "workspace_entitlement_snapshot_layers" USING btree ("snapshot_id","starts_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlement_snapshots_revision_unique" ON "workspace_entitlement_snapshots" USING btree ("assignment_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlement_snapshots_correlation_unique" ON "workspace_entitlement_snapshots" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "workspace_entitlement_snapshots_history_idx" ON "workspace_entitlement_snapshots" USING btree ("assignment_id","revision_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_entitlement_sets_identity_unique" ON "commercial_plan_entitlement_sets" USING btree ("id", "plan_version_id");
--> statement-breakpoint
ALTER TABLE "workspace_entitlement_snapshots" ADD CONSTRAINT "workspace_entitlement_snapshots_set_plan_fk" FOREIGN KEY ("entitlement_set_id", "plan_version_id") REFERENCES "public"."commercial_plan_entitlement_sets"("id", "plan_version_id") ON DELETE restrict DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "workspace_entitlement_assignments" ADD CONSTRAINT "workspace_entitlement_assignments_current_snapshot_fk" FOREIGN KEY ("id", "current_revision_number") REFERENCES "public"."workspace_entitlement_snapshots"("assignment_id", "revision_number") ON DELETE restrict DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "workspace_enterprise_entitlement_grants" ADD CONSTRAINT "workspace_enterprise_entitlement_grants_current_revision_fk" FOREIGN KEY ("id", "current_revision_number") REFERENCES "public"."workspace_enterprise_entitlement_grant_revisions"("grant_id", "revision_number") ON DELETE restrict DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION reject_entitlement_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'entitlement_history_immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER commercial_plan_entitlement_sets_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_entitlement_sets
FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER commercial_plan_entitlement_values_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_entitlement_values
FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER workspace_entitlement_snapshots_immutable
BEFORE UPDATE OR DELETE ON workspace_entitlement_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER workspace_entitlement_snapshot_layers_immutable
BEFORE UPDATE OR DELETE ON workspace_entitlement_snapshot_layers
FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER workspace_enterprise_entitlement_grant_revisions_immutable
BEFORE UPDATE OR DELETE ON workspace_enterprise_entitlement_grant_revisions
FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER workspace_entitlement_observations_immutable
BEFORE UPDATE OR DELETE ON workspace_entitlement_observations
FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_workspace_entitlement_assignment_pointer() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'workspace_entitlement_assignment_delete_forbidden';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.environment IS DISTINCT FROM NEW.environment
    OR OLD.workspace_source_id IS DISTINCT FROM NEW.workspace_source_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.current_revision_number <> OLD.current_revision_number + 1
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'workspace_entitlement_assignment_pointer_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER workspace_entitlement_assignments_guard
BEFORE UPDATE OR DELETE ON workspace_entitlement_assignments
FOR EACH ROW EXECUTE FUNCTION guard_workspace_entitlement_assignment_pointer();
--> statement-breakpoint
CREATE FUNCTION guard_workspace_enterprise_entitlement_grant_pointer() RETURNS trigger AS $$
DECLARE
  previous_lifecycle enterprise_entitlement_grant_lifecycle;
  next_lifecycle enterprise_entitlement_grant_lifecycle;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'workspace_enterprise_entitlement_grant_delete_forbidden';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.assignment_id IS DISTINCT FROM NEW.assignment_id
    OR OLD.key IS DISTINCT FROM NEW.key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.current_revision_number <> OLD.current_revision_number + 1
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'workspace_enterprise_entitlement_grant_pointer_invalid';
  END IF;
  SELECT lifecycle INTO previous_lifecycle
  FROM workspace_enterprise_entitlement_grant_revisions
  WHERE grant_id = OLD.id AND revision_number = OLD.current_revision_number;
  SELECT lifecycle INTO next_lifecycle
  FROM workspace_enterprise_entitlement_grant_revisions
  WHERE grant_id = NEW.id AND revision_number = NEW.current_revision_number;
  IF previous_lifecycle IS NULL OR next_lifecycle IS NULL
    OR previous_lifecycle = 'revoked' THEN
    RAISE EXCEPTION 'workspace_enterprise_entitlement_grant_lifecycle_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER workspace_enterprise_entitlement_grants_guard
BEFORE UPDATE OR DELETE ON workspace_enterprise_entitlement_grants
FOR EACH ROW EXECUTE FUNCTION guard_workspace_enterprise_entitlement_grant_pointer();
