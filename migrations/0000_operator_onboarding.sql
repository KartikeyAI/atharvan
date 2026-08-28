CREATE TYPE "public"."operator_invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."operator_status" AS ENUM('invited', 'verification_pending', 'active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."verification_challenge_status" AS ENUM('pending', 'consumed', 'expired', 'locked', 'superseded');--> statement-breakpoint
CREATE TABLE "allowed_email_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"include_subdomains" boolean DEFAULT false NOT NULL,
	"is_public_domain_exception" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"reason" text NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"disabled_by_operator_id" uuid,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_email_domains_normalized" CHECK ("allowed_email_domains"."domain" = lower("allowed_email_domains"."domain")),
	CONSTRAINT "allowed_email_domains_disable_metadata" CHECK (("allowed_email_domains"."is_active" AND "allowed_email_domains"."disabled_at" IS NULL AND "allowed_email_domains"."disabled_by_operator_id" IS NULL) OR (NOT "allowed_email_domains"."is_active" AND "allowed_email_domains"."disabled_at" IS NOT NULL AND "allowed_email_domains"."disabled_by_operator_id" IS NOT NULL)),
	CONSTRAINT "allowed_email_domains_shape" CHECK (position('.' in "allowed_email_domains"."domain") > 1)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"reason" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_domain" text NOT NULL,
	"organization_id" text NOT NULL,
	"intended_capabilities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"invited_by_operator_id" uuid NOT NULL,
	"status" "operator_invitation_status" DEFAULT 'pending' NOT NULL,
	"token_fingerprint" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"approval_reference" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_invitations_email_normalized" CHECK ("operator_invitations"."email" = lower("operator_invitations"."email")),
	CONSTRAINT "operator_invitations_email_shape" CHECK ("operator_invitations"."email" ~ '^[^@]+@[^@]+$'),
	CONSTRAINT "operator_invitations_email_domain_matches" CHECK ("operator_invitations"."email_domain" = split_part("operator_invitations"."email", '@', 2)),
	CONSTRAINT "operator_invitations_expiry_after_creation" CHECK ("operator_invitations"."expires_at" > "operator_invitations"."created_at"),
	CONSTRAINT "operator_invitations_terminal_metadata" CHECK (("operator_invitations"."status" <> 'accepted' OR "operator_invitations"."accepted_at" IS NOT NULL) AND ("operator_invitations"."status" <> 'revoked' OR "operator_invitations"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "operator_verification_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"status" "verification_challenge_status" DEFAULT 'pending' NOT NULL,
	"code_digest" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"maximum_attempts" integer DEFAULT 5 NOT NULL,
	"resend_sequence" integer DEFAULT 0 NOT NULL,
	"delivery_provider_message_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_verification_challenges_attempt_bounds" CHECK ("operator_verification_challenges"."attempt_count" >= 0 AND "operator_verification_challenges"."maximum_attempts" BETWEEN 1 AND 10 AND "operator_verification_challenges"."attempt_count" <= "operator_verification_challenges"."maximum_attempts"),
	CONSTRAINT "operator_verification_challenges_resend_nonnegative" CHECK ("operator_verification_challenges"."resend_sequence" >= 0),
	CONSTRAINT "operator_verification_challenges_expiry_after_creation" CHECK ("operator_verification_challenges"."expires_at" > "operator_verification_challenges"."created_at"),
	CONSTRAINT "operator_verification_challenges_consumed_metadata" CHECK ("operator_verification_challenges"."status" <> 'consumed' OR "operator_verification_challenges"."consumed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_domain" text NOT NULL,
	"status" "operator_status" DEFAULT 'invited' NOT NULL,
	"is_super_administrator" boolean DEFAULT false NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operators_email_normalized" CHECK ("operators"."email" = lower("operators"."email")),
	CONSTRAINT "operators_email_shape" CHECK ("operators"."email" ~ '^[^@]+@[^@]+$'),
	CONSTRAINT "operators_email_domain_normalized" CHECK ("operators"."email_domain" = lower("operators"."email_domain")),
	CONSTRAINT "operators_email_domain_matches" CHECK ("operators"."email_domain" = split_part("operators"."email", '@', 2)),
	CONSTRAINT "operators_active_has_activation_time" CHECK ("operators"."status" <> 'active' OR "operators"."activated_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "allowed_email_domains" ADD CONSTRAINT "allowed_email_domains_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowed_email_domains" ADD CONSTRAINT "allowed_email_domains_disabled_by_operator_id_operators_id_fk" FOREIGN KEY ("disabled_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invitations" ADD CONSTRAINT "operator_invitations_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invitations" ADD CONSTRAINT "operator_invitations_invited_by_operator_id_operators_id_fk" FOREIGN KEY ("invited_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_verification_challenges" ADD CONSTRAINT "operator_verification_challenges_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_verification_challenges" ADD CONSTRAINT "operator_verification_challenges_invitation_id_operator_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."operator_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_email_domains_domain_unique" ON "allowed_email_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "allowed_email_domains_created_by_idx" ON "allowed_email_domains" USING btree ("created_by_operator_id");--> statement-breakpoint
CREATE INDEX "allowed_email_domains_disabled_by_idx" ON "allowed_email_domains" USING btree ("disabled_by_operator_id") WHERE "allowed_email_domains"."disabled_by_operator_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id") WHERE "audit_events"."actor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_invitations_token_fingerprint_unique" ON "operator_invitations" USING btree ("token_fingerprint");--> statement-breakpoint
CREATE INDEX "operator_invitations_operator_idx" ON "operator_invitations" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "operator_invitations_inviter_idx" ON "operator_invitations" USING btree ("invited_by_operator_id");--> statement-breakpoint
CREATE INDEX "operator_invitations_correlation_idx" ON "operator_invitations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "operator_invitations_pending_email_idx" ON "operator_invitations" USING btree ("email","expires_at") WHERE "operator_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "operator_invitations_one_pending_per_operator" ON "operator_invitations" USING btree ("operator_id") WHERE "operator_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "operator_verification_challenges_operator_idx" ON "operator_verification_challenges" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "operator_verification_challenges_invitation_idx" ON "operator_verification_challenges" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "operator_verification_challenges_pending_expiry_idx" ON "operator_verification_challenges" USING btree ("expires_at") WHERE "operator_verification_challenges"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "operator_verification_challenges_one_pending_per_operator" ON "operator_verification_challenges" USING btree ("operator_id") WHERE "operator_verification_challenges"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "operators_email_unique" ON "operators" USING btree ("email");--> statement-breakpoint
CREATE INDEX "operators_email_domain_idx" ON "operators" USING btree ("email_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_single_super_administrator" ON "operators" USING btree ("is_super_administrator") WHERE "operators"."is_super_administrator" = true;