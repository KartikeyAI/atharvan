import { z } from "zod";

export const runtimeConfigSchema = z.object({
  ATHARVAN_ENVIRONMENT: z.enum(["development", "production", "test"]),
  ATHARVAN_PUBLIC_ORIGIN: z.url(),
});

export const authenticationRuntimeConfigSchema = runtimeConfigSchema.extend({
  DATABASE_URL: z
    .string()
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string.",
    ),
  BETTER_AUTH_SECRET: z.string().min(32),
  ATHARVAN_VERIFICATION_HMAC_SECRET: z.string().min(32),
  ATHARVAN_SUPER_ADMIN_EMAIL: z.email(),
  ATHARVAN_EMAIL_FROM: z.string().trim().min(3),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
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
