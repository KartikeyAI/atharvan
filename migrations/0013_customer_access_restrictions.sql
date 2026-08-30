CREATE TYPE "public"."customer_restriction_capability" AS ENUM('login', 'new_executions', 'provider_mutations', 'production_deployments', 'integrations', 'runner_access', 'all_access');--> statement-breakpoint
CREATE TYPE "public"."customer_restriction_desired_state" AS ENUM('restricted', 'restored');--> statement-breakpoint
CREATE TYPE "public"."customer_restriction_observed_state" AS ENUM('restricted', 'restored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."customer_restriction_target_type" AS ENUM('user', 'workspace');--> statement-breakpoint
CREATE TABLE "customer_access_restriction_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restriction_id" uuid NOT NULL,
	"desired_revision_number" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_state" "customer_restriction_observed_state" NOT NULL,
	"message" text,
	"observed_at" timestamp with time zone NOT NULL,
	"synchronized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "customer_access_restriction_observations_revision_positive" CHECK ("customer_access_restriction_observations"."desired_revision_number" > 0),
	CONSTRAINT "customer_access_restriction_observations_source_revision_positive" CHECK ("customer_access_restriction_observations"."source_revision" > 0),
	CONSTRAINT "customer_access_restriction_observations_message_bounded" CHECK ("customer_access_restriction_observations"."message" IS NULL OR length(btrim("customer_access_restriction_observations"."message")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "customer_access_restriction_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restriction_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"desired_state" "customer_restriction_desired_state" NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_access_restriction_revisions_number_positive" CHECK ("customer_access_restriction_revisions"."revision_number" > 0),
	CONSTRAINT "customer_access_restriction_revisions_reason_nonempty" CHECK (length(btrim("customer_access_restriction_revisions"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
CREATE TABLE "customer_access_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"target_type" "customer_restriction_target_type" NOT NULL,
	"target_source_id" text NOT NULL,
	"capability" "customer_restriction_capability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_access_restrictions_target_id_nonempty" CHECK (length(btrim("customer_access_restrictions"."target_source_id")) BETWEEN 1 AND 200),
	CONSTRAINT "customer_access_restrictions_workspace_login_invalid" CHECK ("customer_access_restrictions"."target_type" <> 'workspace' OR "customer_access_restrictions"."capability" <> 'login')
);
--> statement-breakpoint
ALTER TABLE "customer_access_restriction_observations" ADD CONSTRAINT "customer_access_restriction_observations_restriction_id_customer_access_restrictions_id_fk" FOREIGN KEY ("restriction_id") REFERENCES "public"."customer_access_restrictions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_access_restriction_observations" ADD CONSTRAINT "customer_access_restriction_observations_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_access_restriction_revisions" ADD CONSTRAINT "customer_access_restriction_revisions_restriction_id_customer_access_restrictions_id_fk" FOREIGN KEY ("restriction_id") REFERENCES "public"."customer_access_restrictions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_access_restriction_revisions" ADD CONSTRAINT "customer_access_restriction_revisions_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_access_restriction_observations_source_unique" ON "customer_access_restriction_observations" USING btree ("restriction_id","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_access_restriction_observations_correlation_unique" ON "customer_access_restriction_observations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "customer_access_restriction_observations_revision_idx" ON "customer_access_restriction_observations" USING btree ("restriction_id","desired_revision_number","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_access_restriction_revisions_number_unique" ON "customer_access_restriction_revisions" USING btree ("restriction_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_access_restriction_revisions_correlation_unique" ON "customer_access_restriction_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "customer_access_restriction_revisions_requested_idx" ON "customer_access_restriction_revisions" USING btree ("restriction_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_access_restrictions_target_capability_unique" ON "customer_access_restrictions" USING btree ("environment","target_type","target_source_id","capability");--> statement-breakpoint
CREATE INDEX "customer_access_restrictions_target_idx" ON "customer_access_restrictions" USING btree ("environment","target_type","target_source_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_customer_access_restriction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer restriction history cannot be mutated';
END;
$$;--> statement-breakpoint
CREATE TRIGGER customer_access_restrictions_immutable
BEFORE UPDATE OR DELETE ON customer_access_restrictions
FOR EACH ROW EXECUTE FUNCTION reject_customer_access_restriction_mutation();--> statement-breakpoint
CREATE TRIGGER customer_access_restriction_revisions_immutable
BEFORE UPDATE OR DELETE ON customer_access_restriction_revisions
FOR EACH ROW EXECUTE FUNCTION reject_customer_access_restriction_mutation();--> statement-breakpoint
CREATE TRIGGER customer_access_restriction_observations_immutable
BEFORE UPDATE OR DELETE ON customer_access_restriction_observations
FOR EACH ROW EXECUTE FUNCTION reject_customer_access_restriction_mutation();--> statement-breakpoint
UPDATE operator_role_definitions
SET is_active = false
WHERE key = 'security_operator' AND is_active = true;--> statement-breakpoint
INSERT INTO operator_role_definitions (
  id,
  key,
  version,
  name,
  description,
  capabilities,
  is_system,
  is_active
) VALUES (
  '00000000-0000-4000-8000-000000000208',
  'security_operator',
  2,
  'Security Operator',
  'Investigate security events and request reconciled user or workspace restrictions without customer-private access.',
  ARRAY[
    'platform:overview:read',
    'platform:operators:read',
    'platform:membership-domains:read',
    'platform:users:read',
    'platform:users:restrict',
    'platform:workspaces:read',
    'platform:workspaces:restrict',
    'platform:security:read',
    'platform:security:write',
    'platform:audit:read'
  ],
  true,
  true
) ON CONFLICT (key, version) DO NOTHING;
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
  '00000000-0000-4000-8000-000000000208',
  assignment.assigned_by_operator_id,
  'Migrate the Security Operator assignment to restriction-capable version 2.',
  gen_random_uuid(),
  now()
FROM operator_role_assignments assignment
WHERE assignment.role_definition_id = '00000000-0000-4000-8000-000000000108'
  AND assignment.revoked_at IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE operator_role_assignments
SET
  revoked_by_operator_id = (
    SELECT id FROM operators WHERE is_super_administrator = true LIMIT 1
  ),
  revoked_reason = 'Superseded by Security Operator version 2.',
  revoked_correlation_id = gen_random_uuid(),
  revoked_at = now()
WHERE role_definition_id = '00000000-0000-4000-8000-000000000108'
  AND revoked_at IS NULL;
