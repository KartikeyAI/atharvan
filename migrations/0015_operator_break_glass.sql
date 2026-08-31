CREATE TYPE "public"."operator_break_glass_review_outcome" AS ENUM('approved', 'concerns');--> statement-breakpoint
CREATE TABLE "operator_break_glass_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"capabilities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"reason" text NOT NULL,
	"incident_reference" text NOT NULL,
	"approval_reference" text NOT NULL,
	"granted_by_operator_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_by_operator_id" uuid,
	"revoked_reason" text,
	"revoked_correlation_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "operator_break_glass_grants_capabilities_nonempty" CHECK (cardinality("operator_break_glass_grants"."capabilities") > 0),
	CONSTRAINT "operator_break_glass_grants_lifetime" CHECK ("operator_break_glass_grants"."expires_at" >= "operator_break_glass_grants"."granted_at" + interval '5 minutes' AND "operator_break_glass_grants"."expires_at" <= "operator_break_glass_grants"."granted_at" + interval '60 minutes'),
	CONSTRAINT "operator_break_glass_grants_revocation_metadata" CHECK (("operator_break_glass_grants"."revoked_at" IS NULL AND "operator_break_glass_grants"."revoked_by_operator_id" IS NULL AND "operator_break_glass_grants"."revoked_reason" IS NULL AND "operator_break_glass_grants"."revoked_correlation_id" IS NULL) OR ("operator_break_glass_grants"."revoked_at" IS NOT NULL AND "operator_break_glass_grants"."revoked_by_operator_id" IS NOT NULL AND "operator_break_glass_grants"."revoked_reason" IS NOT NULL AND "operator_break_glass_grants"."revoked_correlation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "operator_break_glass_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"reviewer_operator_id" uuid NOT NULL,
	"outcome" "operator_break_glass_review_outcome" NOT NULL,
	"summary" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_break_glass_reviews_summary_length" CHECK (length("operator_break_glass_reviews"."summary") BETWEEN 8 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "platform_commands" ADD COLUMN "break_glass_grant_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_break_glass_grants" ADD CONSTRAINT "operator_break_glass_grants_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_break_glass_grants" ADD CONSTRAINT "operator_break_glass_grants_granted_by_operator_id_operators_id_fk" FOREIGN KEY ("granted_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_break_glass_grants" ADD CONSTRAINT "operator_break_glass_grants_revoked_by_operator_id_operators_id_fk" FOREIGN KEY ("revoked_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_break_glass_reviews" ADD CONSTRAINT "operator_break_glass_reviews_grant_id_operator_break_glass_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."operator_break_glass_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_break_glass_reviews" ADD CONSTRAINT "operator_break_glass_reviews_reviewer_operator_id_operators_id_fk" FOREIGN KEY ("reviewer_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_break_glass_grants_operator_idx" ON "operator_break_glass_grants" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "operator_break_glass_grants_expiry_idx" ON "operator_break_glass_grants" USING btree ("expires_at") WHERE "operator_break_glass_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "operator_break_glass_grants_granted_by_idx" ON "operator_break_glass_grants" USING btree ("granted_by_operator_id");--> statement-breakpoint
CREATE INDEX "operator_break_glass_grants_correlation_idx" ON "operator_break_glass_grants" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_break_glass_reviews_grant_unique" ON "operator_break_glass_reviews" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "operator_break_glass_reviews_reviewer_idx" ON "operator_break_glass_reviews" USING btree ("reviewer_operator_id");--> statement-breakpoint
CREATE INDEX "operator_break_glass_reviews_correlation_idx" ON "operator_break_glass_reviews" USING btree ("correlation_id");--> statement-breakpoint
ALTER TABLE "platform_commands" ADD CONSTRAINT "platform_commands_break_glass_grants_bounded" CHECK (cardinality("platform_commands"."break_glass_grant_ids") <= 5);--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_operator_break_glass_grant_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operator break-glass grant history cannot be deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal operator break-glass grants cannot be mutated';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.capabilities IS DISTINCT FROM OLD.capabilities
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.incident_reference IS DISTINCT FROM OLD.incident_reference
    OR NEW.approval_reference IS DISTINCT FROM OLD.approval_reference
    OR NEW.granted_by_operator_id IS DISTINCT FROM OLD.granted_by_operator_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'operator break-glass issuance evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER operator_break_glass_grants_guarded
BEFORE UPDATE OR DELETE ON operator_break_glass_grants
FOR EACH ROW EXECUTE FUNCTION guard_operator_break_glass_grant_lifecycle();--> statement-breakpoint
CREATE TRIGGER operator_break_glass_reviews_immutable
BEFORE UPDATE OR DELETE ON operator_break_glass_reviews
FOR EACH ROW EXECUTE FUNCTION reject_customer_operations_history_mutation();--> statement-breakpoint
UPDATE "operator_role_definitions"
SET "is_active" = false
WHERE "key" IN ('security_operator', 'auditor') AND "is_active" = true;--> statement-breakpoint
INSERT INTO "operator_role_definitions" ("id", "key", "version", "name", "description", "capabilities", "is_system", "is_active") VALUES
  ('00000000-0000-4000-8000-000000000208', 'security_operator', 2, 'Security Operator', 'Investigate security events, apply platform restrictions, and review terminal break-glass grants without customer-private access.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:membership-domains:read', 'platform:security:read', 'platform:security:write', 'platform:audit:read', 'platform:operators:break-glass:review'], true, true),
  ('00000000-0000-4000-8000-000000000210', 'auditor', 2, 'Auditor', 'Read immutable audit, compliance, production-control, and terminal break-glass evidence.', ARRAY['platform:overview:read', 'platform:operators:read', 'platform:membership-domains:read', 'platform:audit:read', 'platform:evidence:read', 'platform:operators:break-glass:review'], true, true)
ON CONFLICT ("key", "version") DO NOTHING;
