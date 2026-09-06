DROP INDEX "transactional_email_recipient_suppressions_identity_unique";--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD COLUMN "lifted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD COLUMN "lifted_by_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD COLUMN "lift_reason" text;--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD COLUMN "lift_correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD CONSTRAINT "transactional_email_recipient_suppressions_lifted_by_operator_id_operators_id_fk" FOREIGN KEY ("lifted_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_email_recipient_suppressions_identity_unique" ON "transactional_email_recipient_suppressions" USING btree ("environment","recipient_fingerprint") WHERE "transactional_email_recipient_suppressions"."lifted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "transactional_email_recipient_suppressions" ADD CONSTRAINT "transactional_email_recipient_suppressions_lifecycle_valid" CHECK (("transactional_email_recipient_suppressions"."lifted_at" IS NULL AND "transactional_email_recipient_suppressions"."lifted_by_operator_id" IS NULL AND "transactional_email_recipient_suppressions"."lift_reason" IS NULL AND "transactional_email_recipient_suppressions"."lift_correlation_id" IS NULL) OR ("transactional_email_recipient_suppressions"."lifted_at" IS NOT NULL AND "transactional_email_recipient_suppressions"."lifted_by_operator_id" IS NOT NULL AND length("transactional_email_recipient_suppressions"."lift_reason") BETWEEN 8 AND 500 AND "transactional_email_recipient_suppressions"."lift_correlation_id" IS NOT NULL AND "transactional_email_recipient_suppressions"."lifted_at" >= "transactional_email_recipient_suppressions"."created_at"));
--> statement-breakpoint
DROP TRIGGER "transactional_email_recipient_suppressions_immutable" ON "transactional_email_recipient_suppressions";--> statement-breakpoint
CREATE FUNCTION guard_transactional_email_recipient_suppression() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactional email recipient suppression history is immutable';
  END IF;
  IF ROW(NEW.id, NEW.environment, NEW.recipient_fingerprint, NEW.reason, NEW.source_event_id, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.environment, OLD.recipient_fingerprint, OLD.reason, OLD.source_event_id, OLD.created_at) THEN
    RAISE EXCEPTION 'transactional email recipient suppression identity is immutable';
  END IF;
  IF OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL THEN
    RAISE EXCEPTION 'transactional email recipient suppression transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER transactional_email_recipient_suppressions_guard
BEFORE UPDATE OR DELETE ON transactional_email_recipient_suppressions
FOR EACH ROW EXECUTE FUNCTION guard_transactional_email_recipient_suppression();
