ALTER TYPE "public"."model_provider_health_source" ADD VALUE 'scheduled_probe';--> statement-breakpoint
ALTER TYPE "public"."platform_integration_health_source" ADD VALUE 'scheduled_probe';--> statement-breakpoint
CREATE FUNCTION platform_http_health_probe_valid(probe jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  status jsonb;
  timeout_ms integer;
  interval_seconds integer;
BEGIN
  IF jsonb_typeof(probe) <> 'object'
    OR jsonb_typeof(probe->'url') <> 'string'
    OR (probe->>'url') !~ '^https://[^[:space:]@?#]+(?:/[^[:space:]?#]*)?$'
    OR lower(probe->>'url') ~ '^https://(?:localhost|[^/]+\.localhost|[^/]+\.local|[^/]+\.internal)(?::[0-9]+)?(?:/|$)'
    OR (probe->>'url') ~ '^https://(?:(?:0|10|127)(?:\.[0-9]{1,3}){3}|169\.254(?:\.[0-9]{1,3}){2}|172\.(?:1[6-9]|2[0-9]|3[01])(?:\.[0-9]{1,3}){2}|192\.168(?:\.[0-9]{1,3}){2}|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])(?:\.[0-9]{1,3}){2}|198\.(?:18|19)(?:\.[0-9]{1,3}){2})(?::[0-9]+)?(?:/|$)'
    OR lower(probe->>'url') ~ '^https://\[(?:::|::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe[89ab][0-9a-f]:|::ffff:)'
    OR probe->>'method' NOT IN ('GET', 'HEAD')
    OR jsonb_typeof(probe->'expectedStatusCodes') <> 'array'
    OR jsonb_array_length(probe->'expectedStatusCodes') NOT BETWEEN 1 AND 32
    OR jsonb_typeof(probe->'timeoutMs') <> 'number'
    OR jsonb_typeof(probe->'intervalSeconds') <> 'number' THEN
    RETURN false;
  END IF;
  timeout_ms := (probe->>'timeoutMs')::integer;
  interval_seconds := (probe->>'intervalSeconds')::integer;
  IF timeout_ms NOT BETWEEN 500 AND 10000
    OR interval_seconds NOT BETWEEN 60 AND 3600
    OR interval_seconds % 60 <> 0 THEN
    RETURN false;
  END IF;
  FOR status IN SELECT value FROM jsonb_array_elements(probe->'expectedStatusCodes') LOOP
    IF jsonb_typeof(status) <> 'number'
      OR (status #>> '{}')::numeric <> trunc((status #>> '{}')::numeric)
      OR (status #>> '{}')::integer NOT BETWEEN 100 AND 599 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "platform_health_probe_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"provider_id" uuid,
	"integration_id" uuid,
	"target_revision_number" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"probe" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_health_probe_jobs_single_target" CHECK (("platform_health_probe_jobs"."provider_id" IS NOT NULL) <> ("platform_health_probe_jobs"."integration_id" IS NOT NULL)),
	CONSTRAINT "platform_health_probe_jobs_revision_positive" CHECK ("platform_health_probe_jobs"."target_revision_number" > 0),
	CONSTRAINT "platform_health_probe_jobs_attempts_bounds" CHECK ("platform_health_probe_jobs"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "platform_health_probe_jobs_state_valid" CHECK ("platform_health_probe_jobs"."state" IN ('pending', 'leased', 'completed', 'superseded')),
	CONSTRAINT "platform_health_probe_jobs_lease_consistent" CHECK (("platform_health_probe_jobs"."state" = 'leased' AND "platform_health_probe_jobs"."lease_token" IS NOT NULL AND "platform_health_probe_jobs"."lease_expires_at" IS NOT NULL AND "platform_health_probe_jobs"."completed_at" IS NULL) OR ("platform_health_probe_jobs"."state" <> 'leased' AND "platform_health_probe_jobs"."lease_token" IS NULL AND "platform_health_probe_jobs"."lease_expires_at" IS NULL)),
	CONSTRAINT "platform_health_probe_jobs_completion_consistent" CHECK (("platform_health_probe_jobs"."state" IN ('completed', 'superseded')) = ("platform_health_probe_jobs"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "model_provider_health_observations" ALTER COLUMN "recorded_by_operator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_integration_health_observations" ALTER COLUMN "recorded_by_operator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_revisions" ADD COLUMN "health_probe" jsonb;--> statement-breakpoint
ALTER TABLE "platform_integration_revisions" ADD COLUMN "health_probe" jsonb;--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" ADD CONSTRAINT "platform_health_probe_jobs_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" ADD CONSTRAINT "platform_health_probe_jobs_integration_id_platform_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."platform_integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_health_probe_jobs_provider_window_unique" ON "platform_health_probe_jobs" USING btree ("environment","provider_id","target_revision_number","scheduled_for") WHERE "platform_health_probe_jobs"."provider_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_health_probe_jobs_integration_window_unique" ON "platform_health_probe_jobs" USING btree ("environment","integration_id","target_revision_number","scheduled_for") WHERE "platform_health_probe_jobs"."integration_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_health_probe_jobs_claim_idx" ON "platform_health_probe_jobs" USING btree ("environment","state","next_attempt_at","scheduled_for");--> statement-breakpoint
ALTER TABLE "model_provider_health_observations" ADD CONSTRAINT "model_provider_health_source_actor_consistent" CHECK (("model_provider_health_observations"."source"::text = 'operator_probe' AND "model_provider_health_observations"."recorded_by_operator_id" IS NOT NULL) OR ("model_provider_health_observations"."source"::text = 'scheduled_probe' AND "model_provider_health_observations"."recorded_by_operator_id" IS NULL));--> statement-breakpoint
ALTER TABLE "platform_integration_health_observations" ADD CONSTRAINT "platform_integration_health_source_actor_consistent" CHECK (("platform_integration_health_observations"."source"::text = 'operator_probe' AND "platform_integration_health_observations"."recorded_by_operator_id" IS NOT NULL) OR ("platform_integration_health_observations"."source"::text = 'scheduled_probe' AND "platform_integration_health_observations"."recorded_by_operator_id" IS NULL));
--> statement-breakpoint
CREATE FUNCTION platform_health_probe_jobs_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_environment platform_configuration_environment;
  current_revision integer;
  configured_probe jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('completed', 'superseded')
      AND OLD.completed_at < clock_timestamp() - interval '30 days' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'platform health probe job is still retained';
  END IF;
  IF NEW.provider_id IS NOT NULL THEN
    SELECT provider.environment, provider.current_revision_number, revision.health_probe
      INTO target_environment, current_revision, configured_probe
    FROM model_providers provider
    JOIN model_provider_revisions revision
      ON revision.provider_id = provider.id
      AND revision.revision_number = provider.current_revision_number
    WHERE provider.id = NEW.provider_id;
  ELSE
    SELECT integration.environment, integration.current_revision_number, revision.health_probe
      INTO target_environment, current_revision, configured_probe
    FROM platform_integrations integration
    JOIN platform_integration_revisions revision
      ON revision.integration_id = integration.id
      AND revision.revision_number = integration.current_revision_number
    WHERE integration.id = NEW.integration_id;
  END IF;
  IF target_environment IS NULL OR target_environment <> NEW.environment THEN
    RAISE EXCEPTION 'platform health probe target environment mismatch';
  END IF;
  IF TG_OP = 'INSERT' AND
    (current_revision <> NEW.target_revision_number OR configured_probe IS DISTINCT FROM NEW.probe) THEN
    RAISE EXCEPTION 'platform health probe contract is not current';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.environment <> OLD.environment
      OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
      OR NEW.integration_id IS DISTINCT FROM OLD.integration_id
      OR NEW.target_revision_number <> OLD.target_revision_number
      OR NEW.scheduled_for <> OLD.scheduled_for OR NEW.probe <> OLD.probe
      OR NEW.created_at <> OLD.created_at OR NEW.attempts < OLD.attempts THEN
      RAISE EXCEPTION 'platform health probe job identity is immutable';
    END IF;
    IF OLD.state IN ('completed', 'superseded') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal platform health probe jobs are immutable';
    END IF;
    IF (OLD.state = 'pending' AND NEW.state NOT IN ('pending', 'leased'))
      OR (OLD.state = 'leased' AND NEW.state NOT IN ('leased', 'completed', 'superseded')) THEN
      RAISE EXCEPTION 'invalid platform health probe job transition';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER platform_health_probe_jobs_guard
BEFORE INSERT OR UPDATE OR DELETE ON platform_health_probe_jobs
FOR EACH ROW EXECUTE FUNCTION platform_health_probe_jobs_guard_fn();
