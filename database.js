require('dotenv').config({ quiet: true });
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database location
const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, 'database', 'sandbox.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Create/open the database
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_en TEXT NOT NULL,
        name_ar TEXT,
        category TEXT,
        unit TEXT NOT NULL DEFAULT 'piece',
        cost_price REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL DEFAULT 0,
        is_cable INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cable_details (
        product_id INTEGER PRIMARY KEY,
        cable_type TEXT NOT NULL,
        size TEXT NOT NULL,
        sold_by TEXT NOT NULL DEFAULT 'meter',
        trader_base_price REAL NOT NULL DEFAULT 0,
        discount_pct REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS traders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_date TEXT NOT NULL,
        client_id INTEGER,
        walk_in_name TEXT,
        walk_in_phone TEXT,
        status TEXT NOT NULL DEFAULT 'paid',
        items_total REAL NOT NULL DEFAULT 0,
        adjustment_amount REAL NOT NULL DEFAULT 0,
        final_total REAL NOT NULL DEFAULT 0,
        related_sale_id INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (related_sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name_snapshot TEXT NOT NULL,
        quantity REAL NOT NULL,
        cost_price_at_sale REAL NOT NULL,
        selling_price_at_sale REAL NOT NULL,
        line_type TEXT NOT NULL DEFAULT 'sale',
        notes TEXT,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trader_id INTEGER NOT NULL,
        invoice_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trader_id) REFERENCES traders(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        notes TEXT,
        FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        direction TEXT NOT NULL,
        category TEXT,
        client_id INTEGER,
        trader_id INTEGER,
        sale_id INTEGER,
        purchase_id INTEGER,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (trader_id) REFERENCES traders(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        movement_date TEXT NOT NULL,
        quantity_change REAL NOT NULL,
        reason TEXT NOT NULL,
        reference_type TEXT,
        reference_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        is_active INTEGER NOT NULL DEFAULT 1,
        session_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE IF NOT EXISTS cable_families (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cable_pricing_rules (
        supplier TEXT PRIMARY KEY,
        primary_multiplier REAL NOT NULL,
        additional_multiplier REAL NOT NULL,
        roll_markup REAL NOT NULL,
        meter_markup REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cable_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id INTEGER NOT NULL,
        supplier TEXT NOT NULL,
        source_code TEXT NOT NULL,
        size TEXT NOT NULL,
        variant TEXT,
        list_price REAL NOT NULL,
        pricing_unit TEXT NOT NULL DEFAULT 'roll' CHECK (pricing_unit IN ('roll', 'meter', 'unknown')),
        roll_length_meters REAL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (family_id) REFERENCES cable_families(id),
        FOREIGN KEY (supplier) REFERENCES cable_pricing_rules(supplier)
    );

    CREATE TABLE IF NOT EXISTS meter_item_families (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meter_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        cost_per_meter REAL NOT NULL CHECK (cost_per_meter >= 0),
        selling_price_per_meter REAL NOT NULL CHECK (selling_price_per_meter >= 0),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (family_id) REFERENCES meter_item_families(id) ON DELETE RESTRICT,
        UNIQUE (family_id, name)
    );
`);

const cableEntryColumns = db.prepare('PRAGMA table_info(cable_entries)').all();
if (!cableEntryColumns.some(column => column.name === 'pricing_unit') || cableEntryColumns.find(column => column.name === 'roll_length_meters')?.notnull) {
    db.exec(`
        ALTER TABLE cable_entries RENAME TO cable_entries_v1;
        CREATE TABLE cable_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            supplier TEXT NOT NULL,
            source_code TEXT NOT NULL,
            size TEXT NOT NULL,
            variant TEXT,
            list_price REAL NOT NULL,
            pricing_unit TEXT NOT NULL DEFAULT 'roll' CHECK (pricing_unit IN ('roll', 'meter', 'unknown')),
            roll_length_meters REAL,
            sort_order INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (family_id) REFERENCES cable_families(id),
            FOREIGN KEY (supplier) REFERENCES cable_pricing_rules(supplier)
        );
        INSERT INTO cable_entries (id, family_id, supplier, source_code, size, variant, list_price,
            pricing_unit, roll_length_meters, sort_order, created_at, updated_at)
        SELECT id, family_id, supplier, source_code, size, variant, list_price,
            'roll', roll_length_meters, sort_order, created_at, updated_at
        FROM cable_entries_v1;
        DROP TABLE cable_entries_v1;
    `);
}

// Forward-compatible stock metadata. Existing databases are migrated in place.
const stockColumns = new Set(db.prepare('PRAGMA table_info(stock_movements)').all().map(column => column.name));
if (!stockColumns.has('notes')) db.exec('ALTER TABLE stock_movements ADD COLUMN notes TEXT');
if (!stockColumns.has('idempotency_key')) db.exec('ALTER TABLE stock_movements ADD COLUMN idempotency_key TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_idempotency ON stock_movements(idempotency_key) WHERE idempotency_key IS NOT NULL');
// Sale lines can snapshot either a normal product or a cable without depending on future prices.
const saleItemColumns = new Set(db.prepare('PRAGMA table_info(sale_items)').all().map(column => column.name));
if (!saleItemColumns.has('source_type')) db.exec("ALTER TABLE sale_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'product'");
if (!saleItemColumns.has('source_id')) db.exec('ALTER TABLE sale_items ADD COLUMN source_id INTEGER');
if (!saleItemColumns.has('sale_unit')) db.exec("ALTER TABLE sale_items ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'piece'");
if (!saleItemColumns.has('cable_family_snapshot')) db.exec('ALTER TABLE sale_items ADD COLUMN cable_family_snapshot TEXT');
if (!saleItemColumns.has('cable_supplier_snapshot')) db.exec('ALTER TABLE sale_items ADD COLUMN cable_supplier_snapshot TEXT');
if (!saleItemColumns.has('cable_size_snapshot')) db.exec('ALTER TABLE sale_items ADD COLUMN cable_size_snapshot TEXT');
if (!saleItemColumns.has('meter_family_snapshot')) db.exec('ALTER TABLE sale_items ADD COLUMN meter_family_snapshot TEXT');
if (!saleItemColumns.has('meter_product_snapshot')) db.exec('ALTER TABLE sale_items ADD COLUMN meter_product_snapshot TEXT');
if (!saleItemColumns.has('description_at_sale')) db.exec('ALTER TABLE sale_items ADD COLUMN description_at_sale TEXT');
if (!saleItemColumns.has('line_total')) db.exec('ALTER TABLE sale_items ADD COLUMN line_total REAL NOT NULL DEFAULT 0');
const saleColumns = new Set(db.prepare('PRAGMA table_info(sales)').all().map(column => column.name));
if (!saleColumns.has('amount_paid')) db.exec('ALTER TABLE sales ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0');
if (!saleColumns.has('remaining')) db.exec('ALTER TABLE sales ADD COLUMN remaining REAL NOT NULL DEFAULT 0');
if (!saleColumns.has('initial_amount_paid')) {
    db.exec('ALTER TABLE sales ADD COLUMN initial_amount_paid REAL NOT NULL DEFAULT 0');
    db.exec('UPDATE sales SET initial_amount_paid = amount_paid');
}
if (!saleColumns.has('debt_archived')) db.exec('ALTER TABLE sales ADD COLUMN debt_archived INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS order_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    client_id INTEGER,
    event_type TEXT NOT NULL,
    event_data TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_order_history_sale_date ON order_history(sale_id, created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_order_history_client_date ON order_history(client_id, created_at)');
db.exec(`CREATE TABLE IF NOT EXISTS client_payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL,
    sale_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    UNIQUE (payment_id, sale_id)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_client_allocations_sale ON client_payment_allocations(sale_id)');
db.exec(`CREATE TABLE IF NOT EXISTS client_account_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, sale_id INTEGER,
    event_type TEXT NOT NULL, event_data TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS ali_baba_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_date TEXT NOT NULL, total REAL NOT NULL DEFAULT 0,
    notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ali_baba_entry_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, source_type TEXT NOT NULL,
    source_id INTEGER, description_at_entry TEXT NOT NULL, unit TEXT NOT NULL, quantity REAL NOT NULL,
    cost_at_entry REAL NOT NULL, line_total REAL NOT NULL, from_stock INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(entry_id) REFERENCES ali_baba_entries(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ali_baba_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, amount REAL NOT NULL, payment_date TEXT NOT NULL,
    notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ali_entries_date ON ali_baba_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_ali_items_entry ON ali_baba_entry_items(entry_id);
CREATE INDEX IF NOT EXISTS idx_ali_payments_date ON ali_baba_payments(payment_date);`);
db.exec(`CREATE TABLE IF NOT EXISTS cash_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_date TEXT NOT NULL, description TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('expense','salary','personal_withdrawal','other_income')),
    direction TEXT NOT NULL CHECK(direction IN ('in','out')), amount REAL NOT NULL CHECK(amount > 0),
    notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions(transaction_date);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_payments_sale_type ON payments(sale_id, type, payment_date)");
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_client_date ON sales(client_id, sale_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_type_date ON payments(type, payment_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sale_items_source ON sale_items(source_type, source_id)');

// Purchase accounting migrations. The existing trader/payment model is retained; traders are suppliers in the UI.
const traderColumns = new Set(db.prepare('PRAGMA table_info(traders)').all().map(column => column.name));
if (!traderColumns.has('updated_at')) db.exec('ALTER TABLE traders ADD COLUMN updated_at TEXT');
db.exec('UPDATE traders SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)');

const purchaseInvoiceColumns = new Set(db.prepare('PRAGMA table_info(purchase_invoices)').all().map(column => column.name));
if (!purchaseInvoiceColumns.has('invoice_number')) db.exec('ALTER TABLE purchase_invoices ADD COLUMN invoice_number TEXT');
if (!purchaseInvoiceColumns.has('total')) db.exec('ALTER TABLE purchase_invoices ADD COLUMN total REAL NOT NULL DEFAULT 0');
if (!purchaseInvoiceColumns.has('payment_now')) db.exec('ALTER TABLE purchase_invoices ADD COLUMN payment_now REAL NOT NULL DEFAULT 0');
if (!purchaseInvoiceColumns.has('remaining')) db.exec('ALTER TABLE purchase_invoices ADD COLUMN remaining REAL NOT NULL DEFAULT 0');

const purchaseItemInfo = db.prepare('PRAGMA table_info(purchase_items)').all();
if (purchaseItemInfo.find(column => column.name === 'product_id')?.notnull || !purchaseItemInfo.some(column => column.name === 'source_type')) {
    db.exec(`
        ALTER TABLE purchase_items RENAME TO purchase_items_legacy;
        CREATE TABLE purchase_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_id INTEGER NOT NULL,
            product_id INTEGER,
            source_type TEXT NOT NULL CHECK (source_type IN ('product', 'cable', 'meter_item')),
            source_id INTEGER,
            description_at_purchase TEXT NOT NULL,
            quantity REAL NOT NULL CHECK (quantity > 0),
            purchase_unit TEXT NOT NULL,
            cost_price_at_purchase REAL NOT NULL CHECK (cost_price_at_purchase >= 0),
            line_total REAL NOT NULL CHECK (line_total >= 0),
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );
        INSERT INTO purchase_items (id, purchase_id, product_id, source_type, source_id,
            description_at_purchase, quantity, purchase_unit, cost_price_at_purchase, line_total, notes)
        SELECT pi.id, pi.purchase_id, pi.product_id, 'product', pi.product_id,
            COALESCE(p.name_en, 'Historical product'), pi.quantity, COALESCE(p.unit, 'piece'),
            pi.unit_cost, pi.quantity * pi.unit_cost, pi.notes
        FROM purchase_items_legacy pi LEFT JOIN products p ON p.id = pi.product_id;
        DROP TABLE purchase_items_legacy;
    `);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_invoices_trader_date ON purchase_invoices(trader_id, invoice_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(invoice_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id)');
db.exec(`CREATE TABLE IF NOT EXISTS purchase_payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL,
    purchase_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    UNIQUE (payment_id, purchase_id)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_allocations_invoice ON purchase_payment_allocations(purchase_id)');
db.exec(`CREATE TABLE IF NOT EXISTS nawa2is (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due_date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nawa2is_active ON nawa2is(completed, created_at);
CREATE INDEX IF NOT EXISTS idx_reminders_active_due ON reminders(completed, due_date);`);
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stock_tracking_enabled', '1')").run();
if (!db.prepare("SELECT 1 FROM app_settings WHERE key='stock_system_activated_v1'").get()) {
    db.transaction(() => {
        db.prepare("UPDATE app_settings SET value='1',updated_at=CURRENT_TIMESTAMP WHERE key='stock_tracking_enabled'").run();
        db.prepare("INSERT INTO app_settings(key,value) VALUES('stock_system_activated_v1','1')").run();
    })();
}
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stock_backend_active', '1')").run();
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('show_cost_price', '1')").run();
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('products_per_page', '50')").run();
db.prepare("DELETE FROM app_settings WHERE key = 'show_archived_products'").run();
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('cable_show_list_prices', '0')").run();
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('cable_last_price_update', '')").run();
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('meter_last_price_update', CURRENT_TIMESTAMP)").run();
db.prepare("UPDATE app_settings SET value = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE key = 'meter_last_price_update' AND value = ''").run();
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cable_entries_identity
    ON cable_entries(family_id, supplier, source_code, size, COALESCE(variant, ''))`);
require('./cable-seed')(db);
require('./meter-item-seed')(db);

console.log('Database ready:', dbPath);

module.exports = db;
