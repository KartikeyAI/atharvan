import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MembershipDomainEntry,
  ModelProviderCatalogue,
  ModelRoutingOperations,
  OperatorDirectoryEntry,
  OperatorBreakGlassGrantEntry,
  OperatorRoleDefinitionEntry,
  PlatformConfigurationRegistry,
  PlatformIntegrationRegistry,
  PlatformAdapterRegistry,
  PlatformAuditEventPage,
  CustomerDirectoryInspection,
  CustomerDirectorySearchResult,
  CustomerDirectoryStatus,
  CustomerRestrictionRegistry,
  PlatformFeatureFlagRegistry,
  PlatformSecretReferenceRegistry,
  CommercialCatalogue,
} from "@atharvan/domain";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiRequest<Result>(
  path: string,
  init?: RequestInit,
): Promise<Result> {
  const response = await apiResponse(path, init);
  const body: unknown = await response.json().catch(() => null);
  return body as Result;
}

/** Return a successful raw response for bounded downloads and non-JSON bodies. */
export async function apiResponse(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const method = init?.method?.toUpperCase() ?? "GET";
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    !headers.has("idempotency-key")
  ) {
    headers.set("idempotency-key", crypto.randomUUID());
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (!response.ok) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const error = isApiErrorBody(body)
      ? body
      : {
          code: "request_failed",
          message: "Atharvan could not complete the request.",
        };
    if (
      typeof window !== "undefined" &&
      (error.code === "recent_step_up_required" ||
        ("reason" in error && error.reason === "recent_step_up_required")) &&
      !window.location.pathname.startsWith("/security/")
    ) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(
        `/security/verify?returnTo=${encodeURIComponent(returnTo)}`,
      );
    }
    throw new ApiError(response.status, error.code, error.message);
  }

  return response;
}

export function useApiResource<Result>(path: string) {
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly error: ApiError }
    | { readonly status: "success"; readonly data: Result }
  >({ status: "loading" });

  const reload = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    void apiRequest<Result>(path, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    }).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "success", data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError(
                  0,
                  "network_error",
                  "The control plane is unreachable.",
                ),
        });
      },
    );
  }, [path]);

  useEffect(() => {
    reload();
    return () => request.current?.abort();
  }, [reload]);

  return { state, reload };
}

export type OperatorDirectoryResponse = {
  readonly items: ReadonlyArray<OperatorDirectoryEntry>;
  readonly viewerOperatorId?: string;
  readonly canManageLifecycle?: boolean;
};

export type MembershipDomainResponse = {
  readonly items: ReadonlyArray<MembershipDomainEntry>;
};

export type OperatorRolesResponse = {
  readonly items: ReadonlyArray<OperatorRoleDefinitionEntry>;
};

export type OperatorBreakGlassGrantsResponse = {
  readonly items: ReadonlyArray<OperatorBreakGlassGrantEntry>;
};

export type PlatformConfigurationResponse = PlatformConfigurationRegistry;

export type PlatformSecretReferencesResponse = PlatformSecretReferenceRegistry;

export type ModelProviderCatalogueResponse = ModelProviderCatalogue;
export type CommercialCatalogueResponse = CommercialCatalogue;

export type ModelRoutingOperationsResponse = ModelRoutingOperations;

export type PlatformIntegrationRegistryResponse = PlatformIntegrationRegistry;

export type PlatformAdapterRegistryResponse = PlatformAdapterRegistry;

export type PlatformFeatureFlagRegistryResponse = PlatformFeatureFlagRegistry;

export type PlatformAuditEventPageResponse = PlatformAuditEventPage;

export type CustomerDirectoryStatusResponse = CustomerDirectoryStatus;

export type CustomerDirectorySearchResponse = CustomerDirectorySearchResult;

export type CustomerDirectoryInspectionResponse = CustomerDirectoryInspection;

export type CustomerRestrictionRegistryResponse = CustomerRestrictionRegistry;

function isApiErrorBody(value: unknown): value is {
  readonly code: string;
  readonly message: string;
  readonly reason?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    (!("reason" in value) || typeof value.reason === "string")
  );
}
