import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type PlatformCommandOutcome = "succeeded" | "rejected" | "failed";

export type PlatformJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<PlatformJsonValue>
  | { readonly [key: string]: PlatformJsonValue };

export interface PlatformCommandSummary {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly environment: PlatformConfigurationEnvironment;
  readonly targetType: string;
  readonly targetId: string;
  readonly expectedTargetVersion: number | null;
  readonly payloadFingerprint: string;
  readonly idempotencyFingerprint: string;
  readonly approvalReference: string | null;
  readonly evidenceReferences: ReadonlyArray<string>;
  readonly requestedAt: string;
  readonly outcome: PlatformCommandOutcome | null;
  readonly completedAt: string | null;
}

export interface PlatformAuditEventEntry {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly eventType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly correlationId: string;
  readonly reason: string | null;
  readonly evidence: PlatformJsonValue;
  readonly occurredAt: string;
  readonly command: PlatformCommandSummary | null;
}

export interface PlatformAuditEventPage {
  readonly items: ReadonlyArray<PlatformAuditEventEntry>;
  readonly nextCursor: string | null;
}

export interface PlatformAuditQuery {
  readonly actorId?: string;
  readonly eventType?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly correlationId?: string;
  readonly commandName?: string;
  readonly outcome?: PlatformCommandOutcome;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface PlatformAuditExport {
  readonly generatedAt: string;
  readonly format: "ndjson";
  readonly itemCount: number;
  readonly truncated: boolean;
  readonly content: string;
}
