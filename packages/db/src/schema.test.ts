import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  account,
  allowedEmailDomains,
  customerDirectorySources,
  customerUserProjections,
  customerWorkspaceMembershipProjections,
  customerWorkspaceProjections,
  operatorInvitations,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  operators,
  operatorVerificationChallenges,
  modelProviderHealthObservations,
  modelProviderRevisions,
  modelProviders,
  modelOperationalControlRevisions,
  modelOperationalControls,
  modelRevisions,
  modelRoutingPolicies,
  modelRoutingPolicyRevisions,
  modelRoutingPolicyTargets,
  models,
  platformConfigurationBindings,
  platformConfigurationDefinitions,
  platformConfigurationRevisions,
  platformCommandResults,
  platformCommands,
  platformFeatureFlagRevisions,
  platformFeatureFlags,
  platformAdapterReleaseRevisions,
  platformAdapterReleases,
  platformIntegrationHealthObservations,
  platformIntegrationRevisions,
  platformIntegrations,
  platformSecretReferences,
  platformSecretVersions,
  rateLimit,
  session,
  user,
  verification,
  auditEvents,
} from "./schema";

describe("operator onboarding schema", () => {
  it("keeps security-critical identity constraints in PostgreSQL", () => {
    const operatorConfig = getTableConfig(operators);
    const domainConfig = getTableConfig(allowedEmailDomains);

    expect(operatorConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "operators_email_normalized",
        "operators_email_domain_matches",
        "operators_super_administrator_must_be_active",
      ]),
    );
    expect(operatorConfig.indexes.map((entry) => entry.config.name)).toContain(
      "operators_single_super_administrator",
    );
    expect(operatorConfig.indexes.map((entry) => entry.config.name)).toContain(
      "operators_auth_user_id_unique",
    );
    expect(domainConfig.checks.map((constraint) => constraint.name)).toContain(
      "allowed_email_domains_normalized",
    );
  });

  it("stores only a verification digest and enforces one pending challenge", () => {
    const challengeConfig = getTableConfig(operatorVerificationChallenges);
    const invitationConfig = getTableConfig(operatorInvitations);

    expect(challengeConfig.columns.map((column) => column.name)).toContain(
      "code_digest",
    );
    expect(challengeConfig.columns.map((column) => column.name)).not.toContain(
      "code",
    );
    expect(challengeConfig.columns.map((column) => column.name)).toContain(
      "correlation_id",
    );
    expect(challengeConfig.indexes.map((entry) => entry.config.name)).toContain(
      "operator_verification_challenges_one_pending_per_operator",
    );
    expect(
      invitationConfig.indexes.map((entry) => entry.config.name),
    ).toContain("operator_invitations_one_pending_per_operator");
  });

  it("isolates Better Auth state in a dedicated PostgreSQL schema", () => {
    for (const table of [account, rateLimit, session, user, verification]) {
      expect(getTableConfig(table).schema).toBe("auth");
    }

    expect(
      getTableConfig(verification).columns.map((column) => column.name),
    ).toContain("value");
  });

  it("versions role definitions and prevents duplicate active assignments", () => {
    const roleConfig = getTableConfig(operatorRoleDefinitions);
    const assignmentConfig = getTableConfig(operatorRoleAssignments);

    expect(roleConfig.indexes.map((entry) => entry.config.name)).toContain(
      "operator_role_definitions_one_active_version",
    );
    expect(roleConfig.checks.map((constraint) => constraint.name)).toContain(
      "operator_role_definitions_capabilities_nonempty",
    );
    expect(
      assignmentConfig.indexes.map((entry) => entry.config.name),
    ).toContain("operator_role_assignments_active_unique");
    expect(
      assignmentConfig.checks.map((constraint) => constraint.name),
    ).toContain("operator_role_assignments_revocation_metadata");
  });

  it("separates immutable configuration revisions from current bindings", () => {
    const definitionConfig = getTableConfig(platformConfigurationDefinitions);
    const revisionConfig = getTableConfig(platformConfigurationRevisions);
    const bindingConfig = getTableConfig(platformConfigurationBindings);

    expect(
      definitionConfig.checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        "platform_configuration_definitions_key_nonsecret",
        "platform_configuration_definitions_default_type",
      ]),
    );
    expect(revisionConfig.indexes.map((entry) => entry.config.name)).toContain(
      "platform_configuration_revisions_number_unique",
    );
    expect(bindingConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_configuration_bindings_platform_unique",
        "platform_configuration_bindings_environment_unique",
        "platform_configuration_bindings_revision_unique",
      ]),
    );
  });

  it("versions feature flags with ownership, review, and bounded rule metadata", () => {
    const flagConfig = getTableConfig(platformFeatureFlags);
    const revisionConfig = getTableConfig(platformFeatureFlagRevisions);

    expect(flagConfig.indexes.map((entry) => entry.config.name)).toContain(
      "platform_feature_flags_key_environment_unique",
    );
    expect(revisionConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_feature_flag_revisions_number_unique",
        "platform_feature_flag_revisions_review_idx",
        "platform_feature_flag_revisions_owner_idx",
      ]),
    );
    expect(revisionConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "platform_feature_flag_revisions_rules_array",
        "platform_feature_flag_revisions_expiry_after_review",
      ]),
    );
  });

  it("stores immutable command envelopes without raw payloads or idempotency keys", () => {
    const commandConfig = getTableConfig(platformCommands);
    const resultConfig = getTableConfig(platformCommandResults);
    const auditConfig = getTableConfig(auditEvents);
    const commandColumns = commandConfig.columns.map((column) => column.name);

    expect(commandColumns).toEqual(
      expect.arrayContaining([
        "payload_fingerprint",
        "idempotency_fingerprint",
        "approval_reference",
        "evidence_references",
      ]),
    );
    expect(commandColumns).not.toEqual(
      expect.arrayContaining([
        "payload",
        "request_body",
        "idempotency_key",
        "secret_value",
      ]),
    );
    expect(commandConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_commands_idempotency_unique",
        "platform_commands_correlation_unique",
      ]),
    );
    expect(resultConfig.indexes.map((entry) => entry.config.name)).toContain(
      "platform_command_results_command_unique",
    );
    expect(auditConfig.indexes.map((entry) => entry.config.name)).toContain(
      "audit_events_command_idx",
    );
  });

  it("keeps customer directory state explicitly disposable and source-versioned", () => {
    const sourceConfig = getTableConfig(customerDirectorySources);
    const userConfig = getTableConfig(customerUserProjections);
    const workspaceConfig = getTableConfig(customerWorkspaceProjections);
    const membershipConfig = getTableConfig(
      customerWorkspaceMembershipProjections,
    );

    expect(sourceConfig.indexes.map((entry) => entry.config.name)).toContain(
      "customer_directory_sources_environment_source_unique",
    );
    expect(userConfig.indexes.map((entry) => entry.config.name)).toContain(
      "customer_users_environment_source_unique",
    );
    expect(workspaceConfig.indexes.map((entry) => entry.config.name)).toContain(
      "customer_workspaces_environment_source_unique",
    );
    expect(membershipConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "customer_memberships_environment_source_unique",
        "customer_memberships_environment_pair_unique",
      ]),
    );
    expect(membershipConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "granted_permissions",
        "denied_permissions",
        "effective_permissions",
        "source_revision",
        "observed_at",
      ]),
    );
    expect(
      [
        ...userConfig.columns,
        ...workspaceConfig.columns,
        ...membershipConfig.columns,
      ].map((column) => column.name),
    ).not.toEqual(
      expect.arrayContaining([
        "chat",
        "code",
        "repository_contents",
        "secret_value",
        "access_token",
      ]),
    );
  });

  it("stores secret references and version metadata without secret material", () => {
    const referenceConfig = getTableConfig(platformSecretReferences);
    const versionConfig = getTableConfig(platformSecretVersions);
    const columnNames = [
      ...referenceConfig.columns,
      ...versionConfig.columns,
    ].map((column) => column.name);

    expect(columnNames).not.toEqual(
      expect.arrayContaining([
        "value",
        "secret_value",
        "ciphertext",
        "value_hash",
        "value_preview",
      ]),
    );
    expect(referenceConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_secret_references_key_environment_unique",
        "platform_secret_references_provider_id_unique",
      ]),
    );
    expect(versionConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_secret_versions_one_active",
        "platform_secret_versions_one_pending",
        "platform_secret_versions_correlation_unique",
      ]),
    );
  });

  it("versions model catalogue metadata and keeps health evidence append-only", () => {
    const providerConfig = getTableConfig(modelProviders);
    const providerRevisionConfig = getTableConfig(modelProviderRevisions);
    const modelConfig = getTableConfig(models);
    const modelRevisionConfig = getTableConfig(modelRevisions);
    const healthConfig = getTableConfig(modelProviderHealthObservations);

    expect(providerConfig.indexes.map((entry) => entry.config.name)).toContain(
      "model_providers_key_environment_unique",
    );
    expect(
      providerRevisionConfig.indexes.map((entry) => entry.config.name),
    ).toEqual(
      expect.arrayContaining([
        "model_provider_revisions_number_unique",
        "model_provider_revisions_correlation_unique",
        "model_provider_revisions_credential_reference_idx",
      ]),
    );
    expect(modelConfig.indexes.map((entry) => entry.config.name)).toContain(
      "models_provider_key_unique",
    );
    expect(modelRevisionConfig.checks.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "model_revisions_token_bounds",
        "model_revisions_price_nonnegative",
        "model_revisions_currency_usd",
      ]),
    );
    expect(healthConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "model_provider_health_correlation_unique",
        "model_provider_health_provider_observed_idx",
      ]),
    );
    expect(
      providerRevisionConfig.columns.map((column) => column.name),
    ).not.toEqual(
      expect.arrayContaining(["credential_value", "api_key", "token"]),
    );
  });

  it("versions routing policy chains and operational kill switches", () => {
    const policyConfig = getTableConfig(modelRoutingPolicies);
    const revisionConfig = getTableConfig(modelRoutingPolicyRevisions);
    const targetConfig = getTableConfig(modelRoutingPolicyTargets);
    const controlConfig = getTableConfig(modelOperationalControls);
    const controlRevisionConfig = getTableConfig(
      modelOperationalControlRevisions,
    );

    expect(policyConfig.indexes.map((entry) => entry.config.name)).toContain(
      "model_routing_policies_key_environment_unique",
    );
    expect(revisionConfig.indexes.map((entry) => entry.config.name)).toContain(
      "model_routing_policy_revisions_number_unique",
    );
    expect(targetConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "model_routing_policy_targets_priority_unique",
        "model_routing_policy_targets_model_unique",
        "model_routing_policy_targets_model_idx",
      ]),
    );
    expect(controlConfig.checks.map((entry) => entry.name)).toContain(
      "model_operational_controls_target_shape",
    );
    expect(controlRevisionConfig.checks.map((entry) => entry.name)).toContain(
      "model_operational_control_revisions_maintenance_metadata",
    );
  });

  it("versions integration metadata without customer tokens or secret values", () => {
    const integrationConfig = getTableConfig(platformIntegrations);
    const revisionConfig = getTableConfig(platformIntegrationRevisions);
    const healthConfig = getTableConfig(platformIntegrationHealthObservations);
    const revisionColumns = revisionConfig.columns.map((column) => column.name);

    expect(
      integrationConfig.indexes.map((entry) => entry.config.name),
    ).toContain("platform_integrations_key_environment_unique");
    expect(revisionConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_integration_revisions_number_unique",
        "platform_integration_revisions_client_secret_idx",
        "platform_integration_revisions_webhook_secret_idx",
      ]),
    );
    expect(revisionConfig.checks.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "platform_integration_revisions_oauth_shape",
        "platform_integration_revisions_active_oauth_secret",
        "platform_integration_revisions_maintenance_metadata",
      ]),
    );
    expect(revisionColumns).not.toEqual(
      expect.arrayContaining([
        "access_token",
        "refresh_token",
        "client_secret",
        "webhook_secret",
        "secret_value",
      ]),
    );
    expect(healthConfig.indexes.map((entry) => entry.config.name)).toContain(
      "platform_integration_health_integration_observed_idx",
    );
  });

  it("versions signed adapter releases without executable or secret material", () => {
    const releaseConfig = getTableConfig(platformAdapterReleases);
    const revisionConfig = getTableConfig(platformAdapterReleaseRevisions);
    const revisionColumns = revisionConfig.columns.map((column) => column.name);

    expect(releaseConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_adapter_releases_identity_unique",
        "platform_adapter_releases_environment_updated_idx",
      ]),
    );
    expect(revisionConfig.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "platform_adapter_release_revisions_number_unique",
        "platform_adapter_release_revisions_correlation_unique",
        "platform_adapter_release_revisions_lifecycle_idx",
      ]),
    );
    expect(revisionConfig.checks.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "platform_adapter_release_revisions_json_arrays",
        "platform_adapter_release_revisions_activation_evidence",
        "platform_adapter_release_revisions_unsafe_blocked",
        "platform_adapter_release_revisions_deprecation_metadata",
      ]),
    );
    expect(revisionColumns).not.toEqual(
      expect.arrayContaining([
        "package_bytes",
        "package_archive",
        "secret_value",
        "credential_value",
        "customer_configuration",
      ]),
    );
  });
});
