CREATE TYPE "public"."platform_command_outcome" AS ENUM('succeeded', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "platform_command_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"outcome" "platform_command_outcome" NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_command_results_http_status" CHECK ("platform_command_results"."response_status" BETWEEN 100 AND 599),
	CONSTRAINT "platform_command_results_body_object" CHECK (jsonb_typeof("platform_command_results"."response_body") = 'object')
);
--> statement-breakpoint
CREATE TABLE "platform_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"expected_target_version" integer,
	"payload_fingerprint" text NOT NULL,
	"idempotency_fingerprint" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"approval_reference" text,
	"evidence_references" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_commands_name_normalized" CHECK ("platform_commands"."name" = lower("platform_commands"."name") AND "platform_commands"."name" ~ '^[a-z][a-z0-9_.-]{2,127}$'),
	CONSTRAINT "platform_commands_target_type_normalized" CHECK ("platform_commands"."target_type" = lower("platform_commands"."target_type") AND "platform_commands"."target_type" ~ '^[a-z][a-z0-9_.-]{2,127}$'),
	CONSTRAINT "platform_commands_version_positive" CHECK ("platform_commands"."version" > 0),
	CONSTRAINT "platform_commands_expected_version_positive" CHECK ("platform_commands"."expected_target_version" IS NULL OR "platform_commands"."expected_target_version" > 0),
	CONSTRAINT "platform_commands_payload_fingerprint_sha256" CHECK ("platform_commands"."payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "platform_commands_idempotency_fingerprint_sha256" CHECK ("platform_commands"."idempotency_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "platform_commands_reason_nonempty" CHECK (length(btrim("platform_commands"."reason")) BETWEEN 8 AND 500),
	CONSTRAINT "platform_commands_evidence_bounded" CHECK (cardinality("platform_commands"."evidence_references") <= 20)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "command_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_command_results" ADD CONSTRAINT "platform_command_results_command_id_platform_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."platform_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_commands" ADD CONSTRAINT "platform_commands_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_command_results_command_unique" ON "platform_command_results" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "platform_command_results_outcome_completed_idx" ON "platform_command_results" USING btree ("outcome","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_commands_idempotency_unique" ON "platform_commands" USING btree ("environment","actor_id","name","version","idempotency_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_commands_correlation_unique" ON "platform_commands" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "platform_commands_actor_requested_idx" ON "platform_commands" USING btree ("actor_id","requested_at");--> statement-breakpoint
CREATE INDEX "platform_commands_target_requested_idx" ON "platform_commands" USING btree ("target_type","target_id","requested_at");--> statement-breakpoint
CREATE INDEX "platform_commands_name_requested_idx" ON "platform_commands" USING btree ("name","requested_at");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_command_id_platform_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."platform_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_command_idx" ON "audit_events" USING btree ("command_id") WHERE "audit_events"."command_id" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "prevent_platform_command_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform command history cannot be mutated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "platform_commands_immutable"
BEFORE UPDATE OR DELETE ON "platform_commands"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_command_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "platform_command_results_immutable"
BEFORE UPDATE OR DELETE ON "platform_command_results"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_command_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_immutable"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_command_history_mutation"();
