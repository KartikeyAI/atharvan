import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to verify Atharvan migrations.");
}

const expectedTables = [
  "allowed_email_domains",
  "audit_events",
  "customer_directory_sources",
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
  "operator_verification_challenges",
  "operators",
  "platform_command_results",
  "platform_commands",
  "platform_configuration_bindings",
  "platform_configuration_definitions",
  "platform_configuration_revisions",
  "platform_feature_flag_revisions",
  "platform_feature_flags",
  "platform_adapter_release_revisions",
  "platform_adapter_releases",
  "platform_integration_health_observations",
  "platform_integration_revisions",
  "platform_integrations",
  "platform_secret_references",
  "platform_secret_versions",
] as const;

const expectedIndexes = [
  "customer_directory_sources_environment_source_unique",
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
] as const;

const expectedAuthTables = [
  "account",
  "rate_limit",
  "session",
  "user",
  "verification",
] as const;

const expectedAuthIndexes = [
  "auth_account_issuer_account_unique",
  "auth_rate_limit_key_unique",
  "auth_session_token_unique",
  "auth_user_email_unique",
] as const;

const expectedConstraints = [
  "operators_super_administrator_must_be_active",
  "customer_ownership_transfer_observations_shape",
  "customer_ownership_transfers_distinct_users",
  "model_provider_health_expiry_after_observation",
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
  "platform_integration_revisions_active_oauth_secret",
  "platform_integration_revisions_maintenance_metadata",
  "platform_secret_references_active_metadata",
  "platform_secret_versions_terminal_metadata",
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
  "platform_secret_references_no_delete",
  "platform_secret_versions_no_delete",
  "customer_internal_notes_immutable",
  "customer_risk_markers_immutable",
  "customer_risk_marker_revisions_immutable",
  "customer_workspace_ownership_transfers_immutable",
  "customer_workspace_ownership_transfer_observations_immutable",
] as const;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});

try {
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
  const triggerResult = await pool.query<{ trigger_name: string }>(
    "select trigger_name from information_schema.triggers where trigger_schema = 'public'",
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
  const triggerNames = new Set(
    triggerResult.rows.map((row) => row.trigger_name),
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
