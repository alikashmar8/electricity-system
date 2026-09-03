# Correctness and testing

## Outcome

Automated tests prove the financial and inventory invariants that matter to a shop, and a clean checkout can reproduce those results without touching real data.

## Test foundation

- [ ] **TEST-01 — P0: Add a real test command.** Select a maintained Node test runner and make `npm test` run from a clean checkout.
  - Acceptance: exit status is meaningful, failures identify the scenario, and tests never use the default database path.
- [ ] **TEST-02 — P0: Build disposable database fixtures.** Create isolated new-database and upgraded-database fixtures with deterministic dates and data.
  - Acceptance: parallel/repeated runs cannot mutate developer or production databases.
- [ ] **TEST-03 — P0: Test schema and seeds.** Cover clean initialization, repeated initialization, all historical migrations, foreign keys, indexes, and seed idempotency.
  - Acceptance: schema snapshots/invariant queries match after every supported upgrade path.

## Accounting and payment invariants

- [ ] **TEST-04 — P0: Test sales math.** Cover zero/decimal values, discounts/adjustments, partial payments, full payments, client requirements, edits, and rejected overpayments.
- [ ] **TEST-05 — P0: Test debt allocations.** Cover initial versus later payments, oldest-first combined payments, targeted payments, reallocations after edits, archived debt, and forbidden excess payment.
- [ ] **TEST-06 — P0: Test purchase accounting.** Cover invoice create/edit/delete, payment-now, later supplier payments, oldest-first allocation, and overpayment rejection.
  - Acceptance for TEST-04 through TEST-06: stored totals, status, allocation sums, and displayed balances agree to the selected currency precision after every operation.

## Inventory invariants

- [ ] **TEST-07 — P0: Test stock reconciliation.** Cover product sales, purchases, edits, deletions, Ali Baba `from_stock`, counts, resets, idempotent retry, and out-of-order reference changes.
  - Acceptance: ledger sums equal displayed stock and repeated identical operations do not double-apply movements.
- [ ] **TEST-08 — P0: Decide negative-stock behavior.** Choose block, warn-with-permission, or allow-and-audit per role and item type.
  - Acceptance: API and UI implement the same approved rule with concurrent-sale coverage.
- [ ] **TEST-09 — P0: Test returns/refunds.** Add after SHOP-05 design; verify stock, client debt, payment/refund, profit, and audit effects.

## API and UI confidence

- [ ] **TEST-10 — P0: Authorization/API integration tests.** Cover authentication expiry, roles, validation, error status, destructive routes, and transaction rollback.
- [ ] **TEST-11 — P1: Browser critical-path tests.** Cover login, product lookup, sale, credit sale/payment, order edit, purchase, return, receipt, and closing on supported devices.
- [ ] **TEST-12 — P1: Regression fixtures.** Preserve representative Arabic/English names, cable units, meter quantities, large catalogs, and historical upgraded data.
- [ ] **TEST-13 — P1: Performance tests.** Measure catalog search, dashboard, order history, concurrent checkout, backup, and migration at expected multi-year volume.

## Continuous verification

- [ ] **TEST-14 — P1: CI pipeline.** Run syntax, tests, dependency audit, migration checks, and selected browser tests on every proposed release.
- [ ] **TEST-15 — P1: Release reconciliation.** Compare sales, payments, receivables, payables, stock, and cash totals before and after upgrade.

## Required test design rules

- Freeze or inject time for Beirut-midnight session and reporting tests.
- Compare money in integer minor units or another documented exact representation at accounting boundaries.
- Test both API state and derived dashboard/report values.
- Assert rollback after a deliberately failed multi-step transaction.
- Never make production-readiness depend only on manual clicking.

