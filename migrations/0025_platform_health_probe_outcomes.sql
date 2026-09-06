ALTER TABLE "platform_health_probe_jobs" DROP CONSTRAINT "platform_health_probe_jobs_completion_consistent";--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" ADD COLUMN "completion_reason" text;--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" DISABLE TRIGGER "platform_health_probe_jobs_guard";--> statement-breakpoint
UPDATE "platform_health_probe_jobs"
SET "completion_reason" = CASE
  WHEN "state" = 'completed' THEN 'observation_recorded'
  WHEN "state" = 'superseded' THEN 'target_revision_changed'
  ELSE NULL
END
WHERE "state" IN ('completed', 'superseded');--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" ENABLE TRIGGER "platform_health_probe_jobs_guard";--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" ADD CONSTRAINT "platform_health_probe_jobs_completion_reason_valid" CHECK (("platform_health_probe_jobs"."state" = 'completed' AND "platform_health_probe_jobs"."completion_reason" = 'observation_recorded') OR ("platform_health_probe_jobs"."state" = 'superseded' AND "platform_health_probe_jobs"."completion_reason" IN ('target_revision_changed', 'retry_exhausted')) OR ("platform_health_probe_jobs"."state" IN ('pending', 'leased') AND "platform_health_probe_jobs"."completion_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "platform_health_probe_jobs" ADD CONSTRAINT "platform_health_probe_jobs_completion_consistent" CHECK (("platform_health_probe_jobs"."state" IN ('completed', 'superseded') AND "platform_health_probe_jobs"."completed_at" IS NOT NULL AND "platform_health_probe_jobs"."completion_reason" IS NOT NULL) OR ("platform_health_probe_jobs"."state" IN ('pending', 'leased') AND "platform_health_probe_jobs"."completed_at" IS NULL AND "platform_health_probe_jobs"."completion_reason" IS NULL));
