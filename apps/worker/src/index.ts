import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { parseRuntimeConfig } from "@atharvan/config";
import { unknownPlatformOverview } from "@atharvan/domain";

const app = new Hono<{ Bindings: Env }>();

export { app };

app.use("*", requestId());
app.use("*", secureHeaders());

app.get("/health/live", (context) => {
  return context.json({
    service: "atharvan-control-plane",
    status: "alive",
    requestId: context.get("requestId"),
  });
});

app.get("/health/ready", (context) => {
  const config = parseRuntimeConfig(context.env);

  return context.json(
    {
      service: "atharvan-control-plane",
      status: "ready",
      environment: config.ATHARVAN_ENVIRONMENT,
      requestId: context.get("requestId"),
    },
    200,
  );
});

app.get("/v1/platform/overview", (context) => {
  return context.json(unknownPlatformOverview);
});

app.notFound((context) => {
  return context.json(
    {
      code: "not_found",
      message: "The requested Atharvan route does not exist.",
      requestId: context.get("requestId"),
    },
    404,
  );
});

app.onError((error, context) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "request.failed",
      requestId: context.get("requestId"),
      errorName: error.name,
    }),
  );

  return context.json(
    {
      code: "internal_error",
      message: "Atharvan could not complete the request.",
      requestId: context.get("requestId"),
    },
    500,
  );
});

export default app;
