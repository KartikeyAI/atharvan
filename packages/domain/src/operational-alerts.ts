import type { PlatformConfigurationEnvironment } from "./platform-configuration";
import type {
  ArthCommandDeliveryHealth,
  PlatformHealthSummary,
} from "./platform-overview";
import type { EmailDeliveryHealth } from "./email-delivery";
import type { PlatformHealthProbeQueueHealth } from "./platform-health";
import type { OperationalRetentionHealth } from "./operational-retention";

export interface OperationalAlert {
  /** Stable per environment, source, and rule; this is not an incident ID. */
  readonly id: string;
  readonly source:
    | "models"
    | "integrations"
    | "email"
    | "secrets"
    | "arth"
    | "alerting"
    | "health_probes"
    | "retention";
  readonly code:
    | "unavailable"
    | "degraded"
    | "stale"
    | "unknown"
    | "read_failed"
    | "delivery_failed"
    | "delivery_backlog"
    | "command_rejected"
    | "command_dead_letter"
    | "command_backlog"
    | "alert_delivery_failed"
    | "alert_delivery_backlog"
    | "feedback_not_configured"
    | "recipient_suppressed"
    | "probe_execution_failed"
    | "probe_backlog"
    | "retention_failed"
    | "retention_overdue"
    | "retention_backlog"
    | "not_configured";
  readonly severity: "critical" | "warning";
  readonly affectedCount: number | null;
  readonly title: string;
  readonly description: string;
  readonly nextStep: string;
}

export interface FoundationConfigurationEvidence {
  readonly emailDeliveryHealth?: EmailDeliveryHealth | null;
  readonly emailDeliveryConfigured: boolean;
  readonly emailFeedbackConfigured?: boolean;
  readonly secretProviderConfigured: boolean;
  readonly arthCommandDeliveryHealth?: ArthCommandDeliveryHealth | null;
  readonly arthWorkloadConfigured?: boolean;
  readonly platformHealthProbeQueueHealth?: PlatformHealthProbeQueueHealth | null;
  readonly operationalRetentionHealth?: OperationalRetentionHealth | null;
  readonly alertDeliveryConfigured?: boolean;
  readonly alertDeliveryHealth?: {
    readonly observedAt: string;
    readonly pending: number;
    readonly leased: number;
    readonly deadLetters: number;
    readonly bounced: number;
    readonly complained: number;
    readonly oldestPendingAt: string | null;
  } | null;
}

/** Derive current signals only. No credentials, notifications, or incident state. */
export function buildOperationalAlerts(
  environment: PlatformConfigurationEnvironment,
  evidence: ReadonlyArray<PlatformHealthSummary>,
  configuration?: FoundationConfigurationEvidence,
): ReadonlyArray<OperationalAlert> {
  const alerts: OperationalAlert[] = [];
  function add(alert: Omit<OperationalAlert, "id">) {
    alerts.push({
      ...alert,
      id: `${environment}:${alert.source}:${alert.code}`,
    });
  }
  for (const summary of evidence) {
    const source = summary.source;
    const label = source === "models" ? "Model providers" : "Integrations";
    const counts = summary.counts;
    if (counts === null) {
      add({
        source,
        code: "read_failed",
        severity: "critical",
        affectedCount: null,
        title: `${label}: evidence unavailable`,
        description:
          "Health evidence could not be read. Service health cannot be determined.",
        nextStep:
          "Refresh the overview. If the read still fails, check control-plane database connectivity and schema compatibility.",
      });
      continue;
    }
    if (counts.unavailable > 0)
      add({
        source,
        code: "unavailable",
        severity: "critical",
        affectedCount: counts.unavailable,
        title: `${label}: unavailable probes`,
        description:
          "Current recorded probes report unavailable service. Routing impact has not been verified.",
        nextStep: `Review the latest probes in ${label}, check the upstream service and credentials, and record a new probe after recovery.`,
      });
    if (counts.degraded > 0)
      add({
        source,
        code: "degraded",
        severity: "warning",
        affectedCount: counts.degraded,
        title: `${label}: degraded probes`,
        description: "Current recorded probes report degraded service.",
        nextStep: `Review latency and failure evidence in ${label}; investigate the upstream service before changing routing.`,
      });
    if (counts.stale > 0)
      add({
        source,
        code: "stale",
        severity: "warning",
        affectedCount: counts.stale,
        title: `${label}: evidence expired`,
        description:
          "The latest recorded probes have expired. Previous success or failure is no longer current evidence.",
        nextStep: `Run new probes from ${label}. Refreshing the overview alone does not renew evidence.`,
      });
    if (counts.unknown > 0)
      add({
        source,
        code: "unknown",
        severity: "warning",
        affectedCount: counts.unknown,
        title: `${label}: evidence missing`,
        description:
          "Registered entries have no usable observation, or their latest observation is dated in the future.",
        nextStep: `Check observation timestamps and run probes from ${label} to establish current health.`,
      });
  }
  const delivery = configuration?.emailDeliveryHealth;
  if (delivery === null)
    add({
      source: "email",
      code: "read_failed",
      severity: "critical",
      affectedCount: null,
      title: "Email delivery evidence is unavailable",
      description: "Delivery progress could not be read from the queue.",
      nextStep:
        "Check database connectivity and migrations, then refresh Email delivery.",
    });
  else if (delivery) {
    const failures =
      delivery.deadLetters +
      delivery.expired +
      delivery.bounced +
      delivery.complained;
    if (failures > 0)
      add({
        source: "email",
        code: "delivery_failed",
        severity: "warning",
        affectedCount: failures,
        title: "Verification emails need attention",
        description:
          "Queued messages failed or expired during the last 15 minutes.",
        nextStep:
          "Open Email delivery, review the failure reasons, and request fresh codes after resolving the cause.",
      });
    if (delivery.activeSuppressions > 0)
      add({
        source: "email",
        code: "recipient_suppressed",
        severity: "warning",
        affectedCount: delivery.activeSuppressions,
        title: "Transactional email recipients are blocked",
        description:
          "Provider failure, bounce, suppression, or complaint evidence currently blocks future delivery.",
        nextStep:
          "Open Email delivery and restore a recipient only after confirming the mailbox or complaint issue is resolved.",
      });
    if (
      configuration?.emailDeliveryConfigured &&
      delivery.oldestPendingAt &&
      Date.parse(delivery.observedAt) - Date.parse(delivery.oldestPendingAt) >
        60_000
    )
      add({
        source: "email",
        code: "delivery_backlog",
        severity: "warning",
        affectedCount: delivery.pending,
        title: "Verification email delivery is delayed",
        description:
          "At least one queued email has waited more than one minute.",
        nextStep:
          "Review pending deliveries, provider availability and the scheduled worker. Codes keep their original expiry.",
      });
  }
  if (configuration?.emailDeliveryConfigured === false)
    add({
      source: "email",
      code: "not_configured",
      severity: "critical",
      affectedCount: null,
      title: "Email delivery is not configured",
      description:
        "Invitation and bootstrap verification emails cannot be delivered by this runtime.",
      nextStep:
        "Ask the deployment administrator to configure the email provider and verified sender, then verify delivery to an approved recipient.",
    });
  if (
    configuration?.emailDeliveryConfigured === true &&
    configuration.emailFeedbackConfigured === false
  )
    add({
      source: "email",
      code: "feedback_not_configured",
      severity: "warning",
      affectedCount: null,
      title: "Email delivery feedback is not configured",
      description:
        "Provider acceptance is recorded, but delivery, bounce, and complaint outcomes cannot be reconciled.",
      nextStep:
        "Configure the signed Resend webhook for delivered, delayed, failed, bounced, complained, sent, and suppressed events.",
    });
  if (configuration?.secretProviderConfigured === false)
    add({
      source: "secrets",
      code: "not_configured",
      severity: "warning",
      affectedCount: null,
      title: "Secret management is not configured",
      description:
        "Managed credential creation, rotation, and revocation are unavailable in this runtime.",
      nextStep:
        "Ask the deployment administrator to configure the secret provider, then verify its lifecycle operations. Never put credential values in notes or audit reasons.",
    });
  const arthDelivery = configuration?.arthCommandDeliveryHealth;
  if (arthDelivery === null)
    add({
      source: "arth",
      code: "read_failed",
      severity: "critical",
      affectedCount: null,
      title: "Arth command evidence is unavailable",
      description:
        "Command delivery progress could not be read from the outbox.",
      nextStep:
        "Check database connectivity and migrations, then inspect the Arth command exchange before changing controls.",
    });
  else if (arthDelivery) {
    if (arthDelivery.deadLetters > 0)
      add({
        source: "arth",
        code: "command_dead_letter",
        severity: "critical",
        affectedCount: arthDelivery.deadLetters,
        title: "Arth commands reached dead letter",
        description:
          "One or more control commands expired or exhausted delivery attempts during the last 15 minutes without accepted enforcement evidence.",
        nextStep:
          "Inspect command audit evidence, restore the consumer or signing configuration, and issue a new control revision after resolving the cause.",
      });
    if (arthDelivery.rejected > 0)
      add({
        source: "arth",
        code: "command_rejected",
        severity: "critical",
        affectedCount: arthDelivery.rejected,
        title: "Arth rejected control commands",
        description:
          "Arth rejected one or more commands during the last 15 minutes, so requested state is not confirmed as enforced.",
        nextStep:
          "Review the acknowledgement reason and source revision, correct the target state, and submit a new revision.",
      });
    if (
      arthDelivery.oldestOutstandingAt !== null &&
      Date.parse(arthDelivery.observedAt) -
        Date.parse(arthDelivery.oldestOutstandingAt) >
        2 * 60_000
    )
      add({
        source: "arth",
        code: "command_backlog",
        severity: "warning",
        affectedCount: arthDelivery.pending + arthDelivery.leased,
        title: "Arth command delivery is delayed",
        description:
          "At least one control command has remained outstanding for more than two minutes.",
        nextStep:
          "Check the Arth consumer, signing keys, leases, and network path before issuing additional control changes.",
      });
  }
  if (configuration?.arthWorkloadConfigured === false)
    add({
      source: "arth",
      code: "not_configured",
      severity: "critical",
      affectedCount: null,
      title: "Arth command exchange is not configured",
      description:
        "Customer restrictions and platform controls cannot reach their enforcement runtime.",
      nextStep:
        "Configure the workload audience and signing keys on both services before enabling enforcement.",
    });
  const probeQueue = configuration?.platformHealthProbeQueueHealth;
  if (probeQueue === null)
    add({
      source: "health_probes",
      code: "read_failed",
      severity: "critical",
      affectedCount: null,
      title: "Scheduled probe evidence is unavailable",
      description:
        "The durable health-probe queue could not be read, so automated coverage cannot be confirmed.",
      nextStep:
        "Check database connectivity, migration compatibility, and scheduled Worker failures.",
    });
  else if (probeQueue) {
    if (probeQueue.retryExhausted > 0)
      add({
        source: "health_probes",
        code: "probe_execution_failed",
        severity: "critical",
        affectedCount: probeQueue.retryExhausted,
        title: "Scheduled health probes exhausted recovery",
        description:
          "One or more probe jobs exhausted their lease-recovery budget during the last 15 minutes.",
        nextStep:
          "Inspect scheduled Worker failures and probe audit evidence, then restore execution before relying on reported health.",
      });
    if (
      probeQueue.oldestOutstandingAt !== null &&
      Date.parse(probeQueue.observedAt) -
        Date.parse(probeQueue.oldestOutstandingAt) >
        2 * 60_000
    )
      add({
        source: "health_probes",
        code: "probe_backlog",
        severity: "warning",
        affectedCount: probeQueue.pending + probeQueue.leased,
        title: "Scheduled health probes are delayed",
        description:
          "At least one health probe has remained outstanding for more than two minutes.",
        nextStep:
          "Check scheduled Worker execution, expired leases, database availability, and upstream probe timeouts.",
      });
  }
  const alertDelivery = configuration?.alertDeliveryHealth;
  if (alertDelivery === null)
    add({
      source: "alerting",
      code: "read_failed",
      severity: "critical",
      affectedCount: null,
      title: "Alert delivery evidence is unavailable",
      description:
        "Operational alert delivery progress could not be read from its durable outbox.",
      nextStep:
        "Check database connectivity and migration 0022, then inspect scheduled Worker failures.",
    });
  else if (alertDelivery) {
    if (
      alertDelivery.deadLetters +
        alertDelivery.bounced +
        alertDelivery.complained >
      0
    )
      add({
        source: "alerting",
        code: "alert_delivery_failed",
        severity: "critical",
        affectedCount:
          alertDelivery.deadLetters +
          alertDelivery.bounced +
          alertDelivery.complained,
        title: "Operational alert delivery failed",
        description:
          "One or more firing or recovery notifications reached dead letter in the last 15 minutes.",
        nextStep:
          "Restore the alert provider or destination and inspect the durable delivery evidence before manually notifying on-call.",
      });
    if (
      configuration.alertDeliveryConfigured &&
      alertDelivery.oldestPendingAt &&
      Date.parse(alertDelivery.observedAt) -
        Date.parse(alertDelivery.oldestPendingAt) >
        2 * 60_000
    )
      add({
        source: "alerting",
        code: "alert_delivery_backlog",
        severity: "critical",
        affectedCount: alertDelivery.pending + alertDelivery.leased,
        title: "Operational alert delivery is delayed",
        description:
          "At least one firing or recovery notification has remained outstanding for more than two minutes.",
        nextStep:
          "Check the scheduled Worker, Resend availability, destination configuration, and expired delivery leases.",
      });
  }
  if (configuration?.alertDeliveryConfigured === false)
    add({
      source: "alerting",
      code: "not_configured",
      severity: "critical",
      affectedCount: null,
      title: "Operational alert delivery is not configured",
      description:
        "Current platform failures cannot be routed to an external operational destination.",
      nextStep:
        "Configure an authorised alert distribution address and the email provider, then verify firing and recovery delivery.",
    });
  const retention = configuration?.operationalRetentionHealth;
  if (retention === null)
    add({
      source: "retention",
      code: "read_failed",
      severity: "critical",
      affectedCount: null,
      title: "Retention evidence is unavailable",
      description:
        "The latest operational-retention run could not be read from durable storage.",
      nextStep:
        "Check database connectivity, migration compatibility, and scheduled Worker execution.",
    });
  else if (retention) {
    const observedAt = Date.parse(retention.observedAt);
    const scheduledFor = retention.scheduledFor
      ? Date.parse(retention.scheduledFor)
      : Number.NaN;
    const completedAt = retention.completedAt
      ? Date.parse(retention.completedAt)
      : Number.NaN;
    if (retention.state === "failed")
      add({
        source: "retention",
        code: "retention_failed",
        severity: "critical",
        affectedCount: null,
        title: "Operational retention failed",
        description:
          "The latest bounded retention run exhausted its retry budget.",
        nextStep:
          "Inspect scheduled Worker and database failures, then restore hourly retention execution.",
      });
    else if (
      retention.state === "unknown" ||
      !Number.isFinite(completedAt) ||
      observedAt - completedAt > 2 * 60 * 60_000 ||
      ((retention.state === "pending" || retention.state === "running") &&
        Number.isFinite(scheduledFor) &&
        observedAt - scheduledFor > 5 * 60_000)
    )
      add({
        source: "retention",
        code: "retention_overdue",
        severity: "warning",
        affectedCount: null,
        title: "Operational retention is overdue",
        description:
          "No successful bounded retention run was recorded within the expected two-hour window.",
        nextStep:
          "Check scheduled Worker execution and the latest retention run before operational tables exceed their capacity envelope.",
      });
    if (retention.batchLimitReached)
      add({
        source: "retention",
        code: "retention_backlog",
        severity: "warning",
        affectedCount: null,
        title: "Operational retention reached its batch limit",
        description:
          "At least one evidence category filled the bounded hourly deletion batch and may have more eligible records.",
        nextStep:
          "Keep hourly execution healthy and inspect table growth until a later run completes below the batch limit.",
      });
  }
  // Fixed severity/ID ordering prevents cards moving unpredictably on refresh.
  return alerts.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );
}
