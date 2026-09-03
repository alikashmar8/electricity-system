# Project playbook

This file is a repository-specific workflow index. It is not a globally installed Codex skill; `AGENTS.md` tells future sessions to read it.

## API or business-logic changes

Read the affected route in `server.js`, its tables/migrations in `database.js`, and the frontend caller together. Preserve transaction boundaries, two-decimal money handling, snapshot fields, payment allocations, and stock reconciliation. For mutations, test create/edit/delete behavior against disposable SQLite files.

## Database changes

Implement schema creation and forward-compatible upgrade logic in `database.js`. A migration must work when the table is new and when an older populated database is opened. Keep foreign-key behavior explicit and avoid testing against the default database path. Remember that importing `database.js` immediately opens, migrates, defaults, and seeds the configured database.

## Frontend changes

Locate both static markup in `public/index.html` and runtime-injected markup in `public/*.js`. Check shared globals and bottom-of-page script order before moving code. Inspect all later-loaded stylesheets that can override the component being changed. The app has no compilation step, so validate changed scripts with `node --check` and exercise the UI directly when possible.

## POS, client debt, or payment changes

Trace the full flow across `sales`, `sale_items`, `payments`, `client_payment_allocations`, `order_history`, and stock helpers. Verify paid, partial, and unpaid states; initial versus later payments; oldest-first allocation; edits; deletion; and historical snapshots.

## Purchases or supplier-account changes

Treat `traders` as the supplier table. Trace `purchase_invoices`, `purchase_items`, supplier payments in `payments`, `purchase_payment_allocations`, and purchase stock synchronization. Verify invoice create/edit/delete and later supplier payments.

## Catalog, cable, or by-meter changes

Ordinary products, cables, and meter items have different pricing and stock behavior. Check source type/unit normalization at POS and purchase boundaries. Changes to seeds must remain idempotent because both seed modules run whenever `database.js` initializes.

## Authentication or deployment changes

Review `.env.example`, `README.md`, the session store, cookie flags, proxy configuration, and Beirut-midnight expiry together. Never commit a real secret or database. Production requires persistent paths for both SQLite files.

## Safe verification recipe

Use unique files under `/tmp` for the business and session databases and a throwaway secret of at least 32 characters. Create any test user/data only there. At minimum, run syntax checks on changed JavaScript; report that `npm test` is unavailable until a real suite is added rather than presenting the placeholder failure as a product regression.
