CREATE TYPE "public"."customer_internal_note_category" AS ENUM('support', 'operations', 'billing', 'security');--> statement-breakpoint
CREATE TYPE "public"."customer_ownership_transfer_observed_state" AS ENUM('observed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."customer_risk_category" AS ENUM('security', 'abuse', 'billing', 'identity', 'support');--> statement-breakpoint
CREATE TYPE "public"."customer_risk_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."customer_risk_state" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TABLE "customer_internal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"target_type" "customer_restriction_target_type" NOT NULL,
	"target_source_id" text NOT NULL,
	"category" "customer_internal_note_category" NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_internal_notes_target_id_nonempty" CHECK (length(btrim("customer_internal_notes"."target_source_id")) BETWEEN 1 AND 200),
	CONSTRAINT "customer_internal_notes_body_bounded" CHECK (length(btrim("customer_internal_notes"."body")) BETWEEN 4 AND 2000),
	CONSTRAINT "customer_internal_notes_reason_bounded" CHECK (length(btrim("customer_internal_notes"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
CREATE TABLE "customer_risk_marker_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marker_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"category" "customer_risk_category" NOT NULL,
	"severity" "customer_risk_severity" NOT NULL,
	"state" "customer_risk_state" NOT NULL,
	"summary" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_risk_marker_revisions_number_positive" CHECK ("customer_risk_marker_revisions"."revision_number" > 0),
	CONSTRAINT "customer_risk_marker_revisions_summary_bounded" CHECK (length(btrim("customer_risk_marker_revisions"."summary")) BETWEEN 4 AND 500),
	CONSTRAINT "customer_risk_marker_revisions_reason_bounded" CHECK (length(btrim("customer_risk_marker_revisions"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
CREATE TABLE "customer_risk_markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"target_type" "customer_restriction_target_type" NOT NULL,
	"target_source_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_risk_markers_target_id_nonempty" CHECK (length(btrim("customer_risk_markers"."target_source_id")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "customer_workspace_ownership_transfer_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_state" "customer_ownership_transfer_observed_state" NOT NULL,
	"observed_owner_user_source_id" text,
	"message" text,
	"observed_at" timestamp with time zone NOT NULL,
	"synchronized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "customer_ownership_transfer_observations_source_positive" CHECK ("customer_workspace_ownership_transfer_observations"."source_revision" > 0),
	CONSTRAINT "customer_ownership_transfer_observations_shape" CHECK (("customer_workspace_ownership_transfer_observations"."observed_state" = 'observed' AND "customer_workspace_ownership_transfer_observations"."observed_owner_user_source_id" IS NOT NULL) OR ("customer_workspace_ownership_transfer_observations"."observed_state" = 'failed' AND "customer_workspace_ownership_transfer_observations"."message" IS NOT NULL)),
	CONSTRAINT "customer_ownership_transfer_observations_message_bounded" CHECK ("customer_workspace_ownership_transfer_observations"."message" IS NULL OR length(btrim("customer_workspace_ownership_transfer_observations"."message")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "customer_workspace_ownership_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"workspace_source_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"current_owner_user_source_id" text NOT NULL,
	"successor_user_source_id" text NOT NULL,
	"approval_reference" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_ownership_transfers_revision_positive" CHECK ("customer_workspace_ownership_transfers"."revision_number" > 0),
	CONSTRAINT "customer_ownership_transfers_distinct_users" CHECK ("customer_workspace_ownership_transfers"."current_owner_user_source_id" <> "customer_workspace_ownership_transfers"."successor_user_source_id"),
	CONSTRAINT "customer_ownership_transfers_approval_bounded" CHECK (length(btrim("customer_workspace_ownership_transfers"."approval_reference")) BETWEEN 3 AND 200),
	CONSTRAINT "customer_ownership_transfers_reason_bounded" CHECK (length(btrim("customer_workspace_ownership_transfers"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
ALTER TABLE "customer_workspace_projections" ADD COLUMN "owner_user_source_id" text;--> statement-breakpoint
ALTER TABLE "customer_internal_notes" ADD CONSTRAINT "customer_internal_notes_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_risk_marker_revisions" ADD CONSTRAINT "customer_risk_marker_revisions_marker_id_customer_risk_markers_id_fk" FOREIGN KEY ("marker_id") REFERENCES "public"."customer_risk_markers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_risk_marker_revisions" ADD CONSTRAINT "customer_risk_marker_revisions_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_workspace_ownership_transfer_observations" ADD CONSTRAINT "customer_workspace_ownership_transfer_observations_transfer_id_customer_workspace_ownership_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."customer_workspace_ownership_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_workspace_ownership_transfer_observations" ADD CONSTRAINT "customer_workspace_ownership_transfer_observations_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_workspace_ownership_transfers" ADD CONSTRAINT "customer_workspace_ownership_transfers_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_internal_notes_correlation_unique" ON "customer_internal_notes" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "customer_internal_notes_target_created_idx" ON "customer_internal_notes" USING btree ("environment","target_type","target_source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_risk_marker_revisions_number_unique" ON "customer_risk_marker_revisions" USING btree ("marker_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_risk_marker_revisions_correlation_unique" ON "customer_risk_marker_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "customer_risk_marker_revisions_state_idx" ON "customer_risk_marker_revisions" USING btree ("state","changed_at");--> statement-breakpoint
CREATE INDEX "customer_risk_markers_target_idx" ON "customer_risk_markers" USING btree ("environment","target_type","target_source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_ownership_transfer_observations_source_unique" ON "customer_workspace_ownership_transfer_observations" USING btree ("transfer_id","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_ownership_transfer_observations_correlation_unique" ON "customer_workspace_ownership_transfer_observations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "customer_ownership_transfer_observations_observed_idx" ON "customer_workspace_ownership_transfer_observations" USING btree ("transfer_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_ownership_transfers_revision_unique" ON "customer_workspace_ownership_transfers" USING btree ("environment","workspace_source_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_ownership_transfers_correlation_unique" ON "customer_workspace_ownership_transfers" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "customer_ownership_transfers_workspace_requested_idx" ON "customer_workspace_ownership_transfers" USING btree ("environment","workspace_source_id","requested_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_customer_operations_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer operations history cannot be mutated';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_internal_notes_immutable
BEFORE UPDATE OR DELETE ON customer_internal_notes
FOR EACH ROW EXECUTE FUNCTION reject_customer_operations_history_mutation();
--> statement-breakpoint
CREATE TRIGGER customer_risk_markers_immutable
BEFORE UPDATE OR DELETE ON customer_risk_markers
FOR EACH ROW EXECUTE FUNCTION reject_customer_operations_history_mutation();
--> statement-breakpoint
CREATE TRIGGER customer_risk_marker_revisions_immutable
BEFORE UPDATE OR DELETE ON customer_risk_marker_revisions
FOR EACH ROW EXECUTE FUNCTION reject_customer_operations_history_mutation();
--> statement-breakpoint
CREATE TRIGGER customer_workspace_ownership_transfers_immutable
BEFORE UPDATE OR DELETE ON customer_workspace_ownership_transfers
FOR EACH ROW EXECUTE FUNCTION reject_customer_operations_history_mutation();
--> statement-breakpoint
CREATE TRIGGER customer_workspace_ownership_transfer_observations_immutable
BEFORE UPDATE OR DELETE ON customer_workspace_ownership_transfer_observations
FOR EACH ROW EXECUTE FUNCTION reject_customer_operations_history_mutation();
--> statement-breakpoint
UPDATE operator_role_definitions
SET is_active = false
WHERE key IN ('support_agent', 'security_operator') AND is_active = true;
--> statement-breakpoint
INSERT INTO operator_role_definitions (
  id,
  key,
  version,
  name,
  description,
  capabilities,
  is_system,
  is_active
) VALUES
  (
    '00000000-0000-4000-8000-000000000302',
    'support_agent',
    2,
    'Support Agent',
    'Inspect platform account state and append bounded internal operational notes without customer-private access.',
    ARRAY[
      'platform:overview:read',
      'platform:operators:read',
      'platform:membership-domains:read',
      'platform:users:read',
      'platform:users:notes:write',
      'platform:workspaces:read',
      'platform:workspaces:notes:write',
      'platform:support-cases:read',
      'platform:support-cases:write'
    ],
    true,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000308',
    'security_operator',
    3,
    'Security Operator',
    'Investigate security events, manage immutable risk markers, and request reconciled restrictions without customer-private access.',
    ARRAY[
      'platform:overview:read',
      'platform:operators:read',
      'platform:membership-domains:read',
      'platform:users:read',
      'platform:users:restrict',
      'platform:users:risk:write',
      'platform:workspaces:read',
      'platform:workspaces:restrict',
      'platform:workspaces:risk:write',
      'platform:security:read',
      'platform:security:write',
      'platform:audit:read'
    ],
    true,
    true
  )
ON CONFLICT (key, version) DO NOTHING;
--> statement-breakpoint
INSERT INTO operator_role_assignments (
  operator_id,
  role_definition_id,
  assigned_by_operator_id,
  reason,
  correlation_id,
  assigned_at
)
SELECT
  assignment.operator_id,
  CASE
    WHEN definition.key = 'support_agent' THEN '00000000-0000-4000-8000-000000000302'::uuid
    ELSE '00000000-0000-4000-8000-000000000308'::uuid
  END,
  assignment.assigned_by_operator_id,
  'Migrate the operator assignment to the customer-operations-capable role version.',
  gen_random_uuid(),
  now()
FROM operator_role_assignments assignment
INNER JOIN operator_role_definitions definition
  ON definition.id = assignment.role_definition_id
WHERE definition.key IN ('support_agent', 'security_operator')
  AND definition.is_active = false
  AND assignment.revoked_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE operator_role_assignments
SET
  revoked_by_operator_id = (
    SELECT id FROM operators WHERE is_super_administrator = true LIMIT 1
  ),
  revoked_reason = 'Superseded by the customer-operations-capable role version.',
  revoked_correlation_id = gen_random_uuid(),
  revoked_at = now()
WHERE role_definition_id IN (
  SELECT id
  FROM operator_role_definitions
  WHERE key IN ('support_agent', 'security_operator') AND is_active = false
)
  AND revoked_at IS NULL;
