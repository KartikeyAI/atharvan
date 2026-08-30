import { drizzleAdapter } from "@better-auth/drizzle-adapter";

import {
  createAtharvanAuth,
  createOperatorOnboardingService,
} from "@atharvan/auth";
import { parseAuthenticationRuntimeConfig } from "@atharvan/config";
import {
  authDatabaseSchema,
  createNeonDatabase,
  createPostgresOperatorOnboardingStore,
  createPostgresOperatorSessionPolicyStore,
} from "@atharvan/db";
import {
  createResendTransactionalEmailSender,
  unconfiguredTransactionalEmailSender,
} from "@atharvan/email";

import type { AuthenticationRuntime, RuntimeBindings } from "./index";

const runtimeCache = new WeakMap<
  object,
  Map<string, Promise<AuthenticationRuntime>>
>();

export function resolveProductionAuthenticationRuntime(input: {
  readonly bindings: RuntimeBindings;
  readonly requestOrigin: string;
  readonly waitUntil: (operation: Promise<unknown>) => void;
}): Promise<AuthenticationRuntime> {
  const cacheKey = input.bindings as object;
  let originCache = runtimeCache.get(cacheKey);

  if (originCache === undefined) {
    originCache = new Map();
    runtimeCache.set(cacheKey, originCache);
  }

  let runtime = originCache.get(input.requestOrigin);

  if (runtime === undefined) {
    runtime = createProductionAuthenticationRuntime(input);
    originCache.set(input.requestOrigin, runtime);
  }

  return runtime;
}

async function createProductionAuthenticationRuntime(input: {
  readonly bindings: RuntimeBindings;
  readonly requestOrigin: string;
  readonly waitUntil: (operation: Promise<unknown>) => void;
}): Promise<AuthenticationRuntime> {
  const config = parseAuthenticationRuntimeConfig(input.bindings);
  const databaseHandle = createNeonDatabase(config.DATABASE_URL);
  const onboardingStore = createPostgresOperatorOnboardingStore(
    databaseHandle.database,
  );
  const policyStore = createPostgresOperatorSessionPolicyStore(
    databaseHandle.database,
  );
  const resendApiKey = config.RESEND_API_KEY;
  const emailDeliveryConfigured = resendApiKey !== undefined;
  const emailSender = resendApiKey
    ? createResendTransactionalEmailSender({
        apiKey: resendApiKey,
        from: config.ATHARVAN_EMAIL_FROM,
      })
    : unconfiguredTransactionalEmailSender;

  await createOperatorOnboardingService({
    store: onboardingStore,
    emailSender,
    verificationHmacSecret: config.ATHARVAN_VERIFICATION_HMAC_SECRET,
  }).bootstrapSuperAdministrator({
    email: config.ATHARVAN_SUPER_ADMIN_EMAIL,
    reason: "Configured singleton Super Administrator bootstrap.",
  });

  const auth = createAtharvanAuth({
    database: drizzleAdapter(databaseHandle.database, {
      provider: "pg",
      schema: authDatabaseSchema,
      transaction: true,
    }),
    policyStore,
    emailSender,
    secret: config.BETTER_AUTH_SECRET,
    verificationHmacSecret: config.ATHARVAN_VERIFICATION_HMAC_SECRET,
    baseURL: input.requestOrigin,
    trustedOrigins: [config.ATHARVAN_PUBLIC_ORIGIN, input.requestOrigin],
    defer(operation) {
      input.waitUntil(
        operation.catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: "error",
              event: "operator.verification_email.failed",
              errorName:
                error instanceof Error ? error.name : "UnknownDeliveryError",
            }),
          );
        }),
      );
    },
  });

  return {
    emailDeliveryConfigured,
    handle: (request) => auth.handler(request),
    async getSession(headers) {
      const session = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      });

      return session === null ? null : { userId: session.user.id };
    },
    resolveActiveOperator: (authUserId) =>
      policyStore.resolveActiveOperator(authUserId),
  };
}
