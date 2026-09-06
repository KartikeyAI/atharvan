CREATE TABLE "operational_retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"counts" jsonb,
	"batch_limit_reached" boolean,
	"error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_retention_runs_hour_window" CHECK ("operational_retention_runs"."scheduled_for" = date_trunc('hour', "operational_retention_runs"."scheduled_for")),
	CONSTRAINT "operational_retention_runs_attempts_bounded" CHECK ("operational_retention_runs"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "operational_retention_runs_lease_shape" CHECK (("operational_retention_runs"."state" = 'running' AND "operational_retention_runs"."lease_token" IS NOT NULL AND "operational_retention_runs"."lease_expires_at" IS NOT NULL) OR ("operational_retention_runs"."state" <> 'running' AND "operational_retention_runs"."lease_token" IS NULL AND "operational_retention_runs"."lease_expires_at" IS NULL)),
	CONSTRAINT "operational_retention_runs_completion_shape" CHECK (("operational_retention_runs"."state" = 'completed' AND "operational_retention_runs"."counts" IS NOT NULL AND "operational_retention_runs"."batch_limit_reached" IS NOT NULL AND "operational_retention_runs"."error_code" IS NULL AND "operational_retention_runs"."completed_at" IS NOT NULL) OR ("operational_retention_runs"."state" = 'failed' AND "operational_retention_runs"."counts" IS NULL AND "operational_retention_runs"."batch_limit_reached" IS NULL AND "operational_retention_runs"."error_code" IS NOT NULL AND "operational_retention_runs"."completed_at" IS NOT NULL) OR ("operational_retention_runs"."state" IN ('pending','running') AND "operational_retention_runs"."counts" IS NULL AND "operational_retention_runs"."batch_limit_reached" IS NULL AND "operational_retention_runs"."error_code" IS NULL AND "operational_retention_runs"."completed_at" IS NULL)),
	CONSTRAINT "operational_retention_runs_error_code_valid" CHECK ("operational_retention_runs"."error_code" IS NULL OR "operational_retention_runs"."error_code" ~ '^[a-z][a-z0-9_]{2,79}$'),
	CONSTRAINT "operational_retention_runs_completion_time_valid" CHECK ("operational_retention_runs"."completed_at" IS NULL OR "operational_retention_runs"."completed_at" >= "operational_retention_runs"."scheduled_for"),
	CONSTRAINT "operational_retention_runs_counts_valid" CHECK ("operational_retention_runs"."counts" IS NULL OR (jsonb_typeof("operational_retention_runs"."counts") = 'object' AND jsonb_typeof("operational_retention_runs"."counts"->'workload_request_nonces') = 'number' AND ("operational_retention_runs"."counts"->>'workload_request_nonces')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'health_probe_jobs') = 'number' AND ("operational_retention_runs"."counts"->>'health_probe_jobs')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'transactional_email_provider_events') = 'number' AND ("operational_retention_runs"."counts"->>'transactional_email_provider_events')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'verification_email_deliveries') = 'number' AND ("operational_retention_runs"."counts"->>'verification_email_deliveries')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'operational_alert_deliveries') = 'number' AND ("operational_retention_runs"."counts"->>'operational_alert_deliveries')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'operational_alert_occurrences') = 'number' AND ("operational_retention_runs"."counts"->>'operational_alert_occurrences')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'model_health_observations') = 'number' AND ("operational_retention_runs"."counts"->>'model_health_observations')::integer BETWEEN 0 AND 1000 AND jsonb_typeof("operational_retention_runs"."counts"->'integration_health_observations') = 'number' AND ("operational_retention_runs"."counts"->>'integration_health_observations')::integer BETWEEN 0 AND 1000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_retention_runs_window_unique" ON "operational_retention_runs" USING btree ("environment","scheduled_for");--> statement-breakpoint
CREATE INDEX "operational_retention_runs_due_idx" ON "operational_retention_runs" USING btree ("environment","state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "operational_retention_runs_history_idx" ON "operational_retention_runs" USING btree ("environment","scheduled_for");--> statement-breakpoint
CREATE INDEX "operational_alert_occurrences_retention_idx" ON "operational_alert_occurrences" USING btree ("environment","status","resolved_at");--> statement-breakpoint
CREATE FUNCTION guard_operational_retention_run() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operational_retention_run_delete_forbidden';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.environment IS DISTINCT FROM NEW.environment
    OR OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'operational_retention_run_identity_immutable';
  END IF;
  IF OLD.state IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'operational_retention_run_terminal';
  END IF;
  IF OLD.state = 'pending' AND NEW.state <> 'running' THEN
    RAISE EXCEPTION 'operational_retention_run_transition_invalid';
  END IF;
  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN
    RAISE EXCEPTION 'operational_retention_run_attempt_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER operational_retention_runs_guard
BEFORE UPDATE OR DELETE ON operational_retention_runs
FOR EACH ROW EXECUTE FUNCTION guard_operational_retention_run();
