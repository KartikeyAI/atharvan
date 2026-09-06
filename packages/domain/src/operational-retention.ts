/** Operational records removed by the bounded retention worker. */
export type OperationalRetentionCategory =
  | "workload_request_nonces"
  | "health_probe_jobs"
  | "transactional_email_provider_events"
  | "verification_email_deliveries"
  | "operational_alert_deliveries"
  | "operational_alert_occurrences"
  | "model_health_observations"
  | "integration_health_observations";

export type OperationalRetentionCounts = Readonly<
  Record<OperationalRetentionCategory, number>
>;

export interface OperationalRetentionPolicy {
  readonly category: string;
  readonly retentionDays: number | null;
  readonly disposition: "delete" | "preserve";
  readonly detail: string;
}

export const operationalRetentionPolicies: ReadonlyArray<OperationalRetentionPolicy> =
  [
    {
      category: "Workload replay nonces",
      retentionDays: 1,
      disposition: "delete",
      detail: "Expired anti-replay material with no durable business value.",
    },
    {
      category: "Health-probe jobs",
      retentionDays: 30,
      disposition: "delete",
      detail: "Completed and superseded scheduler work records.",
    },
    {
      category: "Transactional email metadata",
      retentionDays: 90,
      disposition: "delete",
      detail:
        "Terminal delivery and provider-event metadata outside a suppression evidence chain.",
    },
    {
      category: "Resolved operational alerts",
      retentionDays: 90,
      disposition: "delete",
      detail:
        "Resolved occurrences and their unreferenced terminal deliveries.",
    },
    {
      category: "Dependency health observations",
      retentionDays: 365,
      disposition: "delete",
      detail: "Historical provider and integration probe observations.",
    },
    {
      category: "Audit and recipient-suppression evidence",
      retentionDays: null,
      disposition: "preserve",
      detail:
        "Canonical command, audit, approval, and suppression evidence is excluded from automated deletion.",
    },
  ];

export interface OperationalRetentionHealth {
  readonly observedAt: string;
  readonly state: "unknown" | "pending" | "running" | "completed" | "failed";
  readonly scheduledFor: string | null;
  readonly completedAt: string | null;
  readonly counts: OperationalRetentionCounts | null;
  readonly batchLimitReached: boolean;
  readonly policies: ReadonlyArray<OperationalRetentionPolicy>;
}
