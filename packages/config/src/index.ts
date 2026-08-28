import { z } from "zod";

export const runtimeConfigSchema = z.object({
  ATHARVAN_ENVIRONMENT: z.enum(["development", "production", "test"]),
  ATHARVAN_PUBLIC_ORIGIN: z.url(),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(input);
}
