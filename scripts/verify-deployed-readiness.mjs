const [originValue, expectedEnvironment, expectedVersionValue] =
  process.argv.slice(2);
const expectedVersion = Number(expectedVersionValue);
let origin;
try {
  origin = new URL(originValue ?? "");
} catch {
  throw new Error("ATHARVAN_CONTROL_PLANE_ORIGIN must be a valid URL.");
}
if (
  origin.protocol !== "https:" ||
  origin.username !== "" ||
  origin.password !== "" ||
  origin.search !== "" ||
  origin.hash !== "" ||
  (expectedEnvironment !== "development" &&
    expectedEnvironment !== "production") ||
  !Number.isSafeInteger(expectedVersion) ||
  expectedVersion < 1
)
  throw new Error("Invalid deployed-readiness verification arguments.");

const endpoint = new URL("/health/ready", origin);
for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    if (
      response.ok &&
      body !== null &&
      typeof body === "object" &&
      body.status === "ready" &&
      body.environment === expectedEnvironment &&
      body.schemaVersion === expectedVersion &&
      typeof body.checkedAt === "string" &&
      Number.isFinite(Date.parse(body.checkedAt))
    ) {
      console.log(
        `Readiness verified for ${expectedEnvironment} schema ${expectedVersion}.`,
      );
      process.exit(0);
    }
  } catch {
    // Deployment propagation and transient network errors share the retry budget.
  }
  if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 3_000));
}
throw new Error(
  `Control-plane readiness did not reach schema ${expectedVersion} in ${expectedEnvironment}.`,
);
