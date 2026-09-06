import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

type Environment = Readonly<Record<string, string | undefined>>;

/** Fail closed before connecting: mutation suites require an explicitly disposable target. */
export function resolveIntegrationDatabase(
  environment: Environment,
  applicationDatabaseUrl?: string,
): string {
  const raw = environment.ATHARVAN_TEST_DATABASE_URL;
  if (!raw || environment.ATHARVAN_TEST_DATABASE_DISPOSABLE !== "1") {
    throw new Error(
      "Integration tests require ATHARVAN_TEST_DATABASE_URL and ATHARVAN_TEST_DATABASE_DISPOSABLE=1.",
    );
  }
  const target = parseDatabaseUrl(raw);
  if (applicationDatabaseUrl) {
    const application = parseDatabaseUrl(applicationDatabaseUrl);
    // Neon pooled and direct hostnames designate the same endpoint. Reject both.
    const host = (url: URL) => url.hostname.replace(/-pooler(?=\.)/, "");
    if (host(target) === host(application)) {
      throw new Error(
        "Integration tests must use a separate database host from the application.",
      );
    }
  }
  return raw;
}

/** Local application configuration is read only to reject accidental target reuse. */
export function integrationDatabaseFromEnvironment(): string {
  const local = new URL("../../../.env.local", import.meta.url);
  const application = existsSync(local)
    ? parseEnv(readFileSync(local, "utf8")).DATABASE_URL
    : undefined;
  return resolveIntegrationDatabase(process.env, application);
}

function parseDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The integration database configuration is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length < 2 ||
    url.hash
  ) {
    throw new Error("The integration database configuration is invalid.");
  }
  return url;
}
