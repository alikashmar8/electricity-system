# Project memory

This is curated context for future sessions, not a work log. Keep it compact and update it according to `AGENTS.md`.

## Purpose and stack

- Dakkak Electric is a small-business inventory, point-of-sale, purchasing, customer-debt, supplier-account, cash, and price-book application.
- It runs on Node.js 20–24 with CommonJS, Express 5, `better-sqlite3`, and a build-free vanilla HTML/CSS/JavaScript frontend.
- `server.js` is the HTTP/API monolith; `database.js` opens the business database, creates/migrates its schema, installs defaults, and runs idempotent cable and by-meter seeds.
- `public/index.html` contains the base application shell plus substantial inline CSS/JavaScript. Feature scripts in `public/` inject additional views and dialogs at runtime.

## Runtime and deployment

- `npm start` runs `node server.js`; the server binds `0.0.0.0` and uses port `3000` unless `PORT` is set.
- Startup requires `SESSION_SECRET` with at least 32 characters. `COOKIE_SECURE=true` is for HTTPS, and `TRUST_PROXY` is a numeric trusted proxy hop count.
- Business data defaults to `database/sandbox.db` (`DATABASE_PATH` overrides it). Sessions default to `database/sessions.sqlite` (`SESSION_DB_PATH` overrides it). Both paths must use persistent storage in production.
- `npm run create-admin` interactively creates or resets an administrator and invalidates that user's older sessions by incrementing `session_version`.
- Authentication uses a custom SQLite-backed `express-session` store. Login is rate-limited, and sessions expire at the next midnight in `Asia/Beirut`, not after a rolling 24-hour period.
- All `/api` routes after the public status/auth routes require login. Transaction reset is additionally admin-only.
- Authorization is otherwise coarse-grained: every active authenticated user can call the remaining business mutation APIs regardless of role.

## Domain and data model

- Catalog sources are ordinary `products`, supplier-priced `cable_entries`, and `meter_items`; POS and purchase lines can snapshot more than one source type.
- Sales use `sales` and `sale_items`; client payments use `payments` plus oldest-first `client_payment_allocations`. Order edits are recorded in `order_history`.
- Purchases use `purchase_invoices` and `purchase_items`; suppliers are stored in the historically named `traders` table. Supplier payments use `payments` plus `purchase_payment_allocations`.
- Inventory is ledger-based in `stock_movements`. POS product sales decrease stock, product purchase lines increase stock, and Ali Baba product lines marked `from_stock` decrease stock. Reference/idempotency helpers reconcile edits and deletes.
- Transaction line tables preserve names, costs, prices, units, and totals as historical snapshots. Do not replace these with live catalog lookups.
- Cable pricing is derived from supplier rules, pricing unit, roll length, and markups. `cable-seed.js` and `meter-item-seed.js` are invoked on every database initialization and rely on conflict-safe inserts/updates.
- Additional ledgers/features include Ali Baba running accounts, manual cash transactions, `nawa2is` checklist items, reminders, dashboard summaries, and persisted top-navigation order.
- Monetary calculations are generally rounded to two decimal places by `accountingMoney`; allocation code also converts values to integer cents before distributing payments.

## Frontend organization and coupling

- The static frontend has no bundler or framework. `public/index.html` defines Products, Cables, By Meter, and the base POS markup; other scripts dynamically add Dashboard, Purchases, Clients, Orders, Ali Baba, Income & Expenses, settings, and utility UI.
- `public/auth.js` exposes `window.authReady` and auth state. Shared inline helpers such as `api`, `toast`, and dialogs are consumed by feature scripts.
- POS behavior is layered: `pos-v1.js` exposes `window.__posV3`, `pos-v3.js` and `pos-v4.js` extend it, and `pos-v4.js` exposes `window.__orderUI` for `orders.js`. Script order at the bottom of `index.html` is therefore significant.
- CSS is also layered and order-dependent, especially the successive `pos-*`, `clients-*`, and `ali-baba-*` stylesheets. Check the final cascade before removing an apparently superseded file.
- The initial POS markup in `index.html` still contains an older disabled “coming later” checkout control; active POS functionality is supplied by the later POS scripts.

## Data/bootstrap utilities

- `import-products.js` imports `System 2026 - Products.csv` directly into the configured business database without duplicate detection. Treat it as a mutating one-time utility, not a safe test command.
- The authenticated product import endpoints support CSV preview and import with an in-memory upload limit of 5 MB.
- Database migrations are inline and forward-only in `database.js`; there is no separate migration tool or version table.

## Verification and known constraints

- There is no automated test suite. The `npm test` script intentionally exits with an error placeholder.
- JavaScript syntax can be checked with `node --check <file>`. Runtime checks require installed dependencies and must use disposable database/session paths.
- There is no application-level database backup, restore, export, retention, or integrity-check workflow; production operations must provide and test these externally.
- The sales flow has no printable customer receipt/tax-invoice implementation or stored VAT/tax breakdown, and no implemented return/refund workflow despite legacy placeholder schema fields.
- Most business mutations and deletions are not attributed to a user. Detailed history exists for order edits/payments, but there is no complete immutable audit trail across catalog, purchases, supplier payments, cash, or stock actions.
- The custom session store prunes expired rows only when the server starts; it does not run periodic cleanup in a long-lived process.
- The business database enables foreign keys but does not explicitly configure WAL mode or a busy timeout; revisit SQLite concurrency settings before expecting substantial concurrent online traffic.
- The two large monoliths (`server.js` and `public/index.html`) plus global frontend coupling make broad refactors high-risk. Validate the affected accounting, stock, authentication, and UI flows narrowly.

## Production-readiness planning

- `docs/production-readiness/README.md` is the source of truth for commercial production planning. It groups tasks into requirements/compliance, data reliability, security/accountability, correctness/testing, shop operations, and deployment/support workstreams, with a final release checklist.
- Roadmap task IDs and priorities should be referenced by implementation changes. All applicable `P0` tasks block a commercial production launch until their acceptance criteria have evidence.
