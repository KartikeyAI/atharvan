import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  allowedEmailDomains,
  operatorInvitations,
  operators,
  operatorVerificationChallenges,
} from "./schema";

describe("operator onboarding schema", () => {
  it("keeps security-critical identity constraints in PostgreSQL", () => {
    const operatorConfig = getTableConfig(operators);
    const domainConfig = getTableConfig(allowedEmailDomains);

    expect(operatorConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "operators_email_normalized",
        "operators_email_domain_matches",
      ]),
    );
    expect(operatorConfig.indexes.map((entry) => entry.config.name)).toContain(
      "operators_single_super_administrator",
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
    expect(challengeConfig.indexes.map((entry) => entry.config.name)).toContain(
      "operator_verification_challenges_one_pending_per_operator",
    );
    expect(
      invitationConfig.indexes.map((entry) => entry.config.name),
    ).toContain("operator_invitations_one_pending_per_operator");
  });
});
