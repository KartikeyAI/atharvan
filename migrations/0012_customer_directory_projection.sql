CREATE TYPE "public"."customer_membership_lifecycle" AS ENUM('invited', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."customer_user_lifecycle" AS ENUM('active', 'restricted', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."customer_verification_status" AS ENUM('unverified', 'pending', 'verified');--> statement-breakpoint
CREATE TYPE "public"."customer_workspace_lifecycle" AS ENUM('active', 'restricted', 'suspended', 'archived');--> statement-breakpoint
CREATE TABLE "customer_directory_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"source" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"synchronized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_directory_sources_source_arth" CHECK ("customer_directory_sources"."source" = 'arth'),
	CONSTRAINT "customer_directory_sources_revision_positive" CHECK ("customer_directory_sources"."source_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_user_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"source_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle" "customer_user_lifecycle" NOT NULL,
	"verification_status" "customer_verification_status" NOT NULL,
	"source_created_at" timestamp with time zone NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_users_email_normalized" CHECK ("customer_user_projections"."email" = lower("customer_user_projections"."email")),
	CONSTRAINT "customer_users_email_shape" CHECK ("customer_user_projections"."email" ~ '^[^@]+@[^@]+$'),
	CONSTRAINT "customer_users_revision_positive" CHECK ("customer_user_projections"."source_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_workspace_membership_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"source_id" text NOT NULL,
	"user_source_id" text NOT NULL,
	"workspace_source_id" text NOT NULL,
	"role" text NOT NULL,
	"lifecycle" "customer_membership_lifecycle" NOT NULL,
	"granted_permissions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"denied_permissions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"effective_permissions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_memberships_revision_positive" CHECK ("customer_workspace_membership_projections"."source_revision" > 0),
	CONSTRAINT "customer_memberships_permission_sets_bounded" CHECK (cardinality("customer_workspace_membership_projections"."granted_permissions") <= 200 AND cardinality("customer_workspace_membership_projections"."denied_permissions") <= 200 AND cardinality("customer_workspace_membership_projections"."effective_permissions") <= 200)
);
--> statement-breakpoint
CREATE TABLE "customer_workspace_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"source_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"lifecycle" "customer_workspace_lifecycle" NOT NULL,
	"source_created_at" timestamp with time zone NOT NULL,
	"source_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_workspaces_slug_normalized" CHECK ("customer_workspace_projections"."slug" IS NULL OR "customer_workspace_projections"."slug" = lower("customer_workspace_projections"."slug")),
	CONSTRAINT "customer_workspaces_revision_positive" CHECK ("customer_workspace_projections"."source_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_directory_sources_environment_source_unique" ON "customer_directory_sources" USING btree ("environment","source");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_users_environment_source_unique" ON "customer_user_projections" USING btree ("environment","source_id");--> statement-breakpoint
CREATE INDEX "customer_users_environment_email_idx" ON "customer_user_projections" USING btree ("environment","email");--> statement-breakpoint
CREATE INDEX "customer_users_environment_lifecycle_idx" ON "customer_user_projections" USING btree ("environment","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_memberships_environment_source_unique" ON "customer_workspace_membership_projections" USING btree ("environment","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_memberships_environment_pair_unique" ON "customer_workspace_membership_projections" USING btree ("environment","user_source_id","workspace_source_id");--> statement-breakpoint
CREATE INDEX "customer_memberships_environment_user_idx" ON "customer_workspace_membership_projections" USING btree ("environment","user_source_id");--> statement-breakpoint
CREATE INDEX "customer_memberships_environment_workspace_idx" ON "customer_workspace_membership_projections" USING btree ("environment","workspace_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_workspaces_environment_source_unique" ON "customer_workspace_projections" USING btree ("environment","source_id");--> statement-breakpoint
CREATE INDEX "customer_workspaces_environment_organization_idx" ON "customer_workspace_projections" USING btree ("environment","organization_id");--> statement-breakpoint
CREATE INDEX "customer_workspaces_environment_slug_idx" ON "customer_workspace_projections" USING btree ("environment","slug");--> statement-breakpoint
CREATE INDEX "customer_workspaces_environment_lifecycle_idx" ON "customer_workspace_projections" USING btree ("environment","lifecycle");
