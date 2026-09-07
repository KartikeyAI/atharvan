import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyMigratedContracts } from "../packages/db/src/migration-contract";
import {
  LocalConfigurationError,
  localChildEnvironment,
  parseLocalEnvironment,
  serializeWorkerBindings,
} from "./local-environment";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Resolve each application's installed CLI without shell interpolation. */
function applicationCli(
  app: string,
  packageName: string,
  relativePath: string,
): string {
  const require = createRequire(join(root, "apps", app, "package.json"));
  return resolve(
    dirname(require.resolve(`${packageName}/package.json`)),
    relativePath,
  );
}

/** Fail before launch instead of allowing an origin-breaking automatic port change. */
async function requireFreePort(port: number, host: string): Promise<void> {
  const server = createServer();
  try {
    server.listen(port, host);
    await once(server, "listening");
  } catch {
    throw new LocalConfigurationError(
      `Local port ${port} is unavailable. Stop the process using it and retry.`,
    );
  } finally {
    if (server.listening)
      await new Promise<void>((done) => server.close(() => done()));
  }
}

/** Stop only the process tree created by this launcher, including Windows workerd children. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return;
  if (process.platform === "win32") {
    const taskkill = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    await new Promise<void>((done) => {
      taskkill.once("exit", () => done());
      taskkill.once("error", () => {
        child.kill();
        done();
      });
    });
    return;
  }
  const closed = new Promise<void>((done) => child.once("exit", () => done()));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      /* Already stopped. */
    }
  }, 5_000);
  await closed;
  clearTimeout(timer);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "dev" && mode !== "doctor")
    throw new LocalConfigurationError("Use pnpm dev or pnpm local:check.");
  let contents: string;
  try {
    contents = await readFile(join(root, ".env.local"), "utf8");
  } catch {
    throw new LocalConfigurationError(
      "Create .env.local from .env.example and fill in the development settings.",
    );
  }
  const config = parseLocalEnvironment(contents);
  console.log("Local configuration: valid.");
  console.log(
    `Email delivery: ${config.RESEND_API_KEY ? "configured (delivery not tested)" : "not configured; invitation/OTP delivery unavailable"}.`,
  );
  console.log(
    `Email feedback: ${config.RESEND_WEBHOOK_SECRET ? "configured (webhook not tested)" : "not configured; delivery/bounce/complaint outcomes unavailable"}.`,
  );
  console.log(
    `Stripe billing: ${config.STRIPE_SECRET_KEY ? "configured (provider not tested)" : "not configured; subscription Checkout unavailable"}.`,
  );
  console.log(
    `Secrets Store: ${config.CLOUDFLARE_SECRETS_STORE_API_TOKEN ? "configured (provider access not tested)" : "not configured"}.`,
  );

  if (mode === "doctor") {
    await verifyMigratedContracts(config.DATABASE_URL);
    console.log(
      "Neon/PostgreSQL connection and migration contracts: verified read-only.",
    );
    return;
  }

  const origin = new URL(config.ATHARVAN_PUBLIC_ORIGIN);
  // workerd and Vite need scratch space even though PostgreSQL is hosted on Neon.
  for (const directory of new Set([root, tmpdir()])) {
    const space = await statfs(directory);
    if (space.bavail * space.bsize < 256 * 1024 * 1024) {
      throw new LocalConfigurationError(
        "Local startup needs at least 256 MiB free on the repository and temporary-file drives. Free disk space and run pnpm dev again.",
      );
    }
  }
  await requireFreePort(Number(origin.port), origin.hostname);
  await requireFreePort(8787, "127.0.0.1");
  const workerCli = applicationCli("worker", "wrangler", "bin/wrangler.js");
  const consoleCli = applicationCli("console", "vite", "bin/vite.js");
  const stateDirectory = join(root, ".wrangler", "local");
  await mkdir(stateDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(stateDirectory, "session-"));
  const envFile = join(temporaryDirectory, ".env");
  const children: ChildProcess[] = [];
  let finish: (code: number) => void = () => {};
  const completion = new Promise<number>((done) => {
    finish = done;
  });
  const interrupt = () => finish(0);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await writeFile(envFile, serializeWorkerBindings(config), { mode: 0o600 });
    const environment = localChildEnvironment(process.env);
    const commands = [
      {
        app: "worker",
        cli: workerCli,
        args: [
          "dev",
          "--env",
          "dev",
          "--local",
          "--ip",
          "127.0.0.1",
          "--port",
          "8787",
          "--inspector-port",
          "9230",
          "--env-file",
          envFile,
          "--show-interactive-dev-session=false",
        ],
      },
      {
        app: "console",
        cli: consoleCli,
        args: [
          "dev",
          "--host",
          origin.hostname,
          "--port",
          origin.port,
          "--strictPort",
        ],
      },
    ];
    for (const command of commands) {
      const child = spawn(process.execPath, [command.cli, ...command.args], {
        cwd: join(root, "apps", command.app),
        env: environment,
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      children.push(child);
      child.once("error", () => {
        console.error(
          `Could not start ${command.app}. Run pnpm install --frozen-lockfile.`,
        );
        finish(1);
      });
      child.once("exit", (code) => finish(code === 0 ? 0 : 1));
    }
    console.log(
      `Starting the console at ${origin.origin}; Worker at http://127.0.0.1:8787. Press Ctrl+C to stop both.`,
    );
    process.exitCode = await completion;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await Promise.all(children.map(stopChild));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  // Provider errors may contain connection strings; never print their raw message/stack.
  console.error(
    error instanceof LocalConfigurationError
      ? error.message
      : "Local check/start failed. Check Neon connectivity, migration state, and installed dependencies. Credentials were not printed.",
  );
  process.exitCode = 1;
});
