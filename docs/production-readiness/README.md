# Production-readiness roadmap

## Goal

Turn Dakkak Electric from a supervised single-shop pilot into a supportable commercial product without risking the client's sales, inventory, payments, or customer data.

This roadmap is the planning source of truth. It groups related findings into workstreams instead of creating one file per finding; that keeps dependencies, shared acceptance criteria, and release sequencing visible.

## How to use this roadmap

- Give every implementation change one or more task IDs from these documents.
- Change a task checkbox only after its acceptance criteria have evidence.
- Record lasting scope decisions in the relevant workstream, not only in issues or chat.
- Add links to tests, runbooks, or decision records beside the completed task.
- A `P0` item blocks a commercial production launch. `P1` is required when the client's workflow uses that capability. `P2` is a valuable post-launch improvement.
- “Not required” is a decision, not an omission: record who approved it and why.

## Workstreams

| Workstream | Outcome | Current state |
|---|---|---|
| [Requirements and compliance](01-requirements-and-compliance.md) | Signed scope, fiscal/privacy decisions, and commercial boundaries | Not started |
| [Data reliability](02-data-reliability.md) | Recoverable, migration-safe, integrity-checked business data | Not started |
| [Security and accountability](03-security-and-accountability.md) | Least-privilege access, attributable changes, hardened web surface | Not started |
| [Correctness and testing](04-correctness-and-testing.md) | Repeatable proof that accounting and stock behavior remain correct | Not started |
| [Shop operations](05-shop-operations.md) | Required cashier, inventory, receipt, and end-of-day workflows | Not started |
| [Deployment and support](06-deployment-and-support.md) | Reproducible hosting, monitoring, upgrades, and client handoff | Not started |
| [Decision log](DECISIONS.md) | Approved cross-workstream product and commercial choices | Active |
| [Release checklist](RELEASE-CHECKLIST.md) | Final evidence-based go/no-go decision | Not started |

## Recommended delivery sequence

1. **Discovery:** complete requirements, accountant/legal review, and client workflow observation.
2. **Safety foundation:** implement backups, restore drills, migration discipline, audit identity, and a test harness.
3. **Correctness:** lock down money, debt allocation, stock, deletion, and return/refund behavior with tests.
4. **Security:** implement roles, authorization, audit coverage, request hardening, and dependency remediation.
5. **Shop workflow:** build only the receipt, currency, barcode, closing, and reporting features confirmed in discovery.
6. **Operations:** automate deployment, monitoring, backup alerts, upgrades, and rollback.
7. **Pilot:** run with sample data, then in parallel with the client's existing process before cutover.
8. **Release:** complete and sign the release checklist.

Data safety, tests, and user attribution should be designed together. Adding detailed roles after features have shipped often leaves unprotected endpoints and anonymous historical activity.

## Current risk register

| ID | Risk | Impact | Planned control |
|---|---|---|---|
| R-01 | Database loss or corruption | Loss of business history and operational downtime | DATA-01 through DATA-05 |
| R-02 | Accounting or stock regression | Incorrect debt, profit, payment, or inventory values | TEST-01 through TEST-07 |
| R-03 | Excessive employee permissions | Unauthorized price, cash, payment, or record changes | SEC-01 through SEC-04 |
| R-04 | Unattributed edits/deletions | Disputes cannot be reconstructed | SEC-05 and SEC-06 |
| R-05 | Web attack or account compromise | Data disclosure or destructive actions | SEC-07 through SEC-12 |
| R-06 | Non-compliant receipt/records | Tax, accounting, or customer disputes | REQ-03 through REQ-06 and SHOP-01 through SHOP-04 |
| R-07 | Missing return/refund flow | Staff delete history or corrupt stock to handle returns | SHOP-06 through SHOP-08 |
| R-08 | Server/process failure | Shop cannot sell or inspect balances | OPS-01 through OPS-08 |
| R-09 | Unsupported client expectations | Unbounded fixes, liability, and payment disputes | REQ-01, REQ-08, REQ-09, OPS-12 |
| R-10 | Tight frontend/backend coupling | High regression rate and slow maintenance | TEST-11, TEST-14, OPS-09 |

## Commercial release gates

A production sale is blocked until all applicable `P0` items satisfy their acceptance criteria and:

- A restore has succeeded from an automated off-server backup.
- Financial and stock regression tests pass from a clean checkout.
- Every destructive or financially significant operation is authorized and attributable.
- The client and their accountant have accepted the receipt, tax, currency, retention, and reporting behavior.
- A production-like pilot and rollback exercise have succeeded.
- Ownership, support, hosting, backups, data export, security updates, and termination obligations are written into the client agreement.

## Out of scope until explicitly chosen

Do not silently assume the product supports multi-company tenancy, multiple branches, full double-entry accounting, payroll, e-commerce, cloud synchronization, native mobile apps, or regulatory certification. Add a workstream decision before committing to any of them.
