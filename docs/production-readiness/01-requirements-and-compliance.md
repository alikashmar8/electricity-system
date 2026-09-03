# Requirements and compliance

## Outcome

A signed definition of what the product is, which shop workflows it replaces, and which legal/accounting obligations it must satisfy. This workstream comes first because it determines several `P0` feature requirements.

## Client discovery

- [ ] **REQ-01 — P0: Observe the real workflow.** Document opening, purchasing, receiving stock, pricing, selling, credit sales, collecting debt, returns, damaged goods, end-of-day closing, and owner reporting.
  - Acceptance: the client validates a workflow map containing normal paths, exceptions, roles, and current paper/software records.
- [ ] **REQ-02 — P0: Define users and locations.** Confirm employee count, simultaneous devices, shop branches, remote access, owner access, and expected transaction volume.
  - Acceptance: capacity and authorization assumptions are written and approved.
- [ ] **REQ-03 — P0: Decide the system's legal role.** State whether it is an internal inventory/ledger aid, a cashier system, an official invoicing system, or an accounting system of record.
  - Acceptance: the contract and UI terminology do not claim capabilities beyond the approved role.
- [ ] **REQ-04 — P0: Accountant review.** Have the client's accountant define required invoice/receipt fields, numbering, VAT behavior, currencies, reports, retention, and correction rules.
  - Acceptance: a dated written specification is approved by the accountant/client and mapped to SHOP tasks.
- [ ] **REQ-05 — P0: Privacy review.** Inventory customer, employee, supplier, credential, and operational data; define purpose, access, retention, deletion, export, and breach notification responsibilities.
  - Acceptance: the client approves a data-handling schedule and an appropriate professional reviews local obligations.
- [ ] **REQ-06 — P0: Retention and record correction policy.** Decide which records may be edited, voided, reversed, archived, or permanently deleted and how long records must remain accessible.
  - Acceptance: financial records use approved correction/reversal behavior and required records cannot be silently destroyed.

## Product and commercial scope

- [ ] **REQ-07 — P1: Hardware matrix.** Record browsers, screen sizes, receipt printer, barcode scanner, cash drawer, network router, UPS, and backup device/cloud target.
  - Acceptance: supported hardware and tested versions are included in handoff documentation.
- [ ] **REQ-08 — P0: Define ownership and service boundaries.** Specify software license, source-code access, data ownership, hosting owner, domain owner, third-party subscriptions, and responsibility for backups/security updates.
  - Acceptance: these terms appear in the signed agreement and do not depend on verbal expectations.
- [ ] **REQ-09 — P0: Define support and warranty.** Specify support hours, response targets, exclusions, update policy, maintenance fee, incident contact, liability limits, and termination/data-export procedure.
  - Acceptance: the client signs an agreement reviewed by a qualified local professional.
- [ ] **REQ-10 — P1: Acceptance plan.** Define sample-data review, staff training, parallel run, reconciliation, cutover, and post-launch warranty period.
  - Acceptance: named client stakeholders sign each acceptance stage.
- [ ] **REQ-11 — P0: Confirm commercial-use rights.** Inventory application code, npm dependencies, images/logos, fonts, icons, imported product data, and other bundled material; define the license granted to the client.
  - Acceptance: required notices are delivered, every bundled asset has documented commercial-use rights, and the contract matches the intended source/binary license.

## Decisions to record

- Country and applicable jurisdiction:
- Official system role:
- Tax/VAT status:
- Supported currencies and exchange-rate policy:
- Invoice/receipt type and numbering authority:
- Minimum retention period:
- Maximum tolerable data loss (RPO):
- Maximum tolerable downtime (RTO):
- Number of concurrent users and branches:
- Internet-required, LAN-only, or offline-capable:

Record approved answers in [`DECISIONS.md`](DECISIONS.md).

