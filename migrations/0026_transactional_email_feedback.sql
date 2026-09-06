CREATE TABLE "transactional_email_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"event_type" text NOT NULL,
	"verification_delivery_id" uuid,
	"operational_alert_delivery_id" uuid,
	"payload_digest" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactional_email_provider_events_type_valid" CHECK ("transactional_email_provider_events"."event_type" IN ('email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.complained','email.suppressed')),
	CONSTRAINT "transactional_email_provider_events_target_valid" CHECK (NOT ("transactional_email_provider_events"."verification_delivery_id" IS NOT NULL AND "transactional_email_provider_events"."operational_alert_delivery_id" IS NOT NULL)),
	CONSTRAINT "transactional_email_provider_events_digest_valid" CHECK ("transactional_email_provider_events"."payload_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "transactional_email_recipient_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"recipient_fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactional_email_recipient_suppressions_reason_valid" CHECK ("transactional_email_recipient_suppressions"."reason" IN ('bounced','complained','failed','suppressed')),
	CONSTRAINT "transactional_email_recipient_suppressions_fingerprint_valid" CHECK (length("transactional_email_recipient_suppressions"."recipient_fingerprint") BETWEEN 6 AND 128)
);
--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" DROP CONSTRAINT "operational_alert_deliveries_state";--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" DROP CONSTRAINT "operational_alert_deliveries_receipt";--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" DROP CONSTRAINT "verification_email_delivery_state";--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" DROP CONSTRAINT "verification_email_delivery_receipt";--> statement-breakpoint
DROP TRIGGER "operational_alert_deliveries_guard" ON "operational_alert_deliveries";--> statement-breakpoint
DROP TRIGGER "verification_email_delivery_guard" ON "verification_email_deliveries";--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD COLUMN "recipient_fingerprint" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE "operational_alert_deliveries" SET "recipient_fingerprint" = 'legacy:' || "id"::text WHERE "recipient_fingerprint" = 'legacy';--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ALTER COLUMN "recipient_fingerprint" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD COLUMN "template_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD COLUMN "template_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD COLUMN "recipient_fingerprint" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE "verification_email_deliveries" SET "recipient_fingerprint" = 'legacy:' || "id"::text WHERE "recipient_fingerprint" = 'legacy';--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ALTER COLUMN "recipient_fingerprint" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD COLUMN "template_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD COLUMN "template_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactional_email_provider_events" ADD CONSTRAINT "transactional_email_provider_events_verification_delivery_id_verification_email_deliveries_id_fk" FOREIGN KEY ("verification_delivery_id") REFERENCES "public"."verification_email_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactional_email_provider_events" ADD CONSTRAINT "transactional_email_provider_events_operational_alert_delivery_id_operational_alert_deliveries_id_fk" FOREIGN KEY ("operational_alert_delivery_id") REFERENCES "public"."operational_alert_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD CONSTRAINT "transactional_email_recipient_suppressions_source_event_id_transactional_email_provider_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."transactional_email_provider_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_email_provider_events_identity_unique" ON "transactional_email_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "transactional_email_provider_events_message_idx" ON "transactional_email_provider_events" USING btree ("environment","provider_message_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactional_email_provider_events_history_idx" ON "transactional_email_provider_events" USING btree ("environment","received_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_email_recipient_suppressions_identity_unique" ON "transactional_email_recipient_suppressions" USING btree ("environment","recipient_fingerprint");--> statement-breakpoint
CREATE INDEX "transactional_email_recipient_suppressions_source_idx" ON "transactional_email_recipient_suppressions" USING btree ("source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_email_delivery_provider_message_unique" ON "verification_email_deliveries" USING btree ("environment","provider_message_id") WHERE "verification_email_deliveries"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "operational_alert_deliveries_provider_message_unique" ON "operational_alert_deliveries" USING btree ("environment","provider_message_id") WHERE "operational_alert_deliveries"."provider_message_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD CONSTRAINT "operational_alert_deliveries_communication_identity" CHECK (length("operational_alert_deliveries"."recipient_fingerprint") BETWEEN 6 AND 128 AND "operational_alert_deliveries"."template_version" IN ('v1','v2') AND "operational_alert_deliveries"."template_locale" IN ('en','hi'));--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD CONSTRAINT "operational_alert_deliveries_state" CHECK ("operational_alert_deliveries"."state" IN ('pending','leased','accepted','delivered','bounced','complained','dead_letter'));--> statement-breakpoint
ALTER TABLE "operational_alert_deliveries" ADD CONSTRAINT "operational_alert_deliveries_receipt" CHECK (("operational_alert_deliveries"."state" IN ('accepted','delivered','bounced','complained')) = ("operational_alert_deliveries"."provider_message_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD CONSTRAINT "verification_email_delivery_communication_identity" CHECK (length("verification_email_deliveries"."recipient_fingerprint") BETWEEN 6 AND 128 AND "verification_email_deliveries"."template_version" IN ('v1','v2') AND "verification_email_deliveries"."template_locale" IN ('en','hi'));--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD CONSTRAINT "verification_email_delivery_state" CHECK ("verification_email_deliveries"."state" IN ('pending','leased','accepted','delivered','bounced','complained','expired','cancelled','dead_letter'));--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD CONSTRAINT "verification_email_delivery_receipt" CHECK (("verification_email_deliveries"."state" IN ('accepted','delivered','bounced','complained')) = ("verification_email_deliveries"."provider_message_id" IS NOT NULL));--> statement-breakpoint

INSERT INTO "platform_configuration_definitions" ("id", "key", "category", "name", "description", "value_type", "validation", "default_value", "is_mutable") VALUES
  ('00000000-0000-4000-8000-000000000207', 'communications.transactional_template_version', 'communications', 'Transactional email template', 'Active source-controlled revision used for newly queued transactional email.', 'string', '{"allowedValues":["v1","v2"]}'::jsonb, '"v2"'::jsonb, true),
  ('00000000-0000-4000-8000-000000000208', 'communications.default_locale', 'communications', 'Transactional email locale', 'Default locale used for newly queued transactional email.', 'string', '{"allowedValues":["en","hi"]}'::jsonb, '"en"'::jsonb, true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_verification_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'email_delivery_history_immutable'; END IF;
  IF ROW(NEW.id, NEW.environment, NEW.operator_id, NEW.verification_id, NEW.created_at, NEW.expires_at, NEW.correlation_id,
         NEW.recipient_fingerprint, NEW.template_version, NEW.template_locale)
    IS DISTINCT FROM ROW(OLD.id, OLD.environment, OLD.operator_id, OLD.verification_id, OLD.created_at, OLD.expires_at, OLD.correlation_id,
         OLD.recipient_fingerprint, OLD.template_version, OLD.template_locale) THEN
    RAISE EXCEPTION 'email_delivery_identity_immutable';
  END IF;
  IF OLD.state = 'pending' AND NEW.state NOT IN ('pending','leased','cancelled','expired','dead_letter') THEN
    RAISE EXCEPTION 'email_delivery_transition_forbidden';
  ELSIF OLD.state = 'leased' AND NEW.state NOT IN ('pending','leased','accepted','cancelled','expired','dead_letter') THEN
    RAISE EXCEPTION 'email_delivery_transition_forbidden';
  ELSIF OLD.state = 'accepted' AND NEW.state NOT IN ('accepted','delivered','bounced','complained') THEN
    RAISE EXCEPTION 'email_delivery_transition_forbidden';
  ELSIF OLD.state = 'delivered' AND NEW.state NOT IN ('bounced','complained') THEN
    RAISE EXCEPTION 'email_delivery_transition_forbidden';
  ELSIF OLD.state = 'bounced' AND NEW.state <> 'complained' THEN
    RAISE EXCEPTION 'email_delivery_transition_forbidden';
  ELSIF OLD.state IN ('complained','expired','cancelled','dead_letter') THEN
    RAISE EXCEPTION 'email_delivery_terminal';
  END IF;
  IF NEW.encrypted_payload IS NOT NULL AND NEW.encrypted_payload IS DISTINCT FROM OLD.encrypted_payload THEN
    RAISE EXCEPTION 'email_delivery_payload_immutable';
  END IF;
  IF OLD.state IN ('accepted','delivered','bounced') AND
     ROW(NEW.encrypted_payload, NEW.attempts, NEW.lease_token, NEW.lease_expires_at, NEW.next_attempt_at, NEW.provider_message_id)
       IS DISTINCT FROM
     ROW(OLD.encrypted_payload, OLD.attempts, OLD.lease_token, OLD.lease_expires_at, OLD.next_attempt_at, OLD.provider_message_id) THEN
    RAISE EXCEPTION 'email_delivery_receipt_identity_immutable';
  END IF;
  IF NEW.state = 'leased' THEN
    IF NEW.attempts <> OLD.attempts + 1 OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token
      OR NEW.lease_expires_at <= clock_timestamp() OR NEW.lease_expires_at > clock_timestamp() + interval '61 seconds'
      OR (OLD.state = 'leased' AND OLD.lease_expires_at > clock_timestamp()) THEN
      RAISE EXCEPTION 'email_delivery_lease_invalid';
    END IF;
  ELSIF NEW.attempts <> OLD.attempts THEN
    RAISE EXCEPTION 'email_delivery_attempts_immutable';
  END IF;
  IF NEW.state IN ('pending','leased') AND NEW.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'email_delivery_expired';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER verification_email_delivery_guard BEFORE UPDATE OR DELETE ON public.verification_email_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_verification_email_delivery();--> statement-breakpoint

CREATE OR REPLACE FUNCTION operational_alert_deliveries_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occurrence_environment platform_configuration_environment;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'operational alert deliveries are append-only'; END IF;
  SELECT environment INTO occurrence_environment FROM operational_alert_occurrences WHERE id = NEW.occurrence_id;
  IF occurrence_environment IS NULL OR occurrence_environment <> NEW.environment THEN
    RAISE EXCEPTION 'operational alert delivery environment mismatch';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.occurrence_id, NEW.environment, NEW.kind, NEW.created_at, NEW.recipient_fingerprint, NEW.template_version, NEW.template_locale)
      IS DISTINCT FROM ROW(OLD.id, OLD.occurrence_id, OLD.environment, OLD.kind, OLD.created_at, OLD.recipient_fingerprint, OLD.template_version, OLD.template_locale)
      OR NEW.attempts < OLD.attempts THEN
      RAISE EXCEPTION 'operational alert delivery identity is immutable';
    END IF;
    IF OLD.state = 'pending' AND NEW.state NOT IN ('pending','leased','dead_letter') THEN
      RAISE EXCEPTION 'invalid operational alert delivery transition';
    ELSIF OLD.state = 'leased' AND NEW.state NOT IN ('pending','leased','accepted','dead_letter') THEN
      RAISE EXCEPTION 'invalid operational alert delivery transition';
    ELSIF OLD.state = 'accepted' AND NEW.state NOT IN ('accepted','delivered','bounced','complained') THEN
      RAISE EXCEPTION 'invalid operational alert delivery transition';
    ELSIF OLD.state = 'delivered' AND NEW.state NOT IN ('bounced','complained') THEN
      RAISE EXCEPTION 'invalid operational alert delivery transition';
    ELSIF OLD.state = 'bounced' AND NEW.state <> 'complained' THEN
      RAISE EXCEPTION 'invalid operational alert delivery transition';
    ELSIF OLD.state IN ('complained','dead_letter') THEN
      RAISE EXCEPTION 'terminal operational alert deliveries are immutable';
    END IF;
    IF OLD.state IN ('accepted','delivered','bounced') AND
       ROW(NEW.attempts, NEW.lease_token, NEW.lease_expires_at, NEW.next_attempt_at, NEW.provider_message_id)
         IS DISTINCT FROM
       ROW(OLD.attempts, OLD.lease_token, OLD.lease_expires_at, OLD.next_attempt_at, OLD.provider_message_id) THEN
      RAISE EXCEPTION 'operational alert receipt identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER operational_alert_deliveries_guard
BEFORE INSERT OR UPDATE OR DELETE ON operational_alert_deliveries
FOR EACH ROW EXECUTE FUNCTION operational_alert_deliveries_guard_fn();--> statement-breakpoint

CREATE FUNCTION prevent_transactional_email_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'transactional email provider evidence is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER transactional_email_provider_events_immutable
BEFORE UPDATE OR DELETE ON transactional_email_provider_events
FOR EACH ROW EXECUTE FUNCTION prevent_transactional_email_evidence_mutation();--> statement-breakpoint
CREATE TRIGGER transactional_email_recipient_suppressions_immutable
BEFORE UPDATE OR DELETE ON transactional_email_recipient_suppressions
FOR EACH ROW EXECUTE FUNCTION prevent_transactional_email_evidence_mutation();
