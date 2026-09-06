import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  currentAtharvanMigrationHash,
  currentAtharvanMigrationTimestamp,
  currentAtharvanSchemaVersion,
} from "./readiness";

const migrationsRoot = new URL("../../../migrations/", import.meta.url);
const journal = JSON.parse(
  await readFile(new URL("meta/_journal.json", migrationsRoot), "utf8"),
) as {
  readonly entries?: ReadonlyArray<{
    readonly idx?: number;
    readonly when?: number;
    readonly tag?: string;
  }>;
};
const head = journal.entries?.at(-1);
if (
  head?.idx !== currentAtharvanSchemaVersion ||
  String(head.when) !== currentAtharvanMigrationTimestamp ||
  typeof head.tag !== "string"
)
  throw new Error("readiness_migration_head_outdated");
const contents = await readFile(
  new URL(`${head.tag}.sql`, migrationsRoot),
  "utf8",
);
const hash = createHash("sha256").update(contents).digest("hex");
if (hash !== currentAtharvanMigrationHash)
  throw new Error("readiness_migration_hash_outdated");
const deploymentWorkflow = await readFile(
  new URL("../.github/workflows/deploy.yml", migrationsRoot),
  "utf8",
);
const deploymentVersions = [
  ...deploymentWorkflow.matchAll(
    /verify-deployed-readiness\.mjs[^\r\n]*\s(development|production)\s(\d+)/g,
  ),
];
if (
  deploymentVersions.length !== 2 ||
  deploymentVersions.some(
    (match) => Number(match[2]) !== currentAtharvanSchemaVersion,
  )
)
  throw new Error("deployment_readiness_version_outdated");
