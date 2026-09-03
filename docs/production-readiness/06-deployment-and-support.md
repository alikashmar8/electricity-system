# Deployment and support

## Outcome

A release can be installed, monitored, upgraded, restored, and handed over consistently without depending on undocumented knowledge held by one developer.

## Reproducible deployment

- [ ] **OPS-01 — P0: Choose the topology.** Document server/provider, region, persistent storage, reverse proxy, DNS, TLS, firewall, backup target, and whether access is public, VPN, or LAN-only.
- [ ] **OPS-02 — P0: Automate installation.** Pin the Node version, use lockfile-based production installation, create directories/permissions, inject secrets, and verify persistent paths.
- [ ] **OPS-03 — P0: Supervise the process.** Use a service manager with controlled restart, boot startup, log capture, graceful shutdown, and restart-loop protection.
- [ ] **OPS-04 — P0: Enforce HTTPS.** Configure certificate renewal, secure cookies, trusted proxy hops, HTTP redirect, and modern TLS at the edge.
  - Acceptance for OPS-01 through OPS-04: a clean host can be built from the runbook/automation and passes a production configuration check.

## Monitoring and recovery

- [ ] **OPS-05 — P0: Structured application logging.** Add request correlation, severity, endpoint/result, startup/shutdown, migration, and operational error events without logging passwords or sensitive payloads.
- [ ] **OPS-06 — P0: Health checks.** Separate liveness and readiness; readiness must check writable persistent storage and database usability.
- [ ] **OPS-07 — P0: Alerts.** Monitor availability, error rate, latency, disk/inode space, memory, restart loops, certificate expiry, backup freshness, and integrity jobs.
- [ ] **OPS-08 — P0: Incident runbooks.** Cover unavailable app, full disk, corrupt database, failed backup, failed migration, compromised user, compromised host, and network outage.
  - Acceptance: alerts reach the responsible person and at least one tabletop/technical incident exercise succeeds.

## Releases and maintenance

- [ ] **OPS-09 — P0: Version releases.** Introduce release versions, change notes, database compatibility notes, artifacts/checksums, and environment-specific configuration validation.
- [ ] **OPS-10 — P0: Upgrade and rollback procedure.** Define maintenance notice, preflight, backup, migration, smoke tests, reconciliation, rollback trigger, and restoration.
- [ ] **OPS-11 — P1: Staging environment.** Maintain production-like configuration with synthetic data for migrations, integration tests, printer checks, and client acceptance.
- [ ] **OPS-12 — P0: Support operations.** Define ticket channel, severity levels, on-call expectations, remote-access approval, maintenance windows, and client communication templates.
- [ ] **OPS-13 — P1: Lifecycle policy.** Schedule dependency/security review, supported Node/browser versions, database growth review, and end-of-life notice.

## Client handoff

- [ ] **OPS-14 — P0: Administrator handoff.** Deliver owner credentials securely, recovery contacts, supported access URL/device list, and user-management procedure.
- [ ] **OPS-15 — P0: Staff training.** Train normal sale, credit sale, payment, return, correction, stock count, closing, outage, and escalation workflows.
- [ ] **OPS-16 — P0: Documentation pack.** Deliver user guide, admin guide, backup/restore evidence, deployment diagram, support agreement, data-export procedure, and known limitations.
- [ ] **OPS-17 — P0: Pilot and cutover.** Run synthetic acceptance, parallel operation, opening-data import/reconciliation, cutover approval, and enhanced post-launch monitoring.

## Suggested production smoke test

1. Verify version, environment, TLS, cookie flags, persistent paths, time zone, and disk capacity.
2. Confirm login and each role's permissions.
3. Create and reverse a test sale using the approved non-production/test procedure.
4. Verify stock, cash/payment, receipt, audit, and report effects.
5. Confirm monitoring saw the requests and no sensitive values appeared in logs.
6. Verify backup freshness without altering live business data.

