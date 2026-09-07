import { parseEnv } from "node:util";

import {
  authenticationRuntimeConfigSchema,
  type AuthenticationRuntimeConfig,
} from "../packages/config/src/index";

const optionalKeys = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET",
  "CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID",
  "CLOUDFLARE_SECRETS_STORE_ID",
  "CLOUDFLARE_SECRETS_STORE_API_TOKEN",
] as const;

/** A settings error contains field names only, never supplied values. */
export class LocalConfigurationError extends Error {}

/** Validate the explicit local file without inheriting ambient credentials. */
export function parseLocalEnvironment(
  contents: string,
): AuthenticationRuntimeConfig {
  const values = parseEnv(contents);
  for (const key of optionalKeys) {
    if (values[key]?.trim() === "") delete values[key];
  }
  const result = authenticationRuntimeConfigSchema.safeParse(values);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map(
          (issue) => issue.path.join(".") || "Secrets Store configuration",
        ),
      ),
    ];
    throw new LocalConfigurationError(
      `Check .env.local settings: ${fields.join(", ")}.`,
    );
  }
  const config = result.data;
  if (config.ATHARVAN_ENVIRONMENT !== "development") {
    throw new LocalConfigurationError(
      "Local commands require ATHARVAN_ENVIRONMENT=development.",
    );
  }
  const origin = new URL(config.ATHARVAN_PUBLIC_ORIGIN);
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !origin.port ||
    Number(origin.port) < 1024 ||
    Number(origin.port) > 65535 ||
    origin.port === "8787"
  ) {
    throw new LocalConfigurationError(
      "ATHARVAN_PUBLIC_ORIGIN must be http://localhost:<port> or http://127.0.0.1:<port>, using a port from 1024 to 65535 other than 8787.",
    );
  }
  let database: URL;
  try {
    database = new URL(config.DATABASE_URL);
  } catch {
    throw new LocalConfigurationError(
      "DATABASE_URL must be a valid PostgreSQL connection string.",
    );
  }
  if (
    !database.hostname ||
    database.pathname.length < 2 ||
    !database.username
  ) {
    throw new LocalConfigurationError(
      "DATABASE_URL must include a host, database name, and user.",
    );
  }
  return config;
}

/** Serialize only validated Worker bindings; shell and Vite variables are excluded. */
export function serializeWorkerBindings(
  config: AuthenticationRuntimeConfig,
): string {
  return (
    Object.entries(config)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => {
        // Dotenv does not implement JSON escaping. Literal quoting preserves
        // backslashes, newlines, hashes, and quote characters in credentials.
        const quote = ["'", "`", '"'].find(
          (candidate) =>
            !value.includes(candidate) &&
            (candidate !== '"' || !value.includes("\\")),
        );
        if (!quote)
          throw new LocalConfigurationError(
            `The ${key} value cannot be represented safely in a Worker environment file.`,
          );
        return `${key}=${quote}${value}${quote}`;
      })
      .join("\n") + "\n"
  );
}

/** Keep OS/tooling essentials while excluding application and ambient cloud secrets. */
export function localChildEnvironment(
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    "path",
    "pathext",
    "systemroot",
    "windir",
    "comspec",
    "temp",
    "tmp",
    "tmpdir",
    "home",
    "userprofile",
    "appdata",
    "localappdata",
    "programdata",
    "lang",
    "lc_all",
    "term",
    "colorterm",
    "node_extra_ca_certs",
    "ssl_cert_file",
    "ssl_cert_dir",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(parent).filter(([key]) => allowed.has(key.toLowerCase())),
    ),
    CLOUDFLARE_ENV: "dev",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "true",
    WRANGLER_SEND_METRICS: "false",
    BROWSER: "none",
  };
}
