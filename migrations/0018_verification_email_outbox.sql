CREATE TABLE "verification_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"operator_id" uuid NOT NULL,
	"verification_id" text NOT NULL,
	"encrypted_payload" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"provider_message_id" text,
	"reason" text DEFAULT 'queued' NOT NULL,
	CONSTRAINT "verification_email_delivery_state" CHECK ("verification_email_deliveries"."state" IN ('pending','leased','accepted','expired','cancelled','dead_letter')),
	CONSTRAINT "verification_email_delivery_attempts" CHECK ("verification_email_deliveries"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "verification_email_delivery_expiry" CHECK ("verification_email_deliveries"."expires_at" > "verification_email_deliveries"."created_at" AND "verification_email_deliveries"."expires_at" <= "verification_email_deliveries"."created_at" + interval '11 minutes'),
	CONSTRAINT "verification_email_delivery_lease" CHECK (("verification_email_deliveries"."state" = 'leased' AND "verification_email_deliveries"."lease_token" IS NOT NULL AND "verification_email_deliveries"."lease_expires_at" IS NOT NULL) OR ("verification_email_deliveries"."state" <> 'leased' AND "verification_email_deliveries"."lease_token" IS NULL AND "verification_email_deliveries"."lease_expires_at" IS NULL)),
	CONSTRAINT "verification_email_delivery_payload" CHECK (("verification_email_deliveries"."state" IN ('pending','leased')) = ("verification_email_deliveries"."encrypted_payload" IS NOT NULL)),
	CONSTRAINT "verification_email_delivery_receipt" CHECK (("verification_email_deliveries"."state" = 'accepted') = ("verification_email_deliveries"."provider_message_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "verification_email_deliveries" ADD CONSTRAINT "verification_email_deliveries_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_email_delivery_challenge_unique" ON "verification_email_deliveries" USING btree ("environment","verification_id");--> statement-breakpoint
CREATE INDEX "verification_email_delivery_due_idx" ON "verification_email_deliveries" USING btree ("environment","state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "verification_email_delivery_expiry_idx" ON "verification_email_deliveries" USING btree ("environment","expires_at");--> statement-breakpoint
CREATE INDEX "verification_email_delivery_history_idx" ON "verification_email_deliveries" USING btree ("environment","created_at","id");
--> statement-breakpoint
CREATE INDEX "verification_email_delivery_health_idx" ON "verification_email_deliveries" USING btree ("environment","state","updated_at");
--> statement-breakpoint
CREATE FUNCTION public.guard_verification_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'email_delivery_history_immutable'; END IF;
  IF ROW(NEW.id, NEW.environment, NEW.operator_id, NEW.verification_id, NEW.created_at, NEW.expires_at, NEW.correlation_id)
    IS DISTINCT FROM ROW(OLD.id, OLD.environment, OLD.operator_id, OLD.verification_id, OLD.created_at, OLD.expires_at, OLD.correlation_id) THEN
    RAISE EXCEPTION 'email_delivery_identity_immutable';
  END IF;
  IF OLD.state NOT IN ('pending', 'leased') THEN RAISE EXCEPTION 'email_delivery_terminal'; END IF;
  IF OLD.state = 'pending' AND NEW.state NOT IN ('pending','leased','cancelled','expired','dead_letter') THEN
    RAISE EXCEPTION 'email_delivery_transition_forbidden';
  END IF;
  IF NEW.encrypted_payload IS NOT NULL AND NEW.encrypted_payload IS DISTINCT FROM OLD.encrypted_payload THEN
    RAISE EXCEPTION 'email_delivery_payload_immutable';
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
$$;
--> statement-breakpoint
CREATE TRIGGER verification_email_delivery_guard BEFORE UPDATE OR DELETE ON public.verification_email_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_verification_email_delivery();
