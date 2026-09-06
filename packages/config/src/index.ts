import { z } from "zod";

export const runtimeConfigSchema = z.object({
  ATHARVAN_ENVIRONMENT: z.enum(["development", "production", "test"]),
  ATHARVAN_PUBLIC_ORIGIN: z.url(),
});

export const authenticationRuntimeConfigSchema = runtimeConfigSchema
  .extend({
    DATABASE_URL: z
      .string()
      .refine(
        (value) =>
          value.startsWith("postgres://") || value.startsWith("postgresql://"),
        "DATABASE_URL must be a PostgreSQL connection string.",
      ),
    BETTER_AUTH_SECRET: z.string().min(32),
    ATHARVAN_VERIFICATION_HMAC_SECRET: z.string().min(32),
    ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET: z.string().min(32).optional(),
    ATHARVAN_SUPER_ADMIN_EMAIL: z.email(),
    ATHARVAN_EMAIL_FROM: z.string().trim().min(3),
    ATHARVAN_ALERT_EMAIL_TO: z.email().optional(),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    RESEND_WEBHOOK_SECRET: z.string().trim().min(20).optional(),
    CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID: z.string().trim().min(1).optional(),
    CLOUDFLARE_SECRETS_STORE_ID: z.string().trim().min(1).optional(),
    CLOUDFLARE_SECRETS_STORE_API_TOKEN: z.string().trim().min(1).optional(),
    ATHARVAN_ARTH_CURRENT_KEY_ID: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$/)
      .optional(),
    ATHARVAN_ARTH_CURRENT_SHARED_SECRET: z.string().min(32).optional(),
    ATHARVAN_ARTH_PREVIOUS_KEY_ID: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$/)
      .optional(),
    ATHARVAN_ARTH_PREVIOUS_SHARED_SECRET: z.string().min(32).optional(),
    ATHARVAN_ARTH_AUDIENCE: z.string().trim().min(3).max(200).optional(),
  })
  .superRefine((value, context) => {
    const secretStoreValues = [
      value.CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID,
      value.CLOUDFLARE_SECRETS_STORE_ID,
      value.CLOUDFLARE_SECRETS_STORE_API_TOKEN,
    ];
    const configuredValues = secretStoreValues.filter(
      (entry) => entry !== undefined,
    ).length;
    if (
      configuredValues !== 0 &&
      configuredValues !== secretStoreValues.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Cloudflare Secrets Store configuration must be complete.",
      });
    }
    const currentArthValues = [
      value.ATHARVAN_ARTH_CURRENT_KEY_ID,
      value.ATHARVAN_ARTH_CURRENT_SHARED_SECRET,
      value.ATHARVAN_ARTH_AUDIENCE,
    ];
    if (
      currentArthValues.filter((entry) => entry !== undefined).length !== 0 &&
      currentArthValues.some((entry) => entry === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Current Arth workload authentication configuration must be complete.",
      });
    }
    const previousArthValues = [
      value.ATHARVAN_ARTH_PREVIOUS_KEY_ID,
      value.ATHARVAN_ARTH_PREVIOUS_SHARED_SECRET,
    ];
    if (
      previousArthValues.filter((entry) => entry !== undefined).length === 1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Previous Arth workload authentication configuration must be complete.",
      });
    }
    if (
      value.ATHARVAN_ARTH_PREVIOUS_KEY_ID !== undefined &&
      value.ATHARVAN_ARTH_PREVIOUS_KEY_ID === value.ATHARVAN_ARTH_CURRENT_KEY_ID
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Current and previous Arth workload key identifiers must differ.",
      });
    }
    if (value.ATHARVAN_ENVIRONMENT === "production") {
      const origin = new URL(value.ATHARVAN_PUBLIC_ORIGIN);
      if (
        origin.protocol !== "https:" ||
        origin.hostname === "localhost" ||
        origin.hostname.endsWith(".invalid")
      )
        context.addIssue({
          code: "custom",
          message:
            "Production public origin must be a deployable HTTPS origin.",
        });
      for (const [name, configured] of [
        ["RESEND_API_KEY", Boolean(value.RESEND_API_KEY)],
        ["RESEND_WEBHOOK_SECRET", Boolean(value.RESEND_WEBHOOK_SECRET)],
        [
          "ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET",
          Boolean(value.ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET),
        ],
        ["ATHARVAN_ALERT_EMAIL_TO", Boolean(value.ATHARVAN_ALERT_EMAIL_TO)],
        [
          "Cloudflare Secrets Store",
          configuredValues === secretStoreValues.length,
        ],
        [
          "Arth workload authentication",
          currentArthValues.every((entry) => entry !== undefined),
        ],
      ] as const) {
        if (!configured)
          context.addIssue({
            code: "custom",
            message: `${name} is required in production.`,
          });
      }
    }
  });

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type AuthenticationRuntimeConfig = z.infer<
  typeof authenticationRuntimeConfigSchema
>;

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(input);
}

export function parseAuthenticationRuntimeConfig(
  input: unknown,
): AuthenticationRuntimeConfig {
  return authenticationRuntimeConfigSchema.parse(input);
}

export * from "./platform-configuration";
