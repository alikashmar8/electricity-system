# Commercial production release checklist

Release version:

Target client/environment:

Decision date:

Technical approver:

Client approver:

Accountant/legal approval references:

## Scope and acceptance

- [ ] REQ-01 through REQ-06 are complete.
- [ ] Applicable shop features are identified; every non-applicable `P0 if applicable` task has an approved rationale.
- [ ] Client acceptance scenarios, supported hardware, currencies, tax behavior, and system-of-record role are signed.
- [ ] Contract covers ownership, hosting, data, backups, support, updates, liability, export, and termination.

## Data protection

- [ ] Automated consistent backups are running.
- [ ] Off-server encrypted retention meets the agreed policy.
- [ ] Backup failure and age alerts were tested.
- [ ] A clean-host restore passed integrity and reconciliation checks within RPO/RTO.
- [ ] Migration from the previous production schema was rehearsed.
- [ ] Rollback compatibility and trigger are documented.

## Correctness

- [ ] Clean-checkout automated test suite passes.
- [ ] Sales, payments, client debt, purchases, supplier balances, stock, returns, and dashboard/report totals pass regression checks.
- [ ] Money/currency rounding policy is documented and tested.
- [ ] Expected concurrency and multi-year data volume meet performance targets.
- [ ] No test or tool used a real production database.

## Security and accountability

- [ ] Permission matrix is implemented and tested server-side.
- [ ] High-risk actions are restricted and attributed.
- [ ] Audit trail covers all financially significant and destructive mutations.
- [ ] CSRF/origin and security-header checks pass.
- [ ] Production sessions, proxy, HTTPS, and secret configuration pass review.
- [ ] Dependency audit has no unaccepted high/critical findings; all exceptions have owner and expiry.
- [ ] Security review findings are resolved or formally accepted.

## Operations

- [ ] Deployment is reproducible from documented automation/runbooks.
- [ ] Process supervision and graceful restart were tested.
- [ ] Liveness/readiness, logs, metrics, and alerts are operational.
- [ ] Certificate, disk, database, backup, and restart-loop alerts reach the correct person.
- [ ] Upgrade, rollback, server-loss, and database-restore exercises succeeded.
- [ ] Support channel, severity targets, escalation, and maintenance window are active.

## Client readiness

- [ ] Production opening data was imported and reconciled.
- [ ] Owner and staff completed role-appropriate training.
- [ ] Outage/manual fallback and reconciliation were rehearsed.
- [ ] Parallel pilot completed with reconciled totals and no unresolved blocking defects.
- [ ] Client received user/admin documentation and known limitations.
- [ ] Client can request and receive a portable data export.

## Final decision

- [ ] **GO:** all release gates are satisfied and evidence is linked below.
- [ ] **NO-GO:** unresolved blockers are listed below with owners and target dates.

Evidence and notes:

