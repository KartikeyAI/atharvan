ALTER TABLE "operator_verification_challenges" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
UPDATE "operator_verification_challenges" SET "correlation_id" = gen_random_uuid() WHERE "correlation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "operator_verification_challenges" ALTER COLUMN "correlation_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "operator_verification_challenges_correlation_idx" ON "operator_verification_challenges" USING btree ("correlation_id");--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_super_administrator_must_be_active" CHECK (NOT "operators"."is_super_administrator" OR "operators"."status" = 'active');
