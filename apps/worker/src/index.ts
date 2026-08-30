import { Hono, type Context } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { parseRuntimeConfig } from "@atharvan/config";
import {
  operatorHasCapability,
  unknownPlatformOverview,
  type AuthenticatedOperator,
} from "@atharvan/domain";

import { resolveProductionAuthenticationRuntime } from "./auth-runtime";

export interface RuntimeBindings {
  readonly ATHARVAN_ENVIRONMENT: "development" | "production" | "test";
  readonly ATHARVAN_PUBLIC_ORIGIN: string;
  readonly DATABASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly ATHARVAN_VERIFICATION_HMAC_SECRET?: string;
  readonly ATHARVAN_SUPER_ADMIN_EMAIL?: string;
  readonly ATHARVAN_EMAIL_FROM?: string;
  readonly RESEND_API_KEY?: string;
}

export interface AuthenticationRuntime {
  readonly emailDeliveryConfigured: boolean;
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<{ readonly userId: string } | null>;
  resolveActiveOperator(
    authUserId: string,
  ): Promise<AuthenticatedOperator | null>;
}

type AppEnvironment = {
  Bindings: RuntimeBindings;
  Variables: { operator: AuthenticatedOperator };
};

export interface AppDependencies {
  resolveAuthenticationRuntime(
    context: Context<AppEnvironment>,
  ): Promise<AuthenticationRuntime>;
}

const defaultDependencies: AppDependencies = {
  resolveAuthenticationRuntime(context) {
    const requestOrigin = new URL(context.req.url).origin;

    return resolveProductionAuthenticationRuntime({
      bindings: context.env,
      requestOrigin,
      waitUntil: (operation) => context.executionCtx.waitUntil(operation),
    });
  },
};

export function createApp(
  dependencies: AppDependencies = defaultDependencies,
): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

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

  app.all("/api/auth/*", async (context) => {
    const runtime = await dependencies.resolveAuthenticationRuntime(context);

    if (
      !runtime.emailDeliveryConfigured &&
      context.req.path === "/api/auth/email-otp/send-verification-otp"
    ) {
      return context.json(
        {
          code: "email_delivery_unavailable",
          message: "Operator verification email delivery is not configured.",
          requestId: context.get("requestId"),
        },
        503,
      );
    }

    return runtime.handle(context.req.raw);
  });

  app.use("/v1/platform/*", async (context, next) => {
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    const session = await runtime.getSession(context.req.raw.headers);

    if (session === null) {
      return context.json(
        {
          code: "authentication_required",
          message: "An active Atharvan operator session is required.",
          requestId: context.get("requestId"),
        },
        401,
      );
    }

    const operator = await runtime.resolveActiveOperator(session.userId);

    if (operator === null) {
      return context.json(
        {
          code: "operator_access_denied",
          message: "The operator account is not active.",
          requestId: context.get("requestId"),
        },
        403,
      );
    }

    context.set("operator", operator);
    await next();
  });

  app.get("/v1/platform/overview", (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:overview:read")
    ) {
      return context.json(
        {
          code: "operator_capability_required",
          message: "The operator lacks the required platform capability.",
          requestId: context.get("requestId"),
        },
        403,
      );
    }

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

  return app;
}

export const app = createApp();

export default app;
