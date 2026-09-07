CREATE TYPE "public"."billing_checkout_state" AS ENUM('pending', 'ready', 'completed', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."billing_reconciliation_state" AS ENUM('matched', 'drift', 'failed');--> statement-breakpoint
CREATE TYPE "public"."billing_subscription_status" AS ENUM('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');--> statement-breakpoint
CREATE TABLE "billing_checkout_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"workspace_source_id" text NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"requested_by_operator_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"state" "billing_checkout_state" DEFAULT 'pending' NOT NULL,
	"provider_checkout_session_id" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_requests_identity_valid" CHECK ("billing_checkout_requests"."provider" = 'stripe' AND length(btrim("billing_checkout_requests"."workspace_source_id")) BETWEEN 1 AND 200 AND length("billing_checkout_requests"."provider_idempotency_key") BETWEEN 8 AND 200),
	CONSTRAINT "billing_checkout_requests_attempts_valid" CHECK ("billing_checkout_requests"."failures" BETWEEN 0 AND 5),
	CONSTRAINT "billing_checkout_requests_lease_valid" CHECK (("billing_checkout_requests"."lease_token" IS NULL AND "billing_checkout_requests"."lease_expires_at" IS NULL) OR ("billing_checkout_requests"."lease_token" IS NOT NULL AND "billing_checkout_requests"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "billing_checkout_requests_provider_fields_valid" CHECK (("billing_checkout_requests"."provider_checkout_session_id" IS NULL OR length("billing_checkout_requests"."provider_checkout_session_id") BETWEEN 3 AND 200) AND ("billing_checkout_requests"."provider_customer_id" IS NULL OR length("billing_checkout_requests"."provider_customer_id") BETWEEN 3 AND 200) AND ("billing_checkout_requests"."provider_subscription_id" IS NULL OR length("billing_checkout_requests"."provider_subscription_id") BETWEEN 3 AND 200) AND ("billing_checkout_requests"."last_error_code" IS NULL OR "billing_checkout_requests"."last_error_code" ~ '^[a-z][a-z0-9_.-]{2,79}$')),
	CONSTRAINT "billing_checkout_requests_state_valid" CHECK (("billing_checkout_requests"."state" = 'pending' AND "billing_checkout_requests"."provider_checkout_session_id" IS NULL AND "billing_checkout_requests"."checkout_url" IS NULL AND "billing_checkout_requests"."expires_at" IS NULL AND "billing_checkout_requests"."provider_subscription_id" IS NULL) OR ("billing_checkout_requests"."state" = 'ready' AND "billing_checkout_requests"."provider_checkout_session_id" IS NOT NULL AND "billing_checkout_requests"."checkout_url" LIKE 'https://checkout.stripe.com/%' AND "billing_checkout_requests"."expires_at" IS NOT NULL AND "billing_checkout_requests"."provider_subscription_id" IS NULL) OR ("billing_checkout_requests"."state" = 'completed' AND "billing_checkout_requests"."provider_checkout_session_id" IS NOT NULL AND "billing_checkout_requests"."provider_customer_id" IS NOT NULL AND "billing_checkout_requests"."provider_subscription_id" IS NOT NULL AND "billing_checkout_requests"."checkout_url" IS NULL AND "billing_checkout_requests"."expires_at" IS NOT NULL) OR ("billing_checkout_requests"."state" = 'expired' AND "billing_checkout_requests"."provider_checkout_session_id" IS NOT NULL AND "billing_checkout_requests"."checkout_url" IS NULL AND "billing_checkout_requests"."expires_at" IS NOT NULL) OR ("billing_checkout_requests"."state" = 'failed' AND "billing_checkout_requests"."checkout_url" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_provider_subscription_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_subscription_id" uuid NOT NULL,
	"checkout_request_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_provider_subscription_bindings_reference_valid" CHECK ("billing_provider_subscription_bindings"."provider" = 'stripe' AND length("billing_provider_subscription_bindings"."provider_subscription_id") BETWEEN 3 AND 200)
);
--> statement-breakpoint
CREATE TABLE "billing_subscription_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_subscription_id" uuid NOT NULL,
	"subscription_revision_number" integer NOT NULL,
	"state" "billing_reconciliation_state" NOT NULL,
	"reason_code" text,
	"provider_request_id" text,
	"observed_at" timestamp with time zone NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_observations_revision_positive" CHECK ("billing_subscription_observations"."subscription_revision_number" > 0),
	CONSTRAINT "billing_subscription_observations_reason_valid" CHECK (("billing_subscription_observations"."state" = 'matched' AND "billing_subscription_observations"."reason_code" IS NULL) OR ("billing_subscription_observations"."state" IN ('drift', 'failed') AND "billing_subscription_observations"."reason_code" ~ '^[a-z][a-z0-9_.-]{2,79}$')),
	CONSTRAINT "billing_subscription_observations_request_valid" CHECK ("billing_subscription_observations"."provider_request_id" IS NULL OR length("billing_subscription_observations"."provider_request_id") BETWEEN 3 AND 200)
);
--> statement-breakpoint
CREATE TABLE "billing_subscription_reconciliation_jobs" (
	"workspace_subscription_id" uuid PRIMARY KEY NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_reconciled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_reconciliation_jobs_failures_valid" CHECK ("billing_subscription_reconciliation_jobs"."failures" BETWEEN 0 AND 5),
	CONSTRAINT "billing_subscription_reconciliation_jobs_lease_valid" CHECK (("billing_subscription_reconciliation_jobs"."lease_token" IS NULL AND "billing_subscription_reconciliation_jobs"."lease_expires_at" IS NULL) OR ("billing_subscription_reconciliation_jobs"."lease_token" IS NOT NULL AND "billing_subscription_reconciliation_jobs"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "billing_subscription_reconciliation_jobs_error_valid" CHECK ("billing_subscription_reconciliation_jobs"."last_error_code" IS NULL OR "billing_subscription_reconciliation_jobs"."last_error_code" ~ '^[a-z][a-z0-9_.-]{2,79}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_billing_subscription_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_subscription_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"provider_binding_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"provider_customer_id" text NOT NULL,
	"status" "billing_subscription_status" NOT NULL,
	"quantity" integer NOT NULL,
	"cancel_at_period_end" boolean NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_end" timestamp with time zone,
	"provider_created_at" timestamp with time zone NOT NULL,
	"provider_data_sha256" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "workspace_billing_subscription_revisions_number_positive" CHECK ("workspace_billing_subscription_revisions"."revision_number" > 0),
	CONSTRAINT "workspace_billing_subscription_revisions_quantity_valid" CHECK ("workspace_billing_subscription_revisions"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "workspace_billing_subscription_revisions_period_valid" CHECK ("workspace_billing_subscription_revisions"."current_period_end" > "workspace_billing_subscription_revisions"."current_period_start" AND ("workspace_billing_subscription_revisions"."trial_end" IS NULL OR "workspace_billing_subscription_revisions"."trial_end" >= "workspace_billing_subscription_revisions"."provider_created_at")),
	CONSTRAINT "workspace_billing_subscription_revisions_provider_valid" CHECK (length("workspace_billing_subscription_revisions"."provider_customer_id") BETWEEN 3 AND 200 AND "workspace_billing_subscription_revisions"."provider_data_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_billing_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"workspace_source_id" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"current_provider_binding_id" uuid NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_billing_subscriptions_identity_valid" CHECK ("workspace_billing_subscriptions"."provider" = 'stripe' AND length(btrim("workspace_billing_subscriptions"."workspace_source_id")) BETWEEN 1 AND 200),
	CONSTRAINT "workspace_billing_subscriptions_revision_positive" CHECK ("workspace_billing_subscriptions"."current_revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_requests" ADD CONSTRAINT "billing_checkout_requests_plan_version_id_commercial_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."commercial_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_requests" ADD CONSTRAINT "billing_checkout_requests_requested_by_operator_id_operators_id_fk" FOREIGN KEY ("requested_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_requests" ADD CONSTRAINT "billing_checkout_requests_command_id_platform_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."platform_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_provider_subscription_bindings" ADD CONSTRAINT "billing_provider_subscription_bindings_workspace_subscription_id_workspace_billing_subscriptions_id_fk" FOREIGN KEY ("workspace_subscription_id") REFERENCES "public"."workspace_billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_provider_subscription_bindings" ADD CONSTRAINT "billing_provider_subscription_bindings_checkout_request_id_billing_checkout_requests_id_fk" FOREIGN KEY ("checkout_request_id") REFERENCES "public"."billing_checkout_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription_observations" ADD CONSTRAINT "billing_subscription_observations_workspace_subscription_id_workspace_billing_subscriptions_id_fk" FOREIGN KEY ("workspace_subscription_id") REFERENCES "public"."workspace_billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription_reconciliation_jobs" ADD CONSTRAINT "billing_subscription_reconciliation_jobs_workspace_subscription_id_workspace_billing_subscriptions_id_fk" FOREIGN KEY ("workspace_subscription_id") REFERENCES "public"."workspace_billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_billing_subscription_revisions" ADD CONSTRAINT "workspace_billing_subscription_revisions_workspace_subscription_id_workspace_billing_subscriptions_id_fk" FOREIGN KEY ("workspace_subscription_id") REFERENCES "public"."workspace_billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_billing_subscription_revisions" ADD CONSTRAINT "workspace_billing_subscription_revisions_provider_binding_id_billing_provider_subscription_bindings_id_fk" FOREIGN KEY ("provider_binding_id") REFERENCES "public"."billing_provider_subscription_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_billing_subscription_revisions" ADD CONSTRAINT "workspace_billing_subscription_revisions_plan_version_id_commercial_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."commercial_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_requests_command_unique" ON "billing_checkout_requests" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_requests_provider_key_unique" ON "billing_checkout_requests" USING btree ("provider","provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_requests_session_unique" ON "billing_checkout_requests" USING btree ("provider","provider_checkout_session_id") WHERE "billing_checkout_requests"."provider_checkout_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_requests_subscription_unique" ON "billing_checkout_requests" USING btree ("provider","provider_subscription_id") WHERE "billing_checkout_requests"."provider_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_requests_correlation_unique" ON "billing_checkout_requests" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_requests_workspace_active_unique" ON "billing_checkout_requests" USING btree ("environment","workspace_source_id") WHERE "billing_checkout_requests"."state" IN ('pending', 'ready');--> statement-breakpoint
CREATE INDEX "billing_checkout_requests_due_idx" ON "billing_checkout_requests" USING btree ("environment","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "billing_checkout_requests_history_idx" ON "billing_checkout_requests" USING btree ("environment","workspace_source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_subscription_bindings_provider_unique" ON "billing_provider_subscription_bindings" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_subscription_bindings_identity_unique" ON "billing_provider_subscription_bindings" USING btree ("id","workspace_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_subscription_bindings_checkout_unique" ON "billing_provider_subscription_bindings" USING btree ("checkout_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_observations_correlation_unique" ON "billing_subscription_observations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_observations_history_idx" ON "billing_subscription_observations" USING btree ("workspace_subscription_id","observed_at");--> statement-breakpoint
CREATE INDEX "billing_subscription_reconciliation_jobs_due_idx" ON "billing_subscription_reconciliation_jobs" USING btree ("next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_subscription_revisions_number_unique" ON "workspace_billing_subscription_revisions" USING btree ("workspace_subscription_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_subscription_revisions_pointer_unique" ON "workspace_billing_subscription_revisions" USING btree ("workspace_subscription_id","revision_number","provider_binding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_subscription_revisions_correlation_unique" ON "workspace_billing_subscription_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "workspace_billing_subscription_revisions_history_idx" ON "workspace_billing_subscription_revisions" USING btree ("workspace_subscription_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_subscriptions_workspace_unique" ON "workspace_billing_subscriptions" USING btree ("environment","workspace_source_id");
--> statement-breakpoint
ALTER TABLE "workspace_billing_subscriptions" ADD CONSTRAINT "workspace_billing_subscriptions_current_binding_fk" FOREIGN KEY ("current_provider_binding_id", "id") REFERENCES "billing_provider_subscription_bindings"("id", "workspace_subscription_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "workspace_billing_subscriptions" ADD CONSTRAINT "workspace_billing_subscriptions_current_revision_fk" FOREIGN KEY ("id", "current_revision_number", "current_provider_binding_id") REFERENCES "workspace_billing_subscription_revisions"("workspace_subscription_id", "revision_number", "provider_binding_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "workspace_billing_subscription_revisions" ADD CONSTRAINT "workspace_billing_subscription_revisions_binding_identity_fk" FOREIGN KEY ("provider_binding_id", "workspace_subscription_id") REFERENCES "billing_provider_subscription_bindings"("id", "workspace_subscription_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_subscription_observations" ADD CONSTRAINT "billing_subscription_observations_revision_fk" FOREIGN KEY ("workspace_subscription_id", "subscription_revision_number") REFERENCES "workspace_billing_subscription_revisions"("workspace_subscription_id", "revision_number") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION "reject_billing_immutable_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "billing_provider_subscription_bindings_immutable" BEFORE UPDATE OR DELETE ON "billing_provider_subscription_bindings" FOR EACH ROW EXECUTE FUNCTION "reject_billing_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "workspace_billing_subscription_revisions_immutable" BEFORE UPDATE OR DELETE ON "workspace_billing_subscription_revisions" FOR EACH ROW EXECUTE FUNCTION "reject_billing_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "billing_subscription_observations_immutable" BEFORE UPDATE OR DELETE ON "billing_subscription_observations" FOR EACH ROW EXECUTE FUNCTION "reject_billing_immutable_change"();
--> statement-breakpoint
CREATE FUNCTION "guard_workspace_billing_subscription_pointer"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'workspace billing subscriptions cannot be deleted' USING ERRCODE = '23000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.workspace_source_id IS DISTINCT FROM OLD.workspace_source_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.current_revision_number <> OLD.current_revision_number + 1
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid workspace billing subscription pointer transition' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_billing_subscriptions_pointer_guard" BEFORE UPDATE OR DELETE ON "workspace_billing_subscriptions" FOR EACH ROW EXECUTE FUNCTION "guard_workspace_billing_subscription_pointer"();
--> statement-breakpoint
CREATE FUNCTION "guard_billing_checkout_request_transition"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing checkout requests cannot be deleted' USING ERRCODE = '23000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.workspace_source_id IS DISTINCT FROM OLD.workspace_source_id
     OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
     OR NEW.requested_by_operator_id IS DISTINCT FROM OLD.requested_by_operator_id
     OR NEW.command_id IS DISTINCT FROM OLD.command_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at < OLD.updated_at
     OR (OLD.state = 'pending' AND NEW.state NOT IN ('pending', 'ready', 'failed'))
     OR (OLD.state = 'ready' AND NEW.state NOT IN ('ready', 'completed', 'expired', 'failed'))
     OR (OLD.state IN ('completed', 'expired', 'failed') AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'invalid billing checkout request transition' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "billing_checkout_requests_transition_guard" BEFORE UPDATE OR DELETE ON "billing_checkout_requests" FOR EACH ROW EXECUTE FUNCTION "guard_billing_checkout_request_transition"();
--> statement-breakpoint
CREATE FUNCTION "guard_billing_reconciliation_job"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing reconciliation jobs cannot be deleted' USING ERRCODE = '23000';
  END IF;
  IF NEW.workspace_subscription_id IS DISTINCT FROM OLD.workspace_subscription_id
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid billing reconciliation job transition' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "billing_subscription_reconciliation_jobs_guard" BEFORE UPDATE OR DELETE ON "billing_subscription_reconciliation_jobs" FOR EACH ROW EXECUTE FUNCTION "guard_billing_reconciliation_job"();
