# Data reliability

## Outcome

Business data can be recovered after deletion, corruption, server loss, or a failed upgrade, with objectively tested recovery time and data-loss limits.

## Backup and restore

- [ ] **DATA-01 — P0: Define recovery targets.** Agree on recovery point objective (RPO) and recovery time objective (RTO) from REQ-01/REQ-02.
  - Acceptance: numeric targets are approved, such as maximum minutes of data loss and maximum hours offline.
- [ ] **DATA-02 — P0: Implement consistent SQLite backups.** Use SQLite's online backup mechanism or another consistency-safe method; do not copy a live database file blindly.
  - Acceptance: scheduled backups include the business database, required configuration, and a manifest with creation time and checksum.
- [ ] **DATA-03 — P0: Store off-server encrypted copies.** Keep multiple generations outside the application host and protect encryption keys separately.
  - Acceptance: losing the entire server does not remove every usable backup; retention matches REQ-06.
- [ ] **DATA-04 — P0: Automate backup monitoring.** Alert on missed jobs, failed uploads, checksum failures, low disk space, and excessive backup age.
  - Acceptance: a forced failure produces an actionable alert received by the responsible person.
- [ ] **DATA-05 — P0: Prove restoration.** Create a documented restore procedure that validates checksums and SQLite integrity before reopening service.
  - Acceptance: a person other than the author restores production-like data to a clean host within the RTO and records evidence.
- [ ] **DATA-06 — P1: Provide client export.** Export catalog and business ledgers in documented, portable formats without exposing password hashes or session data.
  - Acceptance: the client can retrieve their data at handoff and contract termination, and totals reconcile with the application.

## SQLite and schema safety

- [ ] **DATA-07 — P0: Configure SQLite deliberately.** Evaluate WAL mode, `busy_timeout`, synchronous level, checkpointing, file permissions, and expected concurrency for the chosen host.
  - Acceptance: settings are documented, load-tested at the expected concurrency, and applied to every connection where appropriate.
- [ ] **DATA-08 — P0: Add health and integrity checks.** Check database reachability, writable persistent storage, free space, migration state, and periodic `integrity_check`/`quick_check` results.
  - Acceptance: monitoring distinguishes a running HTTP process from a healthy writable database.
- [ ] **DATA-09 — P0: Introduce versioned migrations.** Replace implicit schema inspection as the only migration history with ordered, recorded, transaction-safe migrations.
  - Acceptance: new, previous-production, and partially initialized fixtures reach the same expected schema; each migration runs at most once.
- [ ] **DATA-10 — P0: Make upgrades reversible operationally.** Back up before migration and document application/database rollback compatibility.
  - Acceptance: a simulated failed release is rolled back without losing transactions accepted before maintenance began.
- [ ] **DATA-11 — P1: Separate seed data from migration.** Keep reference seeds idempotent, version intentional seed changes, and prevent startup from unexpectedly overwriting client-managed values.
  - Acceptance: repeated starts make no unapproved business-data changes.
- [ ] **DATA-12 — P1: Add database maintenance.** Define retention/cleanup for expired sessions, checkpointing, analysis/vacuum strategy, and capacity thresholds.
  - Acceptance: maintenance is automated, observable, and does not block the shop during business hours beyond agreed limits.

## Failure scenarios to rehearse

- Complete server loss
- Corrupt or zero-byte database
- Disk full during a sale
- Process termination during a transaction
- Failed migration after application deployment
- Accidental deletion by an authorized user
- Expired/invalid encryption key or unavailable backup provider
- Restore to a host with a newer or older application version

