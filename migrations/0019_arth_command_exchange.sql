CREATE TYPE "public"."arth_command_delivery_state" AS ENUM('pending', 'leased', 'applied', 'rejected', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."arth_command_kind" AS ENUM('customer_restriction', 'workspace_ownership_transfer');--> statement-breakpoint
CREATE TABLE "arth_command_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"kind" "arth_command_kind" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_sha256" text NOT NULL,
	"state" "arth_command_delivery_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"claimed_by_key_id" text,
	"acknowledgement_fingerprint" text,
	"acknowledged_source_revision" bigint,
	"observed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arth_command_outbox_revision_positive" CHECK ("arth_command_outbox"."aggregate_revision" > 0),
	CONSTRAINT "arth_command_outbox_payload_object" CHECK (jsonb_typeof("arth_command_outbox"."payload") = 'object'),
	CONSTRAINT "arth_command_outbox_payload_sha256" CHECK ("arth_command_outbox"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "arth_command_outbox_payload_identity" CHECK ("arth_command_outbox"."payload"->>'kind' = "arth_command_outbox"."kind"::text AND "arth_command_outbox"."payload"->>'revisionNumber' ~ '^[1-9][0-9]*$' AND ("arth_command_outbox"."payload"->>'revisionNumber')::integer = "arth_command_outbox"."aggregate_revision" AND (("arth_command_outbox"."kind" = 'customer_restriction' AND "arth_command_outbox"."payload"->>'restrictionId' = "arth_command_outbox"."aggregate_id"::text) OR ("arth_command_outbox"."kind" = 'workspace_ownership_transfer' AND "arth_command_outbox"."payload"->>'transferId' = "arth_command_outbox"."aggregate_id"::text))),
	CONSTRAINT "arth_command_outbox_attempts_bounded" CHECK ("arth_command_outbox"."attempts" BETWEEN 0 AND 10),
	CONSTRAINT "arth_command_outbox_expiry_valid" CHECK ("arth_command_outbox"."expires_at" > "arth_command_outbox"."created_at" AND "arth_command_outbox"."expires_at" <= "arth_command_outbox"."created_at" + interval '8 days'),
	CONSTRAINT "arth_command_outbox_lease_shape" CHECK (("arth_command_outbox"."state" = 'leased' AND "arth_command_outbox"."lease_token" IS NOT NULL AND "arth_command_outbox"."lease_expires_at" IS NOT NULL AND "arth_command_outbox"."claimed_by_key_id" IS NOT NULL) OR ("arth_command_outbox"."state" <> 'leased' AND "arth_command_outbox"."lease_token" IS NULL AND "arth_command_outbox"."lease_expires_at" IS NULL AND "arth_command_outbox"."claimed_by_key_id" IS NULL)),
	CONSTRAINT "arth_command_outbox_completion_shape" CHECK (("arth_command_outbox"."state" IN ('applied', 'rejected') AND "arth_command_outbox"."acknowledgement_fingerprint" IS NOT NULL AND "arth_command_outbox"."acknowledged_source_revision" IS NOT NULL AND "arth_command_outbox"."observed_at" IS NOT NULL AND "arth_command_outbox"."completed_at" IS NOT NULL) OR ("arth_command_outbox"."state" NOT IN ('applied', 'rejected') AND "arth_command_outbox"."acknowledgement_fingerprint" IS NULL AND "arth_command_outbox"."acknowledged_source_revision" IS NULL AND "arth_command_outbox"."observed_at" IS NULL AND "arth_command_outbox"."completed_at" IS NULL)),
	CONSTRAINT "arth_command_outbox_ack_fingerprint_sha256" CHECK ("arth_command_outbox"."acknowledgement_fingerprint" IS NULL OR "arth_command_outbox"."acknowledgement_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "arth_command_outbox_source_revision_positive" CHECK ("arth_command_outbox"."acknowledged_source_revision" IS NULL OR "arth_command_outbox"."acknowledged_source_revision" > 0),
	CONSTRAINT "arth_command_outbox_error_bounded" CHECK ("arth_command_outbox"."last_error_code" IS NULL OR "arth_command_outbox"."last_error_code" ~ '^[a-z][a-z0-9_]{2,79}$')
);
--> statement-breakpoint
CREATE TABLE "arth_workload_request_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"key_id" text NOT NULL,
	"nonce" uuid NOT NULL,
	"request_timestamp" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arth_workload_request_key_id_valid" CHECK ("arth_workload_request_nonces"."key_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$'),
	CONSTRAINT "arth_workload_request_nonce_expiry_valid" CHECK ("arth_workload_request_nonces"."expires_at" > "arth_workload_request_nonces"."received_at" AND "arth_workload_request_nonces"."expires_at" <= "arth_workload_request_nonces"."received_at" + interval '6 minutes')
);
--> statement-breakpoint
ALTER TABLE "customer_access_restriction_observations" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_workspace_ownership_transfer_observations" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_access_restriction_observations" ADD COLUMN "source_workload_key_id" text;--> statement-breakpoint
ALTER TABLE "customer_workspace_ownership_transfer_observations" ADD COLUMN "source_workload_key_id" text;--> statement-breakpoint
ALTER TABLE "arth_command_outbox" ADD CONSTRAINT "arth_command_outbox_command_id_platform_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."platform_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arth_command_outbox_command_unique" ON "arth_command_outbox" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arth_command_outbox_aggregate_revision_unique" ON "arth_command_outbox" USING btree ("kind","aggregate_id","aggregate_revision");--> statement-breakpoint
CREATE INDEX "arth_command_outbox_claim_idx" ON "arth_command_outbox" USING btree ("environment","state","available_at","created_at");--> statement-breakpoint
CREATE INDEX "arth_command_outbox_lease_idx" ON "arth_command_outbox" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "arth_workload_request_nonce_unique" ON "arth_workload_request_nonces" USING btree ("environment","key_id","nonce");--> statement-breakpoint
CREATE INDEX "arth_workload_request_nonce_expiry_idx" ON "arth_workload_request_nonces" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "customer_access_restriction_observations" ADD CONSTRAINT "customer_access_restriction_observations_actor_shape" CHECK (("customer_access_restriction_observations"."actor_id" IS NOT NULL AND "customer_access_restriction_observations"."source_workload_key_id" IS NULL) OR ("customer_access_restriction_observations"."actor_id" IS NULL AND "customer_access_restriction_observations"."source_workload_key_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$'));--> statement-breakpoint
ALTER TABLE "customer_workspace_ownership_transfer_observations" ADD CONSTRAINT "customer_ownership_transfer_observations_actor_shape" CHECK (("customer_workspace_ownership_transfer_observations"."actor_id" IS NOT NULL AND "customer_workspace_ownership_transfer_observations"."source_workload_key_id" IS NULL) OR ("customer_workspace_ownership_transfer_observations"."actor_id" IS NULL AND "customer_workspace_ownership_transfer_observations"."source_workload_key_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_arth_command_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'arth command delivery history is immutable';
  END IF;

  IF OLD.command_id IS DISTINCT FROM NEW.command_id
    OR OLD.environment IS DISTINCT FROM NEW.environment
    OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
    OR OLD.aggregate_revision IS DISTINCT FROM NEW.aggregate_revision
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
    RAISE EXCEPTION 'arth command identity is immutable';
  END IF;

  IF OLD.state IN ('applied', 'rejected', 'dead_letter') THEN
    RAISE EXCEPTION 'terminal arth command delivery is immutable';
  END IF;

  IF NOT (
    (OLD.state = 'pending' AND NEW.state IN ('pending', 'leased', 'dead_letter'))
    OR (OLD.state = 'leased' AND NEW.state IN ('pending', 'leased', 'applied', 'rejected', 'dead_letter'))
  ) THEN
    RAISE EXCEPTION 'invalid arth command delivery transition';
  END IF;

  IF NEW.state = 'leased' AND OLD.state <> 'leased' THEN
    IF NEW.attempts <> OLD.attempts + 1
      OR NEW.lease_token IS NULL
      OR NEW.lease_expires_at <= clock_timestamp()
      OR NEW.lease_expires_at > clock_timestamp() + interval '61 seconds' THEN
      RAISE EXCEPTION 'invalid arth command lease';
    END IF;
  ELSIF NEW.state = 'leased' AND OLD.state = 'leased' THEN
    IF OLD.lease_expires_at > clock_timestamp()
      OR NEW.attempts <> OLD.attempts + 1
      OR NEW.lease_token IS NULL
      OR NEW.lease_token = OLD.lease_token
      OR NEW.lease_expires_at <= clock_timestamp()
      OR NEW.lease_expires_at > clock_timestamp() + interval '61 seconds' THEN
      RAISE EXCEPTION 'live arth command lease cannot be replaced';
    END IF;
  ELSIF NEW.attempts <> OLD.attempts THEN
    RAISE EXCEPTION 'arth command attempts change only when leased';
  END IF;

  IF OLD.state = 'leased'
    AND NEW.state IN ('pending', 'applied', 'rejected')
    AND OLD.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'expired arth command lease cannot settle';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER arth_command_outbox_guard
BEFORE UPDATE OR DELETE ON arth_command_outbox
FOR EACH ROW EXECUTE FUNCTION guard_arth_command_outbox();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_arth_workload_request_nonce()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'workload request nonce is immutable';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'live workload request nonce cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER arth_workload_request_nonce_guard
BEFORE UPDATE OR DELETE ON arth_workload_request_nonces
FOR EACH ROW EXECUTE FUNCTION guard_arth_workload_request_nonce();
