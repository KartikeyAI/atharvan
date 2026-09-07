CREATE TYPE "public"."commercial_billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."commercial_lifecycle" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."commercial_plan_audience" AS ENUM('public', 'private', 'grandfathered');--> statement-breakpoint
CREATE TYPE "public"."commercial_pricing_model" AS ENUM('free', 'fixed', 'contract');--> statement-breakpoint
CREATE TYPE "public"."commercial_tax_behavior" AS ENUM('exclusive', 'inclusive', 'unspecified');--> statement-breakpoint
CREATE TABLE "commercial_plan_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"audience" "commercial_plan_audience" NOT NULL,
	"pricing_model" "commercial_pricing_model" NOT NULL,
	"billing_interval" "commercial_billing_interval",
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_behavior" "commercial_tax_behavior" NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"provider_price_reference" text,
	"lifecycle" "commercial_lifecycle" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_plan_versions_number_positive" CHECK ("commercial_plan_versions"."version_number" > 0),
	CONSTRAINT "commercial_plan_versions_content_valid" CHECK (length(btrim("commercial_plan_versions"."display_name")) BETWEEN 2 AND 120 AND length(btrim("commercial_plan_versions"."description")) BETWEEN 8 AND 1000 AND length(btrim("commercial_plan_versions"."reason")) BETWEEN 8 AND 500),
	CONSTRAINT "commercial_plan_versions_pricing_valid" CHECK ("commercial_plan_versions"."amount_minor" BETWEEN 0 AND 9000000000000 AND (("commercial_plan_versions"."pricing_model" = 'free' AND "commercial_plan_versions"."amount_minor" = 0 AND "commercial_plan_versions"."billing_interval" IS NULL) OR ("commercial_plan_versions"."pricing_model" = 'fixed' AND "commercial_plan_versions"."amount_minor" > 0 AND "commercial_plan_versions"."billing_interval" IS NOT NULL) OR ("commercial_plan_versions"."pricing_model" = 'contract' AND "commercial_plan_versions"."amount_minor" = 0 AND "commercial_plan_versions"."billing_interval" IS NULL))),
	CONSTRAINT "commercial_plan_versions_currency_valid" CHECK ("commercial_plan_versions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commercial_plan_versions_trial_valid" CHECK ("commercial_plan_versions"."trial_days" BETWEEN 0 AND 365),
	CONSTRAINT "commercial_plan_versions_provider_reference_valid" CHECK ("commercial_plan_versions"."provider_price_reference" IS NULL OR length(btrim("commercial_plan_versions"."provider_price_reference")) BETWEEN 2 AND 200)
);
--> statement-breakpoint
CREATE TABLE "commercial_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_version_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_plans_key_valid" CHECK ("commercial_plans"."key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "commercial_plans_version_positive" CHECK ("commercial_plans"."current_version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_product_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"lifecycle" "commercial_lifecycle" NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_product_revisions_number_positive" CHECK ("commercial_product_revisions"."revision_number" > 0),
	CONSTRAINT "commercial_product_revisions_content_valid" CHECK (length(btrim("commercial_product_revisions"."display_name")) BETWEEN 2 AND 120 AND length(btrim("commercial_product_revisions"."description")) BETWEEN 8 AND 1000 AND length(btrim("commercial_product_revisions"."reason")) BETWEEN 8 AND 500)
);
--> statement-breakpoint
CREATE TABLE "commercial_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"environment" "platform_configuration_environment" NOT NULL,
	"key" text NOT NULL,
	"current_revision_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_products_key_valid" CHECK ("commercial_products"."key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "commercial_products_revision_positive" CHECK ("commercial_products"."current_revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_plan_id_commercial_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD CONSTRAINT "commercial_plans_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_product_revisions" ADD CONSTRAINT "commercial_product_revisions_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_product_revisions" ADD CONSTRAINT "commercial_product_revisions_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_versions_number_unique" ON "commercial_plan_versions" USING btree ("plan_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_versions_correlation_unique" ON "commercial_plan_versions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "commercial_plan_versions_history_idx" ON "commercial_plan_versions" USING btree ("plan_id","version_number");--> statement-breakpoint
CREATE INDEX "commercial_plan_versions_provider_reference_idx" ON "commercial_plan_versions" USING btree ("provider_price_reference") WHERE "commercial_plan_versions"."provider_price_reference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plans_product_key_unique" ON "commercial_plans" USING btree ("product_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_product_revisions_number_unique" ON "commercial_product_revisions" USING btree ("product_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_product_revisions_correlation_unique" ON "commercial_product_revisions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "commercial_product_revisions_history_idx" ON "commercial_product_revisions" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_products_environment_key_unique" ON "commercial_products" USING btree ("environment","key");
--> statement-breakpoint
ALTER TABLE "commercial_products" ADD CONSTRAINT "commercial_products_current_revision_fk" FOREIGN KEY ("id", "current_revision_number") REFERENCES "public"."commercial_product_revisions"("product_id", "revision_number") ON DELETE restrict DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD CONSTRAINT "commercial_plans_current_version_fk" FOREIGN KEY ("id", "current_version_number") REFERENCES "public"."commercial_plan_versions"("plan_id", "version_number") ON DELETE restrict DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION reject_commercial_product_revision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commercial_product_revision_immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER commercial_product_revisions_immutable
BEFORE UPDATE OR DELETE ON commercial_product_revisions
FOR EACH ROW EXECUTE FUNCTION reject_commercial_product_revision_mutation();--> statement-breakpoint
CREATE FUNCTION reject_commercial_plan_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commercial_plan_version_immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER commercial_plan_versions_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_versions
FOR EACH ROW EXECUTE FUNCTION reject_commercial_plan_version_mutation();--> statement-breakpoint
CREATE FUNCTION guard_commercial_product_pointer() RETURNS trigger AS $$
DECLARE
  previous_lifecycle commercial_lifecycle;
  next_lifecycle commercial_lifecycle;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial_product_delete_forbidden';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.environment IS DISTINCT FROM NEW.environment
    OR OLD.key IS DISTINCT FROM NEW.key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.current_revision_number <> OLD.current_revision_number + 1
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'commercial_product_pointer_update_invalid';
  END IF;
  SELECT lifecycle INTO previous_lifecycle
  FROM commercial_product_revisions
  WHERE product_id = OLD.id AND revision_number = OLD.current_revision_number;
  SELECT lifecycle INTO next_lifecycle
  FROM commercial_product_revisions
  WHERE product_id = NEW.id AND revision_number = NEW.current_revision_number;
  IF previous_lifecycle IS NULL OR next_lifecycle IS NULL OR NOT (
    previous_lifecycle = next_lifecycle
    OR (previous_lifecycle = 'draft' AND next_lifecycle IN ('active', 'retired'))
    OR (previous_lifecycle = 'active' AND next_lifecycle = 'retired')
  ) THEN
    RAISE EXCEPTION 'commercial_product_lifecycle_transition_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER commercial_products_guard
BEFORE UPDATE OR DELETE ON commercial_products
FOR EACH ROW EXECUTE FUNCTION guard_commercial_product_pointer();--> statement-breakpoint
CREATE FUNCTION guard_commercial_plan_pointer() RETURNS trigger AS $$
DECLARE
  previous_lifecycle commercial_lifecycle;
  next_lifecycle commercial_lifecycle;
  product_lifecycle commercial_lifecycle;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial_plan_delete_forbidden';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.product_id IS DISTINCT FROM NEW.product_id
    OR OLD.key IS DISTINCT FROM NEW.key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.current_version_number <> OLD.current_version_number + 1
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'commercial_plan_pointer_update_invalid';
  END IF;
  SELECT lifecycle INTO previous_lifecycle
  FROM commercial_plan_versions
  WHERE plan_id = OLD.id AND version_number = OLD.current_version_number;
  SELECT lifecycle INTO next_lifecycle
  FROM commercial_plan_versions
  WHERE plan_id = NEW.id AND version_number = NEW.current_version_number;
  IF previous_lifecycle IS NULL OR next_lifecycle IS NULL OR NOT (
    previous_lifecycle = next_lifecycle
    OR (previous_lifecycle = 'draft' AND next_lifecycle IN ('active', 'retired'))
    OR (previous_lifecycle = 'active' AND next_lifecycle = 'retired')
  ) THEN
    RAISE EXCEPTION 'commercial_plan_lifecycle_transition_invalid';
  END IF;
  SELECT revision.lifecycle INTO product_lifecycle
  FROM commercial_products AS product
  JOIN commercial_product_revisions AS revision
    ON revision.product_id = product.id
    AND revision.revision_number = product.current_revision_number
  WHERE product.id = NEW.product_id
  FOR SHARE OF product;
  IF next_lifecycle = 'active' AND product_lifecycle IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'commercial_plan_active_product_required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER commercial_plans_guard
BEFORE UPDATE OR DELETE ON commercial_plans
FOR EACH ROW EXECUTE FUNCTION guard_commercial_plan_pointer();
