import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { integrationDatabaseFromEnvironment } from "./integration-environment";

// Deliberately bypass task caches: evidence must come from this database run.
integrationDatabaseFromEnvironment();
const require = createRequire(import.meta.url);
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const child = spawn(
  process.execPath,
  [
    vitest,
    "run",
    "src/operator-onboarding-store.integration.test.ts",
    "src/operator-sessions.integration.test.ts",
    "src/platform-overview-readonly.test.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ATHARVAN_RUN_DB_INTEGRATION_TESTS: "1",
      ATHARVAN_RUN_SESSION_DB_TESTS: "1",
      ATHARVAN_RUN_OVERVIEW_READONLY: "1",
    },
  },
);
child.once("error", () => {
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
