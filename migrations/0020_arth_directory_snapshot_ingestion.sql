CREATE TYPE "public"."customer_directory_ingestion_outcome" AS ENUM('updated', 'unchanged');--> statement-breakpoint
CREATE TABLE "customer_directory_snapshot_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"source_revision" bigint NOT NULL,
	"result_source_revision" bigint NOT NULL,
	"payload_sha256" text NOT NULL,
	"source_workload_key_id" text NOT NULL,
	"request_nonce" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_count" integer NOT NULL,
	"workspace_count" integer NOT NULL,
	"membership_count" integer NOT NULL,
	"outcome" "customer_directory_ingestion_outcome" NOT NULL,
	CONSTRAINT "customer_directory_ingestion_revision_positive" CHECK ("customer_directory_snapshot_ingestions"."source_revision" > 0 AND "customer_directory_snapshot_ingestions"."result_source_revision" > 0),
	CONSTRAINT "customer_directory_ingestion_payload_sha256" CHECK ("customer_directory_snapshot_ingestions"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_directory_ingestion_key_id_valid" CHECK ("customer_directory_snapshot_ingestions"."source_workload_key_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'),
	CONSTRAINT "customer_directory_ingestion_counts_nonnegative" CHECK ("customer_directory_snapshot_ingestions"."user_count" >= 0 AND "customer_directory_snapshot_ingestions"."workspace_count" >= 0 AND "customer_directory_snapshot_ingestions"."membership_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer_directory_sources" ADD COLUMN "payload_sha256" text;--> statement-breakpoint
ALTER TABLE "customer_directory_sources" ADD COLUMN "source_workload_key_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_directory_ingestion_revision_unique" ON "customer_directory_snapshot_ingestions" USING btree ("environment","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_directory_ingestion_nonce_unique" ON "customer_directory_snapshot_ingestions" USING btree ("environment","source_workload_key_id","request_nonce");--> statement-breakpoint
CREATE INDEX "customer_directory_ingestion_received_idx" ON "customer_directory_snapshot_ingestions" USING btree ("environment","received_at");--> statement-breakpoint
ALTER TABLE "customer_directory_sources" ADD CONSTRAINT "customer_directory_sources_provenance_shape" CHECK (("customer_directory_sources"."payload_sha256" IS NULL AND "customer_directory_sources"."source_workload_key_id" IS NULL) OR ("customer_directory_sources"."payload_sha256" ~ '^[0-9a-f]{64}$' AND "customer_directory_sources"."source_workload_key_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_customer_directory_snapshot_ingestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer directory snapshot ingestion history is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_directory_snapshot_ingestion_guard
BEFORE UPDATE OR DELETE ON customer_directory_snapshot_ingestions
FOR EACH ROW EXECUTE FUNCTION guard_customer_directory_snapshot_ingestion();
