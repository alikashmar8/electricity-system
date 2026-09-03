# Shop operations

## Outcome

The application supports the exact daily workflows agreed with the client, including corrections and end-of-day accountability—not only the happy path of creating a sale.

## Receipts, tax, and currency

- [ ] **SHOP-01 — P0 if cashier/system-of-record: Receipt/invoice model.** Store immutable document number, shop identity, customer fields when required, line description/unit/quantity/price, subtotal, adjustments, tax breakdown, total, payment method, currency, cashier, and timestamps.
- [ ] **SHOP-02 — P0 if cashier/system-of-record: Numbering and correction rules.** Define server-generated sequential numbering, duplicate/reprint labeling, voids, and credit-note relationships.
- [ ] **SHOP-03 — P0 if cashier/system-of-record: Printable output.** Produce a tested receipt/invoice for the agreed printer/paper size, including Arabic/English requirements.
- [ ] **SHOP-04 — P0 if applicable: VAT/tax reporting.** Implement only the accountant-approved rates, rounding, exemptions, record retention, and reports.
  - Acceptance for SHOP-01 through SHOP-04: sample documents and totals are approved by the client/accountant; reprints and corrections preserve history.
- [ ] **SHOP-05 — P0: Currency model.** Decide single currency or multi-currency, stored transaction currency, display currency, exchange-rate source, override permissions, and rounding.
  - Acceptance: historical transactions never change when a later exchange rate changes.

## Returns and stock exceptions

- [ ] **SHOP-06 — P0: Return/refund workflow.** Link full/partial returns to original lines and capture reason, condition, cashier, approval, refunded amount/method, and timestamp.
- [ ] **SHOP-07 — P0: Inventory disposition.** Decide whether returned goods return to sellable stock, damaged stock, supplier return, or write-off.
- [ ] **SHOP-08 — P0: Financial reversal.** Correct client debt, cash/payment records, sales/profit reporting, and tax documents without deleting the original sale.
  - Acceptance for SHOP-06 through SHOP-08: full, partial, credit-sale, already-paid, and damaged-item scenarios reconcile in tests and audit history.
- [ ] **SHOP-09 — P1: Stock adjustments and transfers.** Add reasoned, permissioned adjustments and branch/location transfers if REQ-02 requires them.

## Fast cashier workflow

- [ ] **SHOP-10 — P1: Barcode/SKU support.** Add unique identifiers, scanner behavior, duplicate handling, label strategy, and fallback search.
- [ ] **SHOP-11 — P1: Payment methods.** Decide cash, card, transfer, mixed tender, customer credit, and refund method behavior.
- [ ] **SHOP-12 — P1: Cash session/open-close.** Track opening float, cashier, expected versus counted cash, variance reason, withdrawals, deposits, and signed close.
- [ ] **SHOP-13 — P1: Receipt hardware.** Test print failure, reprint, paper-out, browser restrictions, and optional cash-drawer integration.
- [ ] **SHOP-14 — P1: Offline/LAN continuity.** Based on REQ-02, choose LAN-local hosting, internet dependency with documented fallback, or a designed synchronization model.
  - Acceptance: staff have a tested procedure for an internet/server/printer outage and later reconciliation.

## Reporting and administration

- [ ] **SHOP-15 — P1: Daily reconciliation report.** Include sales, returns, payment methods, debt collected, purchases/payments, cash movements, and variance.
- [ ] **SHOP-16 — P1: Owner exports.** Provide date-filtered sales, stock, receivable, payable, cash, tax, and audit exports with stable columns.
- [ ] **SHOP-17 — P1: Data import safety.** Add duplicate rules, dry run, validation report, authorization, audit event, and rollback/atomicity for product import.
- [ ] **SHOP-18 — P2: Accessibility and device QA.** Validate keyboard-only cashier operation, touch targets, contrast, Arabic text, mobile/tablet layouts, and supported browsers.

