CREATE TABLE "operational_alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"reason" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_alert_deliveries_kind" CHECK ("operational_alert_deliveries"."kind" IN ('triggered','resolved')),
	CONSTRAINT "operational_alert_deliveries_state" CHECK ("operational_alert_deliveries"."state" IN ('pending','leased','accepted','dead_letter')),
	CONSTRAINT "operational_alert_deliveries_attempts" CHECK ("operational_alert_deliveries"."attempts" BETWEEN 0 AND 8),
	CONSTRAINT "operational_alert_deliveries_lease" CHECK (("operational_alert_deliveries"."state" = 'leased' AND "operational_alert_deliveries"."lease_token" IS NOT NULL AND "operational_alert_deliveries"."lease_expires_at" IS NOT NULL) OR ("operational_alert_deliveries"."state" <> 'leased' AND "operational_alert_deliveries"."lease_token" IS NULL AND "operational_alert_deliveries"."lease_expires_at" IS NULL)),
	CONSTRAINT "operational_alert_deliveries_receipt" CHECK (("operational_alert_deliveries"."state" = 'accepted') = ("operational_alert_deliveries"."provider_message_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "operational_alert_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"alert_key" text NOT NULL,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"affected_count" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"next_step" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_alert_occurrences_status" CHECK ("operational_alert_occurrences"."status" IN ('open','resolved')),
	CONSTRAINT "operational_alert_occurrences_severity" CHECK ("operational_alert_occurrences"."severity" IN ('critical','warning')),
	CONSTRAINT "operational_alert_occurrences_identity" CHECK (length("operational_alert_occurrences"."alert_key") BETWEEN 3 AND 240 AND length("operational_alert_occurrences"."source") BETWEEN 1 AND 64 AND length("operational_alert_occurrences"."code") BETWEEN 1 AND 64),
	CONSTRAINT "operational_alert_occurrences_content" CHECK (length("operational_alert_occurrences"."title") BETWEEN 1 AND 200 AND length("operational_alert_occurrences"."description") BETWEEN 1 AND 1000 AND length("operational_alert_occurrences"."next_step") BETWEEN 1 AND 1000),
	CONSTRAINT "operational_alert_occurrences_count" CHECK ("operational_alert_occurrences"."affected_count" IS NULL OR "operational_alert_occurrences"."affected_count" >= 0),
	CONSTRAINT "operational_alert_occurrences_times" CHECK ("operational_alert_occurrences"."last_seen_at" >= "operational_alert_occurrences"."first_seen_at" AND (("operational_alert_occurrences"."status" = 'open' AND "operational_alert_occurrences"."resolved_at" IS NULL) OR ("operational_alert_occurrences"."status" = 'resolved' AND "operational_alert_occurrences"."resolved_at" IS NOT NULL AND "operational_alert_occurrences"."resolved_at" >= "operational_alert_occurrences"."last_seen_at")))
);
--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD CONSTRAINT "operational_alert_deliveries_occurrence_id_operational_alert_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."operational_alert_occurrences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operational_alert_deliveries_transition_unique" ON "operational_alert_deliveries" USING btree ("occurrence_id","kind");--> statement-breakpoint
CREATE INDEX "operational_alert_deliveries_due_idx" ON "operational_alert_deliveries" USING btree ("environment","state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "operational_alert_deliveries_history_idx" ON "operational_alert_deliveries" USING btree ("environment","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_alert_occurrences_open_unique" ON "operational_alert_occurrences" USING btree ("environment","alert_key") WHERE "operational_alert_occurrences"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "operational_alert_occurrences_history_idx" ON "operational_alert_occurrences" USING btree ("environment","first_seen_at","id");
--> statement-breakpoint
CREATE FUNCTION operational_alert_occurrences_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operational alert occurrences are append-only';
  END IF;
  IF NEW.id <> OLD.id OR NEW.environment <> OLD.environment OR NEW.alert_key <> OLD.alert_key
    OR NEW.first_seen_at <> OLD.first_seen_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'operational alert occurrence identity is immutable';
  END IF;
  IF OLD.status = 'resolved' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'resolved operational alert occurrences are immutable';
  END IF;
  IF OLD.status = 'open' AND NEW.status NOT IN ('open', 'resolved') THEN
    RAISE EXCEPTION 'invalid operational alert occurrence transition';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER operational_alert_occurrences_guard
BEFORE UPDATE OR DELETE ON operational_alert_occurrences
FOR EACH ROW EXECUTE FUNCTION operational_alert_occurrences_guard_fn();
--> statement-breakpoint
CREATE FUNCTION operational_alert_deliveries_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occurrence_environment platform_configuration_environment;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operational alert deliveries are append-only';
  END IF;
  SELECT environment INTO occurrence_environment
  FROM operational_alert_occurrences WHERE id = NEW.occurrence_id;
  IF occurrence_environment IS NULL OR occurrence_environment <> NEW.environment THEN
    RAISE EXCEPTION 'operational alert delivery environment mismatch';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.occurrence_id <> OLD.occurrence_id
      OR NEW.environment <> OLD.environment OR NEW.kind <> OLD.kind
      OR NEW.created_at <> OLD.created_at OR NEW.attempts < OLD.attempts THEN
      RAISE EXCEPTION 'operational alert delivery identity is immutable';
    END IF;
    IF OLD.state IN ('accepted', 'dead_letter') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal operational alert deliveries are immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER operational_alert_deliveries_guard
BEFORE INSERT OR UPDATE OR DELETE ON operational_alert_deliveries
FOR EACH ROW EXECUTE FUNCTION operational_alert_deliveries_guard_fn();
