CREATE TABLE "operator_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"role_definition_id" uuid NOT NULL,
	"assigned_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by_operator_id" uuid,
	"revoked_reason" text,
	"revoked_correlation_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "operator_role_assignments_revocation_metadata" CHECK (("operator_role_assignments"."revoked_at" IS NULL AND "operator_role_assignments"."revoked_by_operator_id" IS NULL AND "operator_role_assignments"."revoked_reason" IS NULL AND "operator_role_assignments"."revoked_correlation_id" IS NULL) OR ("operator_role_assignments"."revoked_at" IS NOT NULL AND "operator_role_assignments"."revoked_by_operator_id" IS NOT NULL AND "operator_role_assignments"."revoked_reason" IS NOT NULL AND "operator_role_assignments"."revoked_correlation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "operator_role_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"capabilities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_role_definitions_key_normalized" CHECK ("operator_role_definitions"."key" = lower("operator_role_definitions"."key") AND "operator_role_definitions"."key" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "operator_role_definitions_version_positive" CHECK ("operator_role_definitions"."version" > 0),
	CONSTRAINT "operator_role_definitions_capabilities_nonempty" CHECK (cardinality("operator_role_definitions"."capabilities") > 0)
);
--> statement-breakpoint
ALTER TABLE "operator_invitations" ADD COLUMN "intended_role_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "operator_role_assignments" ADD CONSTRAINT "operator_role_assignments_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_role_assignments" ADD CONSTRAINT "operator_role_assignments_role_definition_id_operator_role_definitions_id_fk" FOREIGN KEY ("role_definition_id") REFERENCES "public"."operator_role_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_role_assignments" ADD CONSTRAINT "operator_role_assignments_assigned_by_operator_id_operators_id_fk" FOREIGN KEY ("assigned_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_role_assignments" ADD CONSTRAINT "operator_role_assignments_revoked_by_operator_id_operators_id_fk" FOREIGN KEY ("revoked_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_role_assignments_active_unique" ON "operator_role_assignments" USING btree ("operator_id","role_definition_id") WHERE "operator_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "operator_role_assignments_operator_active_idx" ON "operator_role_assignments" USING btree ("operator_id") WHERE "operator_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "operator_role_assignments_role_definition_idx" ON "operator_role_assignments" USING btree ("role_definition_id");--> statement-breakpoint
CREATE INDEX "operator_role_assignments_correlation_idx" ON "operator_role_assignments" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_role_definitions_key_version_unique" ON "operator_role_definitions" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_role_definitions_one_active_version" ON "operator_role_definitions" USING btree ("key") WHERE "operator_role_definitions"."is_active" = true;--> statement-breakpoint
ALTER TABLE "operator_invitations" ADD CONSTRAINT "operator_invitations_intended_role_definition_id_operator_role_definitions_id_fk" FOREIGN KEY ("intended_role_definition_id") REFERENCES "public"."operator_role_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_invitations_role_definition_idx" ON "operator_invitations" USING btree ("intended_role_definition_id") WHERE "operator_invitations"."intended_role_definition_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "operator_role_definitions" ("id", "key", "version", "name", "description", "capabilities", "is_system", "is_active") VALUES
  ('00000000-0000-4000-8000-000000000101', 'platform_viewer', 1, 'Platform Viewer', 'Read non-sensitive platform health and operator inventory.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:membership-domains:read'], true, true),
  ('00000000-0000-4000-8000-000000000102', 'support_agent', 1, 'Support Agent', 'Inspect platform account state and manage support cases without customer-private access.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:membership-domains:read', 'platform:users:read', 'platform:workspaces:read', 'platform:support-cases:read', 'platform:support-cases:write'], true, true),
  ('00000000-0000-4000-8000-000000000103', 'support_engineer', 1, 'Support Engineer', 'Invite operators and perform scoped platform diagnostics without customer-private access.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:operators:invite', 'platform:membership-domains:read', 'platform:users:read', 'platform:workspaces:read', 'platform:support-cases:read', 'platform:support-cases:write', 'platform:diagnostics:read'], true, true),
  ('00000000-0000-4000-8000-000000000104', 'billing_operator', 1, 'Billing Operator', 'Operate plans, subscriptions, invoices, credits, and billing reconciliation.', ARRAY['platform:overview:read', 'platform:billing:read', 'platform:billing:write', 'platform:plans:read', 'platform:plans:write'], true, true),
  ('00000000-0000-4000-8000-000000000105', 'integration_operator', 1, 'Integration Operator', 'Operate OAuth applications, adapters, webhooks, and integration health.', ARRAY['platform:overview:read', 'platform:integrations:read', 'platform:integrations:write', 'platform:adapters:read', 'platform:adapters:write'], true, true),
  ('00000000-0000-4000-8000-000000000106', 'model_operator', 1, 'Model Operator', 'Operate model providers, routing, pricing, availability, and maintenance state.', ARRAY['platform:overview:read', 'platform:models:read', 'platform:models:write'], true, true),
  ('00000000-0000-4000-8000-000000000107', 'runtime_operator', 1, 'Runtime Operator', 'Operate runner fleets, queues, workflows, previews, and execution health.', ARRAY['platform:overview:read', 'platform:runners:read', 'platform:runners:write', 'platform:workflows:read', 'platform:workflows:write', 'platform:deployments:read'], true, true),
  ('00000000-0000-4000-8000-000000000108', 'security_operator', 1, 'Security Operator', 'Investigate security events and apply platform restrictions without customer-private access.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:membership-domains:read', 'platform:security:read', 'platform:security:write', 'platform:audit:read'], true, true),
  ('00000000-0000-4000-8000-000000000109', 'release_manager', 1, 'Release Manager', 'Operate feature rollouts, platform releases, maintenance, and rollback controls.', ARRAY['platform:overview:read', 'platform:releases:read', 'platform:releases:write', 'platform:feature-flags:read', 'platform:feature-flags:write'], true, true),
  ('00000000-0000-4000-8000-000000000110', 'auditor', 1, 'Auditor', 'Read immutable audit, compliance, and production-control evidence.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:membership-domains:read', 'platform:audit:read', 'platform:evidence:read'], true, true)
ON CONFLICT ("key", "version") DO NOTHING;
