import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  account,
  allowedEmailDomains,
  operatorInvitations,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  operators,
  operatorVerificationChallenges,
  platformConfigurationBindings,
  platformConfigurationDefinitions,
  platformConfigurationRevisions,
  rateLimit,
  session,
  user,
  verification,
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
});
