import { verifyMigratedContracts } from "./migration-contract";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required to verify Atharvan migrations.");
await verifyMigratedContracts(databaseUrl);
