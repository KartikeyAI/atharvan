CREATE TABLE "auth"."passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aaguid" text
);
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "authentication_method" text DEFAULT 'email_otp' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "strong_authentication_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_passkey_credential_unique" ON "auth"."passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "auth_passkey_user_id_idx" ON "auth"."passkey" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "auth_session_assurance_consistent" CHECK (("auth"."session"."authentication_method" = 'email_otp' AND "auth"."session"."strong_authentication_at" IS NULL) OR ("auth"."session"."authentication_method" = 'passkey' AND "auth"."session"."strong_authentication_at" IS NOT NULL));--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_operator_authentication_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO audit_events (
    actor_id,
    event_type,
    target_type,
    target_id,
    correlation_id,
    evidence,
    occurred_at
  )
  SELECT
    operators.id,
    'platform.operator.authenticated',
    'operator_session',
    NEW.id,
    gen_random_uuid(),
    jsonb_build_object(
      'authenticationMethod', NEW.authentication_method,
      'strongAuthentication', NEW.strong_authentication_at IS NOT NULL
    ),
    NEW.created_at
  FROM operators
  WHERE operators.auth_user_id = NEW.user_id;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_session_audit_insert
AFTER INSERT ON "auth"."session"
FOR EACH ROW
EXECUTE FUNCTION audit_operator_authentication_session();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_operator_passkey_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM operators
      WHERE operators.auth_user_id = NEW.user_id
        AND operators.status = 'active'
    ) THEN
      RAISE EXCEPTION 'passkey enrollment requires an active operator';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
      OR NEW.public_key IS DISTINCT FROM OLD.public_key
      OR NEW.device_type IS DISTINCT FROM OLD.device_type
      OR NEW.backed_up IS DISTINCT FROM OLD.backed_up
      OR NEW.transports IS DISTINCT FROM OLD.transports
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.aaguid IS DISTINCT FROM OLD.aaguid
      OR NEW.counter < OLD.counter
    THEN
      RAISE EXCEPTION 'operator passkey credential history cannot be mutated';
    END IF;

    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM operators
    WHERE operators.auth_user_id = OLD.user_id
      AND operators.status = 'active'
  ) THEN
    PERFORM 1
    FROM "auth"."user"
    WHERE id = OLD.user_id
    FOR UPDATE;

    IF (
    SELECT count(*)
    FROM "auth"."passkey"
    WHERE user_id = OLD.user_id
    ) <= 1 THEN
      RAISE EXCEPTION 'last active operator passkey cannot be removed';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_passkey_guard_insert
BEFORE INSERT ON "auth"."passkey"
FOR EACH ROW
EXECUTE FUNCTION guard_operator_passkey_mutation();--> statement-breakpoint
CREATE TRIGGER auth_passkey_guard_update
BEFORE UPDATE ON "auth"."passkey"
FOR EACH ROW
EXECUTE FUNCTION guard_operator_passkey_mutation();--> statement-breakpoint
CREATE TRIGGER auth_passkey_guard_delete
BEFORE DELETE ON "auth"."passkey"
FOR EACH ROW
EXECUTE FUNCTION guard_operator_passkey_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_operator_passkey_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  passkey_row "auth"."passkey"%ROWTYPE;
  operator_id uuid;
  event_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    passkey_row := OLD;
  ELSE
    passkey_row := NEW;
  END IF;

  SELECT operators.id
  INTO operator_id
  FROM operators
  WHERE operators.auth_user_id = passkey_row.user_id;

  IF operator_id IS NULL THEN
    RAISE EXCEPTION 'passkey mutation requires a linked operator';
  END IF;

  event_name := CASE TG_OP
    WHEN 'INSERT' THEN 'platform.operator.passkey_enrolled'
    WHEN 'DELETE' THEN 'platform.operator.passkey_removed'
    ELSE 'platform.operator.passkey_renamed'
  END;

  INSERT INTO audit_events (
    actor_id,
    event_type,
    target_type,
    target_id,
    correlation_id,
    evidence,
    occurred_at
  ) VALUES (
    operator_id,
    event_name,
    'operator_passkey',
    passkey_row.id,
    gen_random_uuid(),
    jsonb_build_object(
      'deviceType', passkey_row.device_type,
      'backedUp', passkey_row.backed_up,
      'aaguid', passkey_row.aaguid
    ),
    now()
  );

  RETURN passkey_row;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_passkey_audit_insert
AFTER INSERT ON "auth"."passkey"
FOR EACH ROW
EXECUTE FUNCTION audit_operator_passkey_mutation();--> statement-breakpoint
CREATE TRIGGER auth_passkey_audit_delete
AFTER DELETE ON "auth"."passkey"
FOR EACH ROW
EXECUTE FUNCTION audit_operator_passkey_mutation();--> statement-breakpoint
CREATE TRIGGER auth_passkey_audit_rename
AFTER UPDATE OF name ON "auth"."passkey"
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION audit_operator_passkey_mutation();
