import { Pool } from "pg";

const expectedTables = [
  "commercial_plan_entitlement_sets",
  "commercial_plan_entitlement_values",
  "commercial_plan_versions",
  "commercial_plans",
  "commercial_product_revisions",
  "commercial_products",
  "operational_alert_deliveries",
  "operational_alert_occurrences",
  "transactional_email_provider_events",
  "transactional_email_recipient_suppressions",
  "verification_email_deliveries",
  "workspace_enterprise_entitlement_grant_revisions",
  "workspace_enterprise_entitlement_grants",
  "workspace_entitlement_assignments",
  "workspace_entitlement_observations",
  "workspace_entitlement_snapshot_layers",
  "workspace_entitlement_snapshots",
  "arth_command_outbox",
  "arth_workload_request_nonces",
  "operational_retention_runs",
  "platform_approvals",
  "allowed_email_domains",
  "audit_events",
  "customer_directory_sources",
  "customer_directory_snapshot_ingestions",
  "customer_internal_notes",
  "customer_risk_marker_revisions",
  "customer_risk_markers",
  "customer_user_projections",
  "customer_workspace_membership_projections",
  "customer_workspace_ownership_transfer_observations",
  "customer_workspace_ownership_transfers",
  "customer_workspace_projections",
  "model_provider_health_observations",
  "model_provider_revisions",
  "model_providers",
  "model_operational_control_revisions",
  "model_operational_controls",
  "model_revisions",
  "model_routing_policies",
  "model_routing_policy_revisions",
  "model_routing_policy_targets",
  "models",
  "operator_invitations",
  "operator_break_glass_grants",
  "operator_break_glass_reviews",
  "operator_verification_challenges",
  "operators",
  "platform_command_results",
  "platform_commands",
  "platform_configuration_bindings",
  "platform_configuration_definitions",
  "platform_configuration_revisions",
  "platform_feature_flag_revisions",
  "platform_feature_flags",
  "platform_health_probe_jobs",
  "platform_adapter_release_revisions",
  "platform_adapter_releases",
  "platform_integration_health_observations",
  "platform_integration_revisions",
  "platform_integrations",
  "platform_secret_references",
  "platform_secret_versions",
] as const;

const expectedIndexes = [
  "commercial_plan_entitlement_sets_plan_version_unique",
  "commercial_plan_entitlement_sets_correlation_unique",
  "commercial_plan_entitlement_sets_identity_unique",
  "commercial_plan_entitlement_values_key_unique",
  "commercial_plan_versions_number_unique",
  "commercial_plan_versions_correlation_unique",
  "commercial_plan_versions_history_idx",
  "commercial_plan_versions_provider_reference_idx",
  "commercial_plans_product_key_unique",
  "commercial_product_revisions_number_unique",
  "commercial_product_revisions_correlation_unique",
  "commercial_product_revisions_history_idx",
  "commercial_products_environment_key_unique",
  "operational_alert_deliveries_transition_unique",
  "operational_alert_deliveries_due_idx",
  "operational_alert_deliveries_history_idx",
  "operational_alert_occurrences_open_unique",
  "operational_alert_occurrences_history_idx",
  "operational_alert_occurrences_retention_idx",
  "transactional_email_provider_events_identity_unique",
  "transactional_email_provider_events_message_idx",
  "transactional_email_provider_events_history_idx",
  "transactional_email_recipient_suppressions_identity_unique",
  "transactional_email_recipient_suppressions_source_idx",
  "verification_email_delivery_challenge_unique",
  "verification_email_delivery_due_idx",
  "verification_email_delivery_health_idx",
  "verification_email_delivery_expiry_idx",
  "verification_email_delivery_history_idx",
  "verification_email_delivery_provider_message_unique",
  "operational_alert_deliveries_provider_message_unique",
  "arth_command_outbox_command_unique",
  "arth_command_outbox_aggregate_revision_unique",
  "arth_command_outbox_claim_idx",
  "arth_command_outbox_lease_idx",
  "arth_workload_request_nonce_unique",
  "arth_workload_request_nonce_expiry_idx",
  "operational_retention_runs_window_unique",
  "operational_retention_runs_due_idx",
  "operational_retention_runs_history_idx",
  "customer_directory_sources_environment_source_unique",
  "customer_directory_ingestion_revision_unique",
  "customer_directory_ingestion_nonce_unique",
  "customer_directory_ingestion_received_idx",
  "customer_internal_notes_correlation_unique",
  "customer_risk_marker_revisions_number_unique",
  "customer_memberships_environment_pair_unique",
  "customer_memberships_environment_source_unique",
  "customer_users_environment_source_unique",
  "customer_workspaces_environment_source_unique",
  "customer_ownership_transfer_observations_source_unique",
  "customer_ownership_transfers_revision_unique",
  "operators_auth_user_id_unique",
  "operators_single_super_administrator",
  "operator_invitations_one_pending_per_operator",
  "operator_break_glass_grants_expiry_idx",
  "operator_break_glass_reviews_grant_unique",
  "operator_verification_challenges_one_pending_per_operator",
  "operator_verification_challenges_correlation_idx",
  "model_provider_health_provider_observed_idx",
  "model_provider_revisions_number_unique",
  "model_providers_key_environment_unique",
  "model_operational_control_revisions_number_unique",
  "model_operational_controls_provider_unique",
  "model_operational_controls_model_unique",
  "model_revisions_number_unique",
  "model_routing_policies_key_environment_unique",
  "model_routing_policy_revisions_number_unique",
  "model_routing_policy_targets_priority_unique",
  "model_routing_policy_targets_model_unique",
  "model_routing_policy_targets_model_idx",
  "models_provider_key_unique",
  "platform_configuration_bindings_environment_unique",
  "platform_configuration_bindings_platform_unique",
  "platform_configuration_definitions_key_unique",
  "platform_configuration_revisions_number_unique",
  "platform_feature_flag_revisions_number_unique",
  "platform_feature_flags_key_environment_unique",
  "platform_health_probe_jobs_provider_window_unique",
  "platform_health_probe_jobs_integration_window_unique",
  "platform_health_probe_jobs_claim_idx",
  "platform_health_probe_jobs_retention_idx",
  "platform_command_results_command_unique",
  "platform_commands_correlation_unique",
  "platform_commands_idempotency_unique",
  "platform_adapter_release_revisions_number_unique",
  "platform_adapter_releases_identity_unique",
  "platform_integration_health_integration_observed_idx",
  "platform_integration_revisions_number_unique",
  "platform_integrations_key_environment_unique",
  "platform_secret_references_key_environment_unique",
  "platform_secret_versions_one_active",
  "platform_secret_versions_one_pending",
  "workspace_enterprise_entitlement_grant_revisions_number_unique",
  "workspace_enterprise_entitlement_grant_revisions_correlation_unique",
  "workspace_enterprise_entitlement_grants_key_unique",
  "workspace_entitlement_assignments_workspace_unique",
  "workspace_entitlement_observations_source_unique",
  "workspace_entitlement_observations_correlation_unique",
  "workspace_entitlement_observations_assignment_idx",
  "workspace_entitlement_snapshot_layers_source_unique",
  "workspace_entitlement_snapshot_layers_resolution_idx",
  "workspace_entitlement_snapshots_revision_unique",
  "workspace_entitlement_snapshots_correlation_unique",
  "workspace_entitlement_snapshots_history_idx",
] as const;

const expectedAuthTables = [
  "account",
  "passkey",
  "rate_limit",
  "session",
  "user",
  "verification",
] as const;

const expectedAuthIndexes = [
  "auth_account_issuer_account_unique",
  "auth_passkey_credential_unique",
  "auth_passkey_user_id_idx",
  "auth_rate_limit_key_unique",
  "auth_session_token_unique",
  "auth_user_email_unique",
] as const;

const expectedAuthConstraints = ["auth_session_assurance_consistent"] as const;

const expectedAuthTriggers = [
  "auth_passkey_audit_delete",
  "auth_passkey_audit_insert",
  "auth_passkey_audit_rename",
  "auth_passkey_guard_delete",
  "auth_passkey_guard_insert",
  "auth_passkey_guard_update",
  "auth_session_audit_insert",
] as const;

const expectedConstraints = [
  "commercial_plan_entitlement_sets_reason_valid",
  "commercial_plan_entitlement_values_key_valid",
  "commercial_plan_entitlement_values_shape_valid",
  "commercial_plan_versions_number_positive",
  "commercial_plan_versions_content_valid",
  "commercial_plan_versions_pricing_valid",
  "commercial_plan_versions_currency_valid",
  "commercial_plan_versions_trial_valid",
  "commercial_plan_versions_provider_reference_valid",
  "commercial_plans_key_valid",
  "commercial_plans_current_version_fk",
  "commercial_plans_version_positive",
  "commercial_product_revisions_number_positive",
  "commercial_product_revisions_content_valid",
  "commercial_products_key_valid",
  "commercial_products_current_revision_fk",
  "commercial_products_revision_positive",
  "operational_alert_deliveries_kind",
  "operational_alert_deliveries_state",
  "operational_alert_deliveries_attempts",
  "operational_alert_deliveries_lease",
  "operational_alert_deliveries_receipt",
  "operational_alert_deliveries_communication_identity",
  "operational_alert_occurrences_status",
  "operational_alert_occurrences_severity",
  "operational_alert_occurrences_identity",
  "operational_alert_occurrences_content",
  "operational_alert_occurrences_count",
  "operational_alert_occurrences_times",
  "verification_email_delivery_state",
  "verification_email_delivery_attempts",
  "verification_email_delivery_expiry",
  "verification_email_delivery_lease",
  "verification_email_delivery_payload",
  "verification_email_delivery_receipt",
  "verification_email_delivery_communication_identity",
  "transactional_email_provider_events_type_valid",
  "transactional_email_provider_events_target_valid",
  "transactional_email_provider_events_digest_valid",
  "transactional_email_recipient_suppressions_reason_valid",
  "transactional_email_recipient_suppressions_fingerprint_valid",
  "transactional_email_recipient_suppressions_lifecycle_valid",
  "arth_command_outbox_revision_positive",
  "arth_command_outbox_payload_object",
  "arth_command_outbox_payload_sha256",
  "arth_command_outbox_payload_identity",
  "arth_command_outbox_attempts_bounded",
  "arth_command_outbox_expiry_valid",
  "arth_command_outbox_lease_shape",
  "arth_command_outbox_completion_shape",
  "arth_command_outbox_ack_fingerprint_sha256",
  "arth_command_outbox_source_revision_positive",
  "arth_command_outbox_error_bounded",
  "arth_workload_request_key_id_valid",
  "arth_workload_request_nonce_expiry_valid",
  "operational_retention_runs_hour_window",
  "operational_retention_runs_attempts_bounded",
  "operational_retention_runs_lease_shape",
  "operational_retention_runs_completion_shape",
  "operational_retention_runs_error_code_valid",
  "operational_retention_runs_completion_time_valid",
  "operational_retention_runs_counts_valid",
  "customer_access_restriction_observations_actor_shape",
  "customer_ownership_transfer_observations_actor_shape",
  "customer_directory_sources_provenance_shape",
  "customer_directory_ingestion_revision_positive",
  "customer_directory_ingestion_payload_sha256",
  "customer_directory_ingestion_key_id_valid",
  "customer_directory_ingestion_counts_nonnegative",
  "operators_super_administrator_must_be_active",
  "operator_break_glass_grants_lifetime",
  "operator_break_glass_grants_revocation_metadata",
  "customer_ownership_transfer_observations_shape",
  "customer_ownership_transfers_distinct_users",
  "model_provider_health_expiry_after_observation",
  "model_provider_health_source_actor_consistent",
  "model_provider_revisions_health_probe_valid",
  "model_operational_controls_target_shape",
  "model_operational_control_revisions_maintenance_metadata",
  "model_revisions_token_bounds",
  "platform_adapter_release_revisions_activation_evidence",
  "platform_adapter_release_revisions_deprecation_metadata",
  "platform_feature_flag_revisions_expiry_after_review",
  "platform_command_results_body_object",
  "platform_command_results_http_status",
  "platform_commands_idempotency_fingerprint_sha256",
  "platform_commands_payload_fingerprint_sha256",
  "platform_integration_health_expiry_after_observation",
  "platform_integration_health_source_actor_consistent",
  "platform_integration_revisions_health_probe_valid",
  "platform_health_probe_jobs_single_target",
  "platform_health_probe_jobs_revision_positive",
  "platform_health_probe_jobs_attempts_bounds",
  "platform_health_probe_jobs_state_valid",
  "platform_health_probe_jobs_lease_consistent",
  "platform_health_probe_jobs_completion_consistent",
  "platform_health_probe_jobs_completion_reason_valid",
  "platform_health_probe_jobs_contract_valid",
  "platform_integration_revisions_active_oauth_secret",
  "platform_integration_revisions_maintenance_metadata",
  "platform_secret_references_active_metadata",
  "platform_secret_versions_terminal_metadata",
  "workspace_enterprise_entitlement_grant_revisions_number_positive",
  "workspace_enterprise_entitlement_grant_revisions_shape_valid",
  "workspace_enterprise_entitlement_grant_revisions_term_valid",
  "workspace_enterprise_entitlement_grant_revisions_contract_valid",
  "workspace_enterprise_entitlement_grants_key_valid",
  "workspace_enterprise_entitlement_grants_revision_positive",
  "workspace_enterprise_entitlement_grants_current_revision_fk",
  "workspace_entitlement_assignments_workspace_valid",
  "workspace_entitlement_assignments_revision_positive",
  "workspace_entitlement_assignments_current_snapshot_fk",
  "workspace_entitlement_observations_revision_positive",
  "workspace_entitlement_observations_message_valid",
  "workspace_entitlement_observations_key_valid",
  "workspace_entitlement_snapshot_layers_key_valid",
  "workspace_entitlement_snapshot_layers_shape_valid",
  "workspace_entitlement_snapshot_layers_window_valid",
  "workspace_entitlement_snapshots_revision_positive",
  "workspace_entitlement_snapshots_reason_valid",
  "workspace_entitlement_snapshots_set_plan_fk",
] as const;

const forbiddenSecretMaterialColumns = new Set([
  "value",
  "secret_value",
  "ciphertext",
  "api_key",
  "credential_value",
  "token",
  "value_hash",
  "value_preview",
  "payload",
  "request_body",
  "idempotency_key",
]);

const expectedTriggers = [
  "commercial_plan_entitlement_sets_immutable",
  "commercial_plan_entitlement_values_immutable",
  "commercial_product_revisions_immutable",
  "commercial_plan_versions_immutable",
  "commercial_products_guard",
  "commercial_plans_guard",
  "operational_alert_deliveries_guard",
  "operational_alert_occurrences_guard",
  "transactional_email_provider_events_immutable",
  "transactional_email_recipient_suppressions_guard",
  "verification_email_delivery_guard",
  "arth_command_outbox_guard",
  "arth_workload_request_nonce_guard",
  "operational_retention_runs_guard",
  "platform_approvals_guard",
  "operators_preserve_platform_owner",
  "platform_configuration_revisions_immutable",
  "model_provider_health_observations_immutable",
  "model_provider_revisions_immutable",
  "model_operational_control_revisions_immutable",
  "model_revisions_immutable",
  "model_routing_policy_revisions_immutable",
  "model_routing_policy_targets_immutable",
  "platform_adapter_release_revisions_artifact_identity",
  "platform_adapter_release_revisions_immutable",
  "platform_feature_flag_revisions_immutable",
  "audit_events_immutable",
  "platform_command_results_immutable",
  "platform_commands_immutable",
  "platform_integration_health_observations_immutable",
  "platform_integration_revisions_immutable",
  "platform_health_probe_jobs_guard",
  "platform_secret_references_no_delete",
  "platform_secret_versions_no_delete",
  "customer_internal_notes_immutable",
  "customer_risk_markers_immutable",
  "customer_risk_marker_revisions_immutable",
  "customer_workspace_ownership_transfers_immutable",
  "customer_workspace_ownership_transfer_observations_immutable",
  "customer_directory_snapshot_ingestion_guard",
  "operator_break_glass_grants_guarded",
  "operator_break_glass_reviews_immutable",
  "workspace_enterprise_entitlement_grant_revisions_immutable",
  "workspace_enterprise_entitlement_grants_guard",
  "workspace_entitlement_assignments_guard",
  "workspace_entitlement_observations_immutable",
  "workspace_entitlement_snapshot_layers_immutable",
  "workspace_entitlement_snapshots_immutable",
] as const;

const expectedEnumLabels = [
  "commercial_lifecycle.retired",
  "commercial_plan_audience.grandfathered",
  "commercial_pricing_model.contract",
  "commercial_billing_interval.year",
  "commercial_tax_behavior.unspecified",
  "enterprise_entitlement_grant_lifecycle.revoked",
  "entitlement_observation_state.failed",
  "entitlement_overage_policy.contract",
  "entitlement_source_kind.enterprise_grant",
  "entitlement_value_type.quantity",
  "model_provider_health_source.scheduled_probe",
  "platform_integration_health_source.scheduled_probe",
] as const;

/** Verify schema metadata in a read-only transaction; never migrate or seed. */
export async function verifyMigratedContracts(
  databaseUrl: string,
): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    statement_timeout: 10_000,
    query_timeout: 15_000,
  });

  try {
    // max: 1 keeps every query on this transaction's connection.
    await pool.query("BEGIN READ ONLY");
    const tableResult = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const indexResult = await pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public'",
    );
    const constraintResult = await pool.query<{ constraint_name: string }>(
      "select constraint_name from information_schema.table_constraints where constraint_schema = 'public'",
    );
    const authTableResult = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'auth'",
    );
    const authIndexResult = await pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'auth'",
    );
    const authConstraintResult = await pool.query<{ constraint_name: string }>(
      "select constraint_name from information_schema.table_constraints where constraint_schema = 'auth'",
    );
    const authTriggerResult = await pool.query<{ trigger_name: string }>(
      "select trigger_name from information_schema.triggers where trigger_schema = 'auth'",
    );
    const triggerResult = await pool.query<{ trigger_name: string }>(
      "select trigger_name from information_schema.triggers where trigger_schema = 'public'",
    );
    const enumResult = await pool.query<{ typname: string; enumlabel: string }>(
      "select type.typname, value.enumlabel from pg_type type join pg_enum value on value.enumtypid = type.oid join pg_namespace namespace on namespace.oid = type.typnamespace where namespace.nspname = 'public' and type.typname in ('model_provider_health_source', 'platform_integration_health_source', 'commercial_lifecycle', 'commercial_plan_audience', 'commercial_pricing_model', 'commercial_billing_interval', 'commercial_tax_behavior', 'enterprise_entitlement_grant_lifecycle', 'entitlement_observation_state', 'entitlement_overage_policy', 'entitlement_source_kind', 'entitlement_value_type')",
    );
    const functionResult = await pool.query<{ routine_name: string }>(
      "select routine_name from information_schema.routines where routine_schema = 'public' and routine_name = 'platform_http_health_probe_valid'",
    );
    const secretColumnResult = await pool.query<{
      table_name: string;
      column_name: string;
    }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('platform_secret_references', 'platform_secret_versions', 'model_provider_revisions', 'platform_integration_revisions', 'platform_adapter_release_revisions', 'platform_commands', 'platform_command_results')",
    );
    const tableNames = new Set(tableResult.rows.map((row) => row.table_name));
    const indexNames = new Set(indexResult.rows.map((row) => row.indexname));
    const constraintNames = new Set(
      constraintResult.rows.map((row) => row.constraint_name),
    );
    const authTableNames = new Set(
      authTableResult.rows.map((row) => row.table_name),
    );
    const authIndexNames = new Set(
      authIndexResult.rows.map((row) => row.indexname),
    );
    const authConstraintNames = new Set(
      authConstraintResult.rows.map((row) => row.constraint_name),
    );
    const authTriggerNames = new Set(
      authTriggerResult.rows.map((row) => row.trigger_name),
    );
    const triggerNames = new Set(
      triggerResult.rows.map((row) => row.trigger_name),
    );
    const enumLabels = new Set(
      enumResult.rows.map((row) => `${row.typname}.${row.enumlabel}`),
    );

    for (const tableName of expectedTables) {
      if (!tableNames.has(tableName)) {
        throw new Error(`Missing migrated table: ${tableName}`);
      }
    }

    for (const indexName of expectedIndexes) {
      if (!indexNames.has(indexName)) {
        throw new Error(`Missing migrated index: ${indexName}`);
      }
    }

    for (const constraintName of expectedConstraints) {
      if (!constraintNames.has(constraintName)) {
        throw new Error(`Missing migrated constraint: ${constraintName}`);
      }
    }

    for (const triggerName of expectedTriggers) {
      if (!triggerNames.has(triggerName)) {
        throw new Error(`Missing migrated trigger: ${triggerName}`);
      }
    }

    for (const enumLabel of expectedEnumLabels) {
      if (!enumLabels.has(enumLabel)) {
        throw new Error(`Missing migrated enum label: ${enumLabel}`);
      }
    }

    if (functionResult.rows.length !== 1) {
      throw new Error(
        "Missing migrated function: platform_http_health_probe_valid",
      );
    }

    for (const tableName of expectedAuthTables) {
      if (!authTableNames.has(tableName)) {
        throw new Error(`Missing migrated auth table: ${tableName}`);
      }
    }

    for (const indexName of expectedAuthIndexes) {
      if (!authIndexNames.has(indexName)) {
        throw new Error(`Missing migrated auth index: ${indexName}`);
      }
    }

    for (const constraintName of expectedAuthConstraints) {
      if (!authConstraintNames.has(constraintName)) {
        throw new Error(`Missing migrated auth constraint: ${constraintName}`);
      }
    }

    for (const triggerName of expectedAuthTriggers) {
      if (!authTriggerNames.has(triggerName)) {
        throw new Error(`Missing migrated auth trigger: ${triggerName}`);
      }
    }

    for (const column of secretColumnResult.rows) {
      if (forbiddenSecretMaterialColumns.has(column.column_name)) {
        throw new Error(
          `Secret material column must not exist: ${column.table_name}.${column.column_name}`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}
