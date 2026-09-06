# Foundation service and recovery objectives

Status: target policy; measurement and drills remain release evidence.

| Service indicator                                 | Objective                                                        | Window          | Alert threshold                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- | --------------- | -------------------------------------------------------- |
| Authenticated control API successful availability | 99.9% excluding valid `4xx`                                      | Rolling 30 days | 5-minute burn above 14.4× or 1-hour burn above 6×        |
| Read endpoint latency                             | 99% under 1 second                                               | Rolling 7 days  | p99 above 1 second for 10 minutes                        |
| Local administrative mutation latency             | 99% under 2 seconds                                              | Rolling 7 days  | p99 above 2 seconds for 10 minutes                       |
| Arth command enforcement acknowledgement          | 99% within 2 minutes                                             | Rolling 7 days  | Oldest outstanding command over 2 minutes                |
| Verification email provider acceptance            | 99% within 1 minute and before OTP expiry                        | Rolling 7 days  | Oldest pending delivery over 1 minute                    |
| Transactional email delivery feedback             | 99% recorded within 2 minutes of provider event                  | Rolling 7 days  | Missing webhook configuration or recent bounce/complaint |
| Operational alert transition delivery             | 99% within 2 minutes when routing is configured                  | Rolling 30 days | Pending transition over 2 minutes or any dead letter     |
| Health evidence freshness                         | 99% of registered providers/integrations have unexpired evidence | Rolling 7 days  | Any stale/unknown evidence                               |
| Scheduled health-probe execution                  | 99% of due jobs settle within 2 minutes                          | Rolling 7 days  | Oldest outstanding over 2 minutes or any exhaustion      |
| Deployment readiness                              | Exact schema and writable database proven before console release | Every release   | Any `503`, schema mismatch, or missing write privilege   |

Valid operator denials, expired approvals, stale revisions, and consumer-rejected
invalid commands are correctness outcomes, not availability failures. Database,
provider, and configuration failures count against availability. Provider
acceptance is not proof of inbox delivery; bounce/complaint evidence must be added
before notification delivery can claim an inbox-delivery SLO.

The initial recovery objectives are RPO ≤ 5 minutes for PostgreSQL canonical
state and RTO ≤ 60 minutes for the control plane. Immutable artifacts and runtime
configuration must be recoverable within the same RTO. Arth enforcement state is
rebuilt from its receipts plus Atharvan's monotonic desired-state revisions;
unacknowledged commands are replayed. Secret material recovery follows provider
version history and exact-name reconciliation because Atharvan cannot read it
back.

The Platform On-call owns detection, mitigation, queue recovery, and restoration.
The Database Owner owns Neon point-in-time restoration and integrity checks. The
Security Owner owns signing-key compromise, operator lockout, and emergency-access
review. The Arth Runtime Owner owns consumer enforcement and projection rebuilds.
The Release Owner decides rollback or forward-fix and records the evidence. Named
people and escalation destinations must be assigned to these roles before a
production deployment.

Certification requires measured dashboards for each indicator, paging delivery
to the authorised destination, one database restore, one lost-ack replay, one
expired-lease recovery, one current/previous signing-key rotation, and one alert
firing/recovery cycle. Record timestamps, commit, environment, provider receipt,
operator, result, and redacted evidence location.
