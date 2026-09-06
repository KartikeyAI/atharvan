CREATE TABLE "platform_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"requester_id" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_identity" text NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"consumed_at" timestamp with time zone,
	"consumed_correlation_id" uuid,
	CONSTRAINT "platform_approvals_expiry" CHECK ("platform_approvals"."expires_at" > "platform_approvals"."created_at" AND "platform_approvals"."expires_at" <= "platform_approvals"."created_at" + interval '30 minutes'),
	CONSTRAINT "platform_approvals_status" CHECK ("platform_approvals"."status" IN ('pending', 'approved', 'rejected', 'revoked', 'consumed')),
	CONSTRAINT "platform_approvals_independent" CHECK ("platform_approvals"."decided_by" IS NULL OR "platform_approvals"."decided_by" <> "platform_approvals"."requester_id"),
	CONSTRAINT "platform_approvals_decision_evidence" CHECK ("platform_approvals"."status" NOT IN ('approved', 'rejected', 'consumed') OR ("platform_approvals"."decided_by" IS NOT NULL AND "platform_approvals"."decided_at" IS NOT NULL AND "platform_approvals"."decision_reason" IS NOT NULL)),
	CONSTRAINT "platform_approvals_consumption_evidence" CHECK (("platform_approvals"."status" = 'consumed') = ("platform_approvals"."consumed_at" IS NOT NULL AND "platform_approvals"."consumed_correlation_id" IS NOT NULL)),
	CONSTRAINT "platform_approvals_revocation_evidence" CHECK ("platform_approvals"."status" <> 'revoked' OR ("platform_approvals"."revoked_by" IS NOT NULL AND "platform_approvals"."revoked_at" IS NOT NULL AND "platform_approvals"."revoked_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_approvals" ADD CONSTRAINT "platform_approvals_requester_id_operators_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_approvals" ADD CONSTRAINT "platform_approvals_decided_by_operators_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_approvals" ADD CONSTRAINT "platform_approvals_revoked_by_operators_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_approvals_environment_created_idx" ON "platform_approvals" USING btree ("environment","created_at","id");--> statement-breakpoint
CREATE INDEX "platform_approvals_requester_idx" ON "platform_approvals" USING btree ("requester_id","created_at");
--> statement-breakpoint
CREATE FUNCTION public.guard_platform_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval_history_immutable';
  END IF;
  IF ROW(NEW.id, NEW.environment, NEW.requester_id, NEW.scope, NEW.scope_identity,
    NEW.reason, NEW.correlation_id, NEW.created_at, NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.environment, OLD.requester_id, OLD.scope,
    OLD.scope_identity, OLD.reason, OLD.correlation_id, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'approval_intent_immutable';
  END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'revoked'))
    OR (OLD.status = 'approved' AND NEW.status IN ('revoked', 'consumed'))) THEN
    RAISE EXCEPTION 'approval_transition_forbidden';
  END IF;
  IF OLD.decided_at IS NOT NULL AND ROW(NEW.decided_by, NEW.decided_at, NEW.decision_reason)
    IS DISTINCT FROM ROW(OLD.decided_by, OLD.decided_at, OLD.decision_reason) THEN
    RAISE EXCEPTION 'approval_decision_immutable';
  END IF;
  IF NEW.decided_at IS NOT NULL AND (NEW.decided_at < NEW.created_at OR NEW.decided_at >= NEW.expires_at) THEN
    RAISE EXCEPTION 'approval_decision_time_invalid';
  END IF;
  IF NEW.consumed_at IS NOT NULL AND (NEW.consumed_at < NEW.decided_at OR NEW.consumed_at >= NEW.expires_at) THEN
    RAISE EXCEPTION 'approval_consumption_time_invalid';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_approvals_guard BEFORE UPDATE OR DELETE ON public.platform_approvals
FOR EACH ROW EXECUTE FUNCTION public.guard_platform_approval();
--> statement-breakpoint
CREATE FUNCTION public.preserve_platform_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Bootstrap may update an invited/verifying owner before first activation.
  -- Once active, the platform must retain an active owner at transaction commit.
  IF OLD.is_super_administrator AND OLD.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.operators WHERE is_super_administrator AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'platform_owner_required';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER operators_preserve_platform_owner AFTER UPDATE OR DELETE ON public.operators
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.preserve_platform_owner();
