require('dotenv').config({ quiet: true });
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { DateTime } = require('luxon');
const db = require('./database');

const sessionDbPath = process.env.SESSION_DB_PATH
    ? path.resolve(process.env.SESSION_DB_PATH)
    : path.join(__dirname, 'database', 'sessions.sqlite');
fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });
const sessionDb = new Database(sessionDbPath);
sessionDb.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
    sid TEXT PRIMARY KEY,
    session_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);`);
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get()
    && sessionDb.prepare('SELECT COUNT(1) AS count FROM auth_sessions').get().count === 0) {
    const copySession = sessionDb.prepare('INSERT OR IGNORE INTO auth_sessions(sid,session_json,expires_at) VALUES(?,?,?)');
    sessionDb.transaction(rows => rows.forEach(row => copySession.run(row.sid, row.session_json, row.expires_at)))
        (db.prepare('SELECT sid,session_json,expires_at FROM auth_sessions').all());
}

class BetterSqliteSessionStore extends session.Store {
    constructor(database) {
        super();
        this.db = database;
        this.getStatement = database.prepare('SELECT session_json FROM auth_sessions WHERE sid = ? AND expires_at > ?');
        this.setStatement = database.prepare(`INSERT INTO auth_sessions (sid, session_json, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET session_json = excluded.session_json, expires_at = excluded.expires_at`);
        this.deleteStatement = database.prepare('DELETE FROM auth_sessions WHERE sid = ?');
        this.pruneStatement = database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?');
        this.pruneStatement.run(Date.now());
    }
    get(sid, callback) {
        try { const row = this.getStatement.get(sid, Date.now()); callback(null, row ? JSON.parse(row.session_json) : null); }
        catch (error) { callback(error); }
    }
    set(sid, value, callback = () => {}) {
        try {
            const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
            this.setStatement.run(sid, JSON.stringify(value), expires);
            callback(null);
        } catch (error) { callback(error); }
    }
    destroy(sid, callback = () => {}) {
        try { this.deleteStatement.run(sid); callback(null); }
        catch (error) { callback(error); }
    }
    touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_COOKIE = 'dakkak.sid';
const AUTH_TIME_ZONE = 'Asia/Beirut';
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters');
}
const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

// Allow the app to receive JSON data
app.use(express.json({ limit: '5mb' }));

const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY || '0', 10);
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : false);
app.use(session({
    name: SESSION_COOKIE,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    store: new BetterSqliteSessionStore(sessionDb),
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' }
}));

// Serve the files inside the public folder
app.use(express.static(path.join(__dirname, 'public')));

const beirutNow = () => DateTime.now().setZone(AUTH_TIME_ZONE);
const safeUser = user => ({ username: user.username, role: user.role });
function clearAuthCookie(res) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' });
}
function destroySession(req, res, done = () => {}) {
    if (!req.session) { clearAuthCookie(res); return done(); }
    req.session.destroy(() => { clearAuthCookie(res); done(); });
}
function authenticatedUser(req) {
    const auth = req.session?.auth;
    if (!auth) return null;
    const now = beirutNow();
    if (auth.loginDate !== now.toISODate() || now.toMillis() >= Number(auth.expiresAt || 0)) return null;
    const user = db.prepare('SELECT id, username, role, is_active, session_version FROM users WHERE id = ?').get(auth.userId);
    if (!user || !user.is_active || user.session_version !== auth.sessionVersion) return null;
    return user;
}
function requireAuth(req, res, next) {
    const user = authenticatedUser(req);
    if (!user) return destroySession(req, res, () => res.status(401).json({ error: 'Authentication required' }));
    req.user = user;
    next();
}
function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
    next();
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait a few minutes and try again.' } });

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const username = String(req.body.username || '').trim(), password = String(req.body.password || '');
        const user = db.prepare('SELECT id, username, password_hash, role, is_active, session_version FROM users WHERE username = ? COLLATE NOCASE').get(username);
        if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        const now = beirutNow(), midnight = now.plus({ days: 1 }).startOf('day');
        req.session.auth = { userId: user.id, loginDate: now.toISODate(), expiresAt: midnight.toMillis(), sessionVersion: user.session_version };
        req.session.cookie.expires = midnight.toJSDate();
        req.session.cookie.maxAge = Math.max(1, midnight.toMillis() - now.toMillis());
        req.session.save(error => {
            if (error) return res.status(500).json({ error: 'Unable to create login session' });
            res.json({ authenticated: true, ...safeUser(user), login_date: now.toISODate() });
        });
    } catch { res.status(500).json({ error: 'Unable to complete login' }); }
});

app.post('/api/auth/logout', (req, res) => destroySession(req, res, () => res.status(204).end()));
app.get('/api/auth/me', (req, res) => {
    const user = authenticatedUser(req);
    if (!user) return destroySession(req, res, () => res.status(401).json({ authenticated: false }));
    res.json({ authenticated: true, ...safeUser(user), login_date: req.session.auth.loginDate });
});
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || ''), newPassword = String(req.body.newPassword || ''), confirmPassword = String(req.body.confirmPassword || '');
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match.' });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.user.id);
    destroySession(req, res, () => res.json({ changed: true, loginRequired: true }));
});

app.get('/api/status', (req, res) => res.json({ ok: true, environment: NODE_ENV }));

app.use('/api', requireAuth);
app.use('/api/settings/reset-transactions', requireAdmin);

app.get('/api/cable-settings', (req, res) => {
    const value = db.prepare("SELECT value FROM app_settings WHERE key = 'cable_show_list_prices'").get()?.value;
    const lastPriceUpdate = db.prepare("SELECT value FROM app_settings WHERE key = 'cable_last_price_update'").get()?.value || null;
    res.json({ showListPrices: value === '1', lastPriceUpdate });
});

app.put('/api/cable-settings', (req, res) => {
    if (typeof req.body.showListPrices !== 'boolean') return res.status(400).json({ error: 'Show List Prices must be enabled or disabled' });
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('cable_show_list_prices', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
        .run(req.body.showListPrices ? '1' : '0');
    res.json({ showListPrices: req.body.showListPrices });
});

app.get('/api/cable-pricing-rules', (req, res) => {
    const rules = db.prepare(`SELECT supplier, primary_multiplier, additional_multiplier,
        roll_markup, meter_markup FROM cable_pricing_rules
        ORDER BY CASE supplier WHEN 'Liban Cables' THEN 1 WHEN 'MCC' THEN 2 ELSE 3 END`).all();
    res.json(rules.map(rule => ({
        ...rule,
        percentage: rule.supplier === 'Liban Cables'
            ? (1 - rule.primary_multiplier) * 100
            : (rule.primary_multiplier - 1) * 100
    })));
});

app.put('/api/cable-pricing-rules', (req, res) => {
    try {
        const libanDiscount = Number(req.body.libanDiscount);
        const mccAdjustment = Number(req.body.mccAdjustment);
        if (!Number.isFinite(libanDiscount) || libanDiscount < 0 || libanDiscount >= 100) {
            throw new Error('Liban discount must be between 0% and 99.99%');
        }
        if (!Number.isFinite(mccAdjustment) || mccAdjustment <= -100 || mccAdjustment > 1000) {
            throw new Error('MCC adjustment must be greater than -100% and no more than 1000%');
        }
        const update = db.prepare('UPDATE cable_pricing_rules SET primary_multiplier = ? WHERE supplier = ?');
        db.transaction(() => {
            if (!update.run(1 - libanDiscount / 100, 'Liban Cables').changes) throw new Error('Liban Cables pricing rule is missing');
            if (!update.run(1 + mccAdjustment / 100, 'MCC').changes) throw new Error('MCC pricing rule is missing');
        })();
        res.json({ libanDiscount, mccAdjustment });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/cables/batch-edit', (req, res) => {
    try {
        const libanDiscount = Number(req.body.libanDiscount);
        const mccAdjustment = Number(req.body.mccAdjustment);
        const prices = Array.isArray(req.body.prices) ? req.body.prices : [];
        if (!Number.isFinite(libanDiscount) || libanDiscount < 0 || libanDiscount >= 100) {
            throw new Error('Liban discount must be between 0% and 99.99%');
        }
        if (!Number.isFinite(mccAdjustment) || mccAdjustment <= -100 || mccAdjustment > 1000) {
            throw new Error('MCC adjustment must be greater than -100% and no more than 1000%');
        }
        const normalized = prices.map(item => {
            const id = Number(item.id);
            const listPriceText = String(item.listPrice ?? '').trim();
            const listPrice = Number(listPriceText);
            if (!Number.isInteger(id) || id < 1 || !listPriceText || !Number.isFinite(listPrice) || listPrice < 0) {
                throw new Error('Every List Price must be a valid non-negative number');
            }
            return { id, listPrice };
        });
        if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new Error('Duplicate cable entries were submitted');
        const updateRule = db.prepare('UPDATE cable_pricing_rules SET primary_multiplier = ? WHERE supplier = ?');
        const updatePrice = db.prepare('UPDATE cable_entries SET list_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        db.transaction(() => {
            if (!updateRule.run(1 - libanDiscount / 100, 'Liban Cables').changes) throw new Error('Liban Cables pricing rule is missing');
            if (!updateRule.run(1 + mccAdjustment / 100, 'MCC').changes) throw new Error('MCC pricing rule is missing');
            for (const item of normalized) {
                if (!updatePrice.run(item.listPrice, item.id).changes) throw new Error(`Cable entry ${item.id} was not found`);
            }
            db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES
                ('cable_last_price_update', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`).run();
        })();
        const lastPriceUpdate = db.prepare("SELECT value FROM app_settings WHERE key = 'cable_last_price_update'").get().value;
        res.json({ updated: normalized.length, libanDiscount, mccAdjustment, lastPriceUpdate });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/cables', (req, res) => {
    const search = String(req.query.search || '').trim();
    const like = `%${search}%`;
    const entries = db.prepare(`
        SELECT e.id, f.id AS family_id, f.name AS family_name, f.sort_order AS family_sort,
            e.supplier, e.source_code, e.size, e.variant, e.list_price, e.pricing_unit,
            e.roll_length_meters, e.sort_order,
            CASE WHEN e.pricing_unit = 'roll'
                THEN e.list_price * r.primary_multiplier * r.additional_multiplier END AS roll_cost,
            CASE WHEN e.pricing_unit = 'roll'
                THEN e.list_price * r.primary_multiplier * r.additional_multiplier + r.roll_markup END AS roll_price,
            CASE
                WHEN e.pricing_unit = 'roll' AND e.roll_length_meters > 0
                    THEN (e.list_price * r.primary_multiplier * r.additional_multiplier) / e.roll_length_meters
                WHEN e.pricing_unit = 'meter'
                    THEN e.list_price * r.primary_multiplier * r.additional_multiplier
            END AS meter_cost,
            CASE
                WHEN e.pricing_unit = 'roll' AND e.roll_length_meters > 0
                    THEN (e.list_price * r.primary_multiplier * r.additional_multiplier) / e.roll_length_meters + r.meter_markup
                WHEN e.pricing_unit = 'meter'
                    THEN e.list_price * r.primary_multiplier * r.additional_multiplier + r.meter_markup
            END AS meter_price
        FROM cable_entries e
        JOIN cable_families f ON f.id = e.family_id
        JOIN cable_pricing_rules r ON r.supplier = e.supplier
        WHERE (? = '' OR f.name LIKE ? OR e.size LIKE ? OR COALESCE(e.variant, '') LIKE ?
            OR e.supplier LIKE ? OR e.source_code LIKE ?)
        ORDER BY f.sort_order,
            CASE e.supplier WHEN 'Liban Cables' THEN 1 WHEN 'MCC' THEN 2 ELSE 3 END,
            e.sort_order
    `).all(search, like, like, like, like, like);
    res.json(entries);
});

app.put('/api/cables/:id', (req, res) => {
    try {
        const current = db.prepare('SELECT * FROM cable_entries WHERE id = ?').get(req.params.id);
        if (!current) return res.status(404).json({ error: 'Cable entry not found' });
        const size = String(req.body.size ?? current.size).trim();
        const sourceCode = String(req.body.sourceCode ?? current.source_code).trim();
        const listPriceText = String(req.body.listPrice ?? current.list_price).trim();
        const listPrice = Number(listPriceText);
        const pricingUnit = String(req.body.pricingUnit ?? current.pricing_unit);
        const lengthText = req.body.rollLengthMeters === undefined ? current.roll_length_meters : String(req.body.rollLengthMeters).trim();
        const rollLengthMeters = lengthText === '' || lengthText === null ? null : Number(lengthText);
        if (!size) throw new Error('Size is required');
        if (!sourceCode) throw new Error('Source code is required');
        if (!listPriceText || !Number.isFinite(listPrice) || listPrice < 0) throw new Error('List Price must be a valid non-negative number');
        if (!['roll', 'meter', 'unknown'].includes(pricingUnit)) throw new Error('Pricing unit is invalid');
        if (pricingUnit === 'roll' && (!Number.isFinite(rollLengthMeters) || rollLengthMeters <= 0)) throw new Error('Roll length must be greater than zero');
        const storedLength = pricingUnit === 'roll' ? rollLengthMeters : null;
        const result = db.prepare(`UPDATE cable_entries SET size = ?, source_code = ?, list_price = ?,
            pricing_unit = ?, roll_length_meters = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(size, sourceCode, listPrice, pricingUnit, storedLength, req.params.id);
        if (!result.changes) return res.status(404).json({ error: 'Cable entry not found' });
        res.json({ id: Number(req.params.id), size, sourceCode, listPrice, pricingUnit, rollLengthMeters: storedLength });
    } catch (error) {
        const message = error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That cable size already exists in this supplier family' : error.message;
        res.status(400).json({ error: message });
    }
});

function meterText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error(`${label} is required`);
    return text;
}

function meterPrice(value, label) {
    const text = String(value ?? '').trim(), number = Number(text);
    if (!text || !Number.isFinite(number) || number < 0) throw new Error(`${label} must be a valid non-negative number`);
    return number;
}

app.get('/api/meter-items', (req, res) => {
    const families = db.prepare(`SELECT id, name, sort_order, created_at, updated_at
        FROM meter_item_families ORDER BY sort_order, id`).all();
    const items = db.prepare(`SELECT id, family_id, name, cost_per_meter, selling_price_per_meter,
        sort_order, created_at, updated_at FROM meter_items ORDER BY family_id, sort_order, id`).all();
    const grouped = new Map(families.map(family => [family.id, { ...family, items: [] }]));
    items.forEach(item => grouped.get(item.family_id)?.items.push(item));
    res.json([...grouped.values()]);
});

app.get('/api/meter-items/meta', (req, res) => {
    const lastPriceUpdate = db.prepare("SELECT value FROM app_settings WHERE key = 'meter_last_price_update'").get()?.value || null;
    res.json({ lastPriceUpdate });
});

app.post('/api/meter-item-families', (req, res) => {
    try {
        const name = meterText(req.body.name, 'Family Name');
        const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM meter_item_families').get().next;
        const result = db.prepare('INSERT INTO meter_item_families (name, sort_order) VALUES (?, ?)').run(name, sortOrder);
        res.status(201).json({ id: Number(result.lastInsertRowid), name, sort_order: sortOrder, items: [] });
    } catch (error) {
        res.status(400).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'A family with that name already exists' : error.message });
    }
});

app.post('/api/meter-item-families/:familyId/items', (req, res) => {
    try {
        const familyId = Number(req.params.familyId), name = meterText(req.body.name, 'Product Name');
        const cost = meterPrice(req.body.costPerMeter, 'Cost / 1m'), price = meterPrice(req.body.sellingPricePerMeter, 'Price / 1m');
        if (!db.prepare('SELECT 1 FROM meter_item_families WHERE id = ?').get(familyId)) return res.status(404).json({ error: 'Family not found' });
        const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM meter_items WHERE family_id = ?').get(familyId).next;
        const result = db.transaction(() => {
            const inserted = db.prepare(`INSERT INTO meter_items (family_id, name, cost_per_meter, selling_price_per_meter, sort_order)
                VALUES (?, ?, ?, ?, ?)`).run(familyId, name, cost, price, sortOrder);
            db.prepare("UPDATE app_settings SET value = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE key = 'meter_last_price_update'").run();
            return inserted;
        })();
        res.status(201).json({ id: Number(result.lastInsertRowid), family_id: familyId, name, cost_per_meter: cost, selling_price_per_meter: price, sort_order: sortOrder });
    } catch (error) {
        res.status(400).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That product already exists in this family' : error.message });
    }
});

app.put('/api/meter-items/batch', (req, res) => {
    try {
        const families = Array.isArray(req.body.families) ? req.body.families : [];
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        const familyIds = new Set(), itemIds = new Set();
        const cleanFamilies = families.map(family => {
            const id = Number(family.id); if (!Number.isInteger(id) || familyIds.has(id)) throw new Error('Invalid or duplicate family');
            familyIds.add(id); return { id, name: meterText(family.name, 'Family Name') };
        });
        const cleanItems = items.map(item => {
            const id = Number(item.id); if (!Number.isInteger(id) || itemIds.has(id)) throw new Error('Invalid or duplicate product');
            itemIds.add(id); return { id, name: meterText(item.name, 'Product Name'), cost: meterPrice(item.costPerMeter, 'Cost / 1m'), price: meterPrice(item.sellingPricePerMeter, 'Price / 1m') };
        });
        const updateFamily = db.prepare('UPDATE meter_item_families SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const updateItem = db.prepare(`UPDATE meter_items SET name = ?, cost_per_meter = ?, selling_price_per_meter = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        const priceChanged = cleanItems.some(item => {
            const current = db.prepare('SELECT cost_per_meter, selling_price_per_meter FROM meter_items WHERE id = ?').get(item.id);
            return current && (Number(current.cost_per_meter) !== item.cost || Number(current.selling_price_per_meter) !== item.price);
        });
        db.transaction(() => {
            cleanFamilies.forEach(family => { if (!updateFamily.run(family.name, family.id).changes) throw new Error('A family no longer exists'); });
            cleanItems.forEach(item => { if (!updateItem.run(item.name, item.cost, item.price, item.id).changes) throw new Error('A product no longer exists'); });
            if (priceChanged) db.prepare("UPDATE app_settings SET value = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE key = 'meter_last_price_update'").run();
        })();
        const lastPriceUpdate = db.prepare("SELECT value FROM app_settings WHERE key = 'meter_last_price_update'").get()?.value || null;
        res.json({ updated: cleanFamilies.length + cleanItems.length, priceChanged, lastPriceUpdate });
    } catch (error) {
        res.status(400).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Family and product names must be unique in their table' : error.message });
    }
});

app.delete('/api/meter-items/:id', (req, res) => {
    const result = db.prepare('DELETE FROM meter_items WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Product not found' });
    res.status(204).end();
});

app.delete('/api/meter-item-families/:id', (req, res) => {
    const family = db.prepare(`SELECT f.id, COUNT(i.id) AS item_count FROM meter_item_families f
        LEFT JOIN meter_items i ON i.family_id = f.id WHERE f.id = ? GROUP BY f.id`).get(req.params.id);
    if (!family) return res.status(404).json({ error: 'Family not found' });
    if (family.item_count) return res.status(409).json({ error: 'Delete all products in this family before deleting the family' });
    db.prepare('DELETE FROM meter_item_families WHERE id = ?').run(family.id);
    res.status(204).end();
});

// Product search
app.get('/api/products', (req, res) => {
    const search = req.query.search || '';
    const status = req.query.status || 'active';
    const category = req.query.category || '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const page = Math.max(Math.floor(Number(req.query.page) || 1), 1);
    const offset = (page - 1) * limit;

    const products = db.prepare(`
        SELECT p.id, p.name_en, p.name_ar, p.category, p.unit, p.cost_price, p.selling_price,
               p.is_cable, p.archived, p.created_at,
               CASE WHEN COALESCE((SELECT sm.reference_type FROM stock_movements sm WHERE sm.product_id = p.id ORDER BY sm.id DESC LIMIT 1), 'stock_reset') <> 'stock_reset' THEN 1 ELSE 0 END AS stock_counted,
               CASE WHEN COALESCE((SELECT sm.reference_type FROM stock_movements sm WHERE sm.product_id = p.id ORDER BY sm.id DESC LIMIT 1), 'stock_reset') <> 'stock_reset'
                    THEN (SELECT COALESCE(SUM(sm.quantity_change), 0) FROM stock_movements sm WHERE sm.product_id = p.id)
                    ELSE NULL END AS current_stock,
               (SELECT sm.created_at FROM stock_movements sm WHERE sm.product_id=p.id AND sm.reference_type IN ('stock_count','stock_count_session') ORDER BY sm.id DESC LIMIT 1) AS stock_counted_at
        FROM products p
        WHERE (name_en LIKE ? OR COALESCE(name_ar, '') LIKE ?)
        AND (? = '' OR COALESCE(category, '') = ?)
        AND (? = 'all' OR archived = CASE WHEN ? = 'archived' THEN 1 ELSE 0 END)
        ORDER BY name_en
        LIMIT ? OFFSET ?
    `).all(`%${search}%`, `%${search}%`, category, category, status, status, limit, offset);

    res.json(products);
});

app.get('/api/products/meta', (req, res) => {
    const includeArchived = req.query.status === 'all';
    const result = db.prepare(`
        SELECT COUNT(*) AS total
        FROM products
        WHERE (? = 1 OR archived = 0)
    `).get(includeArchived ? 1 : 0);

    res.json(result);
});

app.get('/api/product-settings', (req, res) => {
    const values = Object.fromEntries(db.prepare('SELECT key, value FROM app_settings').all().map(row => [row.key, row.value]));
    res.json({
        stockTrackingEnabled: values.stock_tracking_enabled === '1',
        showCostPrice: values.show_cost_price !== '0',
        productsPerPage: [30, 50, 100].includes(Number(values.products_per_page)) ? Number(values.products_per_page) : 50
    });
});

app.put('/api/product-settings', (req, res) => {
    const current = Object.fromEntries(db.prepare('SELECT key, value FROM app_settings').all().map(row => [row.key, row.value]));
    const settings = {
        stockTrackingEnabled: req.body.stockTrackingEnabled ?? current.stock_tracking_enabled === '1',
        showCostPrice: req.body.showCostPrice ?? current.show_cost_price !== '0',
        productsPerPage: Number(req.body.productsPerPage ?? current.products_per_page)
    };
    if (typeof settings.stockTrackingEnabled !== 'boolean' || typeof settings.showCostPrice !== 'boolean' ||
        ![30, 50, 100].includes(settings.productsPerPage)) {
        return res.status(400).json({ error: 'Invalid product settings' });
    }
    const save = db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
    db.transaction(() => {
        save.run('stock_tracking_enabled', settings.stockTrackingEnabled ? '1' : '0');
        save.run('show_cost_price', settings.showCostPrice ? '1' : '0');
        save.run('products_per_page', String(settings.productsPerPage));
    })();
    res.json(settings);
});

function recordStockMovement({ productId, quantityChange, reason, referenceType = null, referenceId = null, notes = null, idempotencyKey = null }) {
    const statement = idempotencyKey ? 'INSERT OR IGNORE' : 'INSERT';
    return db.prepare(`${statement} INTO stock_movements
        (product_id, movement_date, quantity_change, reason, reference_type, reference_id, notes, idempotency_key)
        VALUES (?, date('now'), ?, ?, ?, ?, ?, ?)`)
        .run(productId, quantityChange, reason, referenceType, referenceId, notes, idempotencyKey);
}

function stockBaseline(productId) {
    const baseline=db.prepare(`SELECT id,reference_type,created_at FROM stock_movements WHERE product_id=?
        AND reference_type IN ('stock_count','stock_count_session','stock_reset') ORDER BY id DESC LIMIT 1`).get(productId);
    return baseline&&baseline.reference_type!=='stock_reset'?baseline:null;
}
function syncReferenceStock({referenceType,referenceId,createdAt,desired,reason,forceCurrent=false}) {
    const productIds=new Set([...desired.keys(),...db.prepare('SELECT DISTINCT product_id FROM stock_movements WHERE reference_type=? AND reference_id=?').all(referenceType,referenceId).map(x=>x.product_id)]);
    for(const productId of productIds){
        const baseline=stockBaseline(productId);if(!baseline)continue;
        const movement=db.prepare('SELECT COUNT(*) count,COALESCE(SUM(quantity_change),0) amount FROM stock_movements WHERE product_id=? AND reference_type=? AND reference_id=? AND id>?').get(productId,referenceType,referenceId,baseline.id),existing=Number(movement.amount);
        const transactionAfterBaseline=Number(db.prepare('SELECT julianday(?)>julianday(?) ok').get(createdAt,baseline.created_at).ok)===1;
        const target=(forceCurrent||movement.count||transactionAfterBaseline)?Number(desired.get(productId)||0):0,change=accountingMoney(target-existing);
        if(Math.abs(change)>.000001)recordStockMovement({productId,quantityChange:change,reason,referenceType,referenceId,notes:`Baseline movement: ${existing}; new movement: ${target}`});
    }
}
function syncSaleStock(saleId,deleted=false,forceCurrent=false){const sale=db.prepare('SELECT created_at FROM sales WHERE id=?').get(saleId);if(!sale)return;const desired=new Map();if(!deleted)for(const row of db.prepare("SELECT product_id,SUM(quantity) quantity FROM sale_items WHERE sale_id=? AND source_type='product' AND product_id IS NOT NULL GROUP BY product_id").all(saleId))desired.set(row.product_id,-Number(row.quantity));syncReferenceStock({referenceType:'pos_sale',referenceId:saleId,createdAt:sale.created_at,desired,reason:deleted?'POS order deleted':'POS sale',forceCurrent})}
function syncPurchaseStock(purchaseId,deleted=false,forceCurrent=false){const purchase=db.prepare('SELECT created_at FROM purchase_invoices WHERE id=?').get(purchaseId);if(!purchase)return;const desired=new Map();if(!deleted)for(const row of db.prepare("SELECT product_id,SUM(quantity) quantity FROM purchase_items WHERE purchase_id=? AND source_type='product' AND product_id IS NOT NULL GROUP BY product_id").all(purchaseId))desired.set(row.product_id,Number(row.quantity));syncReferenceStock({referenceType:'supplier_purchase',referenceId:purchaseId,createdAt:purchase.created_at,desired,reason:deleted?'Purchase invoice deleted':'Supplier purchase',forceCurrent})}
function syncAliStock(entryId,deleted=false,forceCurrent=false){const entry=db.prepare('SELECT created_at FROM ali_baba_entries WHERE id=?').get(entryId);if(!entry)return;const desired=new Map();if(!deleted)for(const row of db.prepare("SELECT source_id product_id,SUM(quantity) quantity FROM ali_baba_entry_items WHERE entry_id=? AND source_type='product' AND from_stock=1 AND source_id IS NOT NULL GROUP BY source_id").all(entryId))desired.set(row.product_id,-Number(row.quantity));syncReferenceStock({referenceType:'ali_baba_stock',referenceId:entryId,createdAt:entry.created_at,desired,reason:deleted?'Ali Baba entry deleted':'Ali Baba from stock',forceCurrent})}

function resetStockCount(productId) {
    const latest = db.prepare('SELECT reference_type FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
    if (!latest || latest.reference_type === 'stock_reset') return false;
    const current = db.prepare('SELECT COALESCE(SUM(quantity_change), 0) AS quantity FROM stock_movements WHERE product_id = ?').get(productId).quantity;
    recordStockMovement({ productId, quantityChange: -current, reason: 'Reset count', referenceType: 'stock_reset' });
    return true;
}

function setStockQuantity(productId, quantity) {
    const latest = db.prepare('SELECT reference_type FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
    const counted = Boolean(latest && latest.reference_type !== 'stock_reset');
    const current = db.prepare('SELECT COALESCE(SUM(quantity_change), 0) AS quantity FROM stock_movements WHERE product_id = ?').get(productId).quantity;
    const change = quantity - current;
    recordStockMovement({ productId, quantityChange: change, reason: counted ? 'Physical count' : 'Opening stock', referenceType: 'stock_count',notes:`Old system stock: ${current}; new physical stock: ${quantity}` });
    return { currentStock: quantity, change, stockCounted: true };
}

app.post('/api/products/stock-reset', (req, res) => {
    try {
        if (!Array.isArray(req.body.productIds) || !req.body.productIds.length) throw new Error('Select at least one counted product');
        const ids = [...new Set(req.body.productIds.map(Number))];
        if (ids.some(id => !Number.isInteger(id))) throw new Error('Invalid product selection');
        const reset = db.transaction(() => ids.reduce((total, id) => {
            if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND archived = 0').get(id)) throw new Error('A selected product no longer exists');
            return total + (resetStockCount(id) ? 1 : 0);
        }, 0))();
        res.json({ reset });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/products/stock-count', (req, res) => {
    try {
        if (!Array.isArray(req.body.counts) || !req.body.counts.length) throw new Error('Enter at least one counted quantity');
        const ids = new Set();
        const counts = req.body.counts.map(item => {
            const productId = Number(item.productId), text = String(item.quantity ?? '').trim(), quantity = Number(text);
            if (!Number.isInteger(productId) || ids.has(productId)) throw new Error('Invalid or duplicate product in count');
            if (!text || !Number.isFinite(quantity) || quantity < 0) throw new Error('Every counted quantity must be a valid non-negative number');
            if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND archived = 0').get(productId)) throw new Error('A counted product no longer exists');
            ids.add(productId);
            return { productId, quantity };
        });
        const result = db.transaction(() => counts.map(item => {
            const current = db.prepare(`SELECT COUNT(*) AS movements, COALESCE(SUM(quantity_change), 0) AS quantity,
                (SELECT reference_type FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1) AS latest_type
                FROM stock_movements WHERE product_id = ?`).get(item.productId, item.productId);
            const change = item.quantity - current.quantity;
            recordStockMovement({ productId: item.productId, quantityChange: change, reason: current.movements && current.latest_type !== 'stock_reset' ? 'Physical count' : 'Opening stock', referenceType: 'stock_count_session',notes:`Old system stock: ${current.quantity}; new physical stock: ${item.quantity}` });
            return { productId: item.productId, currentStock: item.quantity, change };
        }))();
        res.json({ saved: result.length, products: result });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/products/:id/stock-count', (req, res) => {
    try {
        const product = db.prepare('SELECT id FROM products WHERE id = ? AND archived = 0').get(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const quantityText = String(req.body.quantity ?? '').trim();
        const quantity = Number(quantityText);
        if (!quantityText || !Number.isFinite(quantity) || quantity < 0) throw new Error('Counted quantity must be a valid non-negative number');
        const result = db.transaction(() => setStockQuantity(product.id, quantity))();
        res.json({ productId: product.id, ...result });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/products/:id/stock-reset', (req, res) => {
    try {
        const product = db.prepare('SELECT id FROM products WHERE id = ? AND archived = 0').get(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const changed = db.transaction(() => resetStockCount(product.id))();
        res.json({ productId: product.id, stockCounted: false, changed });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/products/:id/stock-history', (req, res) => {
    res.json(db.prepare(`SELECT id, movement_date, quantity_change, reason, reference_type, reference_id, notes, created_at
        FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 100`).all(req.params.id));
});

function validateImportRows(rows) {
    if (!Array.isArray(rows)) throw new Error('Import rows are required');
    if (rows.length > 50000) throw new Error('CSV is too large (maximum 50,000 rows)');
    const existingNames = new Set(db.prepare('SELECT name_en FROM products').all().map(p => p.name_en));
    const seenNames = new Set();
    return rows.map((row, index) => {
        const name = String(row?.name ?? '').trim();
        const costText = String(row?.cost ?? '').trim();
        const sellingText = String(row?.selling ?? '').trim();
        const cost = Number(costText), selling = Number(sellingText), errors = [];
        if (!name) errors.push('Product Name is empty');
        if (!costText || !Number.isFinite(cost) || cost < 0) errors.push('Cost Price is not a valid number');
        if (!sellingText || !Number.isFinite(selling) || selling < 0) errors.push('Selling Price is not a valid number');
        const duplicate = !errors.length && (existingNames.has(name) || seenNames.has(name));
        if (!errors.length) seenNames.add(name);
        return { row: index + 2, name, cost, selling, errors, duplicate };
    });
}

app.post('/api/products/import/preview', csvUpload.single('file'), (req, res) => {
    try {
        if (!req.file) throw new Error('Choose a CSV file');
        if (path.extname(req.file.originalname).toLowerCase() !== '.csv') throw new Error('Only .csv files are supported');
        const records = parse(req.file.buffer, { bom: true, skip_empty_lines: true, relax_column_count: true });
        if (!records.length) throw new Error('The CSV file is empty');
        const headers = records[0].map(value => String(value).trim());
        const required = ['Product Name', 'Cost Price', 'Selling Price'];
        if (headers.length !== 3 || !required.every((header, index) => headers[index] === header)) {
            throw new Error(`CSV headers must be exactly: ${required.join(', ')}`);
        }
        const importRows = records.slice(1).map(row => ({ name: row[0] ?? '', cost: row[1] ?? '', selling: row[2] ?? '' }));
        const rows = validateImportRows(importRows);
        res.json({ total: rows.length,
            newCount: rows.filter(r => !r.errors.length && !r.duplicate).length,
            existingCount: rows.filter(r => !r.errors.length && r.duplicate).length,
            errorCount: rows.filter(r => r.errors.length).length,
            invalidRows: rows.filter(r => r.errors.length).slice(0, 20).map(r => ({ row: r.row, name: r.name, reason: r.errors.join('; ') })),
            previewRows: rows.slice(0, 5).map(r => ({ row: r.row, name: r.name, cost: importRows[r.row - 2].cost, selling: importRows[r.row - 2].selling, invalid: r.errors.length > 0 })),
            rows: importRows });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/products/import', (req, res) => {
    try {
        const mode = req.body.mode === 'update' ? 'update' : 'skip';
        const rows = validateImportRows(req.body.rows);
        const find = db.prepare('SELECT id FROM products WHERE name_en = ?');
        const insert = db.prepare('INSERT INTO products (name_en, cost_price, selling_price) VALUES (?, ?, ?)');
        const update = db.prepare('UPDATE products SET cost_price = ?, selling_price = ? WHERE id = ?');
        const result = db.transaction(() => {
            let added = 0, updated = 0, skipped = 0, failed = 0;
            const handled = new Set();
            for (const row of rows) {
                if (row.errors.length) { failed++; continue; }
                if (handled.has(row.name)) { skipped++; continue; }
                handled.add(row.name);
                const existing = find.get(row.name);
                if (existing) {
                    if (mode === 'update') { update.run(row.cost, row.selling, existing.id); updated++; }
                    else skipped++;
                } else { insert.run(row.name, row.cost, row.selling); added++; }
            }
            return { added, updated, skipped, failed };
        })();
        res.json(result);
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/products/:id', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
});

function productValues(body) {
    const name = String(body.name_en || '').trim();
    if (!name) throw new Error('Product name is required');
    const cost = Number(body.cost_price || 0);
    const selling = Number(body.selling_price || 0);
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(selling) || selling < 0) {
        throw new Error('Prices must be valid positive numbers');
    }
    return {
        name_en: name,
        name_ar: String(body.name_ar || '').trim() || null,
        category: String(body.category || '').trim() || null,
        unit: String(body.unit || 'piece').trim() || 'piece',
        cost_price: cost,
        selling_price: selling,
        is_cable: body.is_cable ? 1 : 0,
        archived: 0
    };
}

app.post('/api/products', (req, res) => {
    try {
        const p = productValues(req.body);
        const result = db.prepare(`
            INSERT INTO products (name_en, name_ar, category, unit, cost_price, selling_price, is_cable, archived)
            VALUES (@name_en, @name_ar, @category, @unit, @cost_price, @selling_price, @is_cable, @archived)
        `).run(p);
        res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/products/:id', (req, res) => {
    try {
        if (!db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id)) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const p = { ...productValues(req.body), id: req.params.id };
        const stockProvided = Object.prototype.hasOwnProperty.call(req.body, 'stock_quantity');
        const stockText = stockProvided ? String(req.body.stock_quantity ?? '').trim() : '';
        const stockQuantity = Number(stockText);
        if (stockText && (!Number.isFinite(stockQuantity) || stockQuantity < 0)) throw new Error('Stock must be a valid non-negative number');
        db.transaction(() => {
            db.prepare(`
                UPDATE products SET name_en = @name_en, name_ar = @name_ar, category = @category,
                    unit = @unit, cost_price = @cost_price, selling_price = @selling_price,
                    is_cable = @is_cable, archived = 0 WHERE id = @id
            `).run(p);
            if (stockProvided) {
                if (stockText) setStockQuantity(Number(req.params.id), stockQuantity);
                else resetStockCount(Number(req.params.id));
            }
        })();
        res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/products/:id', (req, res) => {
    try {
        const product = db.prepare('SELECT id FROM products WHERE id = ? AND archived = 0').get(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const references = db.prepare(`SELECT
            EXISTS(SELECT 1 FROM sale_items WHERE product_id = ?) OR
            EXISTS(SELECT 1 FROM purchase_items WHERE product_id = ?) OR
            EXISTS(SELECT 1 FROM stock_movements WHERE product_id = ?) AS has_history`).get(product.id, product.id, product.id);
        const removal = db.transaction(() => {
            if (references.has_history) {
                db.prepare('UPDATE products SET archived = 1 WHERE id = ?').run(product.id);
                return 'removed';
            }
            db.prepare('DELETE FROM cable_details WHERE product_id = ?').run(product.id);
            db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
            return 'deleted';
        })();
        res.json({ removal });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

const accountingMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const currencyCents = value => Math.round((Number(value) + Number.EPSILON) * 100);
function rebuildSupplierAllocations(supplierId) {
    const invoices = db.prepare('SELECT id, total, payment_now FROM purchase_invoices WHERE trader_id=? ORDER BY invoice_date, created_at, id').all(supplierId);
    const payments = db.prepare("SELECT id, amount FROM payments WHERE trader_id=? AND type='supplier_payment' ORDER BY payment_date, created_at, id").all(supplierId);
    db.prepare(`DELETE FROM purchase_payment_allocations WHERE payment_id IN
        (SELECT id FROM payments WHERE trader_id=? AND type='supplier_payment')`).run(supplierId);
    const available = new Map(invoices.map(invoice => [invoice.id, accountingMoney(Math.max(0, Number(invoice.total)-Number(invoice.payment_now)))]));
    const insert = db.prepare('INSERT INTO purchase_payment_allocations (payment_id,purchase_id,amount) VALUES (?,?,?)');
    for (const payment of payments) {
        let left=accountingMoney(payment.amount);
        for (const invoice of invoices) {const room=available.get(invoice.id);if(left<=0||room<=0)continue;const used=accountingMoney(Math.min(left,room));insert.run(payment.id,invoice.id,used);available.set(invoice.id,accountingMoney(room-used));left=accountingMoney(left-used)}
        if(left>0.000001)throw new Error(`Supplier payments exceed outstanding invoices by $${left.toFixed(2)}.`);
    }
    for(const invoice of invoices){const allocated=Number(db.prepare('SELECT COALESCE(SUM(amount),0) total FROM purchase_payment_allocations WHERE purchase_id=?').get(invoice.id).total),paid=accountingMoney(Number(invoice.payment_now)+allocated),remaining=accountingMoney(Math.max(0,Number(invoice.total)-paid));db.prepare('UPDATE purchase_invoices SET remaining=?,status=? WHERE id=?').run(remaining,purchaseStatus(invoice.total,paid),invoice.id)}
}
function rebuildClientAllocations(clientId) {
    const orders=db.prepare('SELECT id,final_total,initial_amount_paid FROM sales WHERE client_id=? ORDER BY sale_date,created_at,id').all(clientId);
    const payments=db.prepare("SELECT id,sale_id,amount FROM payments WHERE client_id=? AND type='sale_payment' ORDER BY payment_date,created_at,id").all(clientId);
    db.prepare(`DELETE FROM client_payment_allocations WHERE payment_id IN
        (SELECT id FROM payments WHERE client_id=? AND type='sale_payment')`).run(clientId);
    const available=new Map(orders.map(order=>[order.id,accountingMoney(Math.max(0,Number(order.final_total)-Number(order.initial_amount_paid)))])),insert=db.prepare('INSERT INTO client_payment_allocations (payment_id,sale_id,amount) VALUES (?,?,?)');
    for(const payment of payments){let left=accountingMoney(payment.amount),targets=payment.sale_id?[orders.find(order=>order.id===payment.sale_id),...orders.filter(order=>order.id!==payment.sale_id)].filter(Boolean):orders;for(const order of targets){const room=available.get(order.id);if(left<=0||room<=0)continue;const used=accountingMoney(Math.min(left,room));insert.run(payment.id,order.id,used);available.set(order.id,accountingMoney(room-used));left=accountingMoney(left-used)}if(left>0.000001)throw new Error(`Client payments exceed outstanding orders by $${left.toFixed(2)}.`)}
    for(const order of orders){const allocated=Number(db.prepare('SELECT COALESCE(SUM(amount),0) total FROM client_payment_allocations WHERE sale_id=?').get(order.id).total),paid=accountingMoney(Number(order.initial_amount_paid)+allocated),remaining=accountingMoney(Math.max(0,Number(order.final_total)-paid)),status=remaining<.000001?'paid':paid>0?'partial':'unpaid';db.prepare('UPDATE sales SET amount_paid=?,remaining=?,status=? WHERE id=?').run(paid,remaining,status,order.id)}
}
db.transaction(()=>{for(const row of db.prepare('SELECT DISTINCT trader_id id FROM payments WHERE trader_id IS NOT NULL AND type=\'supplier_payment\'').all())rebuildSupplierAllocations(row.id);for(const row of db.prepare('SELECT DISTINCT client_id id FROM payments WHERE client_id IS NOT NULL AND type=\'sale_payment\'').all())rebuildClientAllocations(row.id)})();
function purchaseStatus(total, paid) {
    const remaining = Math.max(0, total - paid);
    return remaining < 0.000001 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
}

function getPurchaseTransactions() {
    return db.prepare(`SELECT id, type, date, supplier_id, supplier_name, amount FROM (
        SELECT pi.id, 'invoice' AS type, pi.invoice_date AS date, pi.trader_id AS supplier_id,
            t.name AS supplier_name, pi.total AS amount, pi.created_at
        FROM purchase_invoices pi JOIN traders t ON t.id = pi.trader_id
        UNION ALL
        SELECT p.id, 'payment', p.payment_date, p.trader_id, t.name, p.amount, p.created_at
        FROM payments p JOIN traders t ON t.id = p.trader_id
        WHERE p.type = 'supplier_payment'
        ) ORDER BY date DESC, created_at DESC, id DESC`).all();
}

app.get('/api/purchases/overview', (req, res) => {
    const summary = db.prepare(`SELECT
        (SELECT COUNT(*) FROM traders) AS total_suppliers,
        COALESCE((SELECT SUM(remaining) FROM purchase_invoices), 0) AS total_owed,
        COALESCE((SELECT SUM(total) FROM purchase_invoices
            WHERE strftime('%Y-%m', invoice_date) = strftime('%Y-%m', 'now', 'localtime')), 0) AS purchases_this_month`).get();
    const invoices = db.prepare(`SELECT pi.id, pi.trader_id AS supplier_id, t.name AS supplier_name,
        pi.invoice_date, pi.invoice_number, pi.total, pi.payment_now + COALESCE((SELECT SUM(a.amount) FROM purchase_payment_allocations a WHERE a.purchase_id=pi.id),0) AS paid, pi.remaining,
        COUNT(items.id) AS item_count
        FROM purchase_invoices pi JOIN traders t ON t.id = pi.trader_id
        LEFT JOIN purchase_items items ON items.purchase_id = pi.id
        GROUP BY pi.id ORDER BY pi.invoice_date DESC, pi.id DESC`).all().map(invoice => ({
            ...invoice, status: purchaseStatus(invoice.total, invoice.paid)
        }));
    const suppliers = db.prepare(`SELECT t.id, t.name, t.phone AS mobile, t.notes,
        COALESCE((SELECT SUM(pi.remaining) FROM purchase_invoices pi WHERE pi.trader_id = t.id), 0) AS balance,
        (SELECT MAX(pi.invoice_date) FROM purchase_invoices pi WHERE pi.trader_id = t.id) AS last_invoice,
        COALESCE((SELECT SUM(pi.total) FROM purchase_invoices pi WHERE pi.trader_id = t.id
            AND strftime('%Y', pi.invoice_date) = strftime('%Y', 'now', 'localtime')), 0) AS purchases_this_year
        FROM traders t ORDER BY t.name COLLATE NOCASE`).all();
    const transactions = getPurchaseTransactions();
    res.json({ summary, invoices, suppliers, transactions });
});

app.get('/api/purchases/transactions', (req, res) => {
    res.json(getPurchaseTransactions());
});

app.post('/api/suppliers', (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) throw new Error('Supplier Name is required');
        const mobile = String(req.body.mobile || '').trim() || null, notes = String(req.body.notes || '').trim() || null;
        const result = db.prepare('INSERT INTO traders (name, phone, notes, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(name, mobile, notes);
        res.status(201).json({ id: Number(result.lastInsertRowid), name, mobile, notes });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.put('/api/suppliers/:id', (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) throw new Error('Supplier Name is required');
        const result = db.prepare(`UPDATE traders SET name = ?, phone = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(name, String(req.body.mobile || '').trim() || null, String(req.body.notes || '').trim() || null, req.params.id);
        if (!result.changes) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ id: Number(req.params.id), name });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/suppliers/:id', (req, res) => {
    const supplier = db.prepare(`SELECT t.id, t.name, t.phone AS mobile, t.notes,
        COALESCE((SELECT SUM(pi.remaining) FROM purchase_invoices pi WHERE pi.trader_id = t.id), 0) AS balance,
        COALESCE((SELECT SUM(pi.total) FROM purchase_invoices pi WHERE pi.trader_id = t.id
            AND strftime('%Y', pi.invoice_date) = strftime('%Y', 'now', 'localtime')), 0) AS purchases_this_year
        FROM traders t WHERE t.id = ?`).get(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    const chronological = db.prepare(`SELECT activity_date, activity_type, details, amount, balance_effect, reference_id, created_at FROM (
        SELECT invoice_date AS activity_date, 'Invoice' AS activity_type, 'Purchase Invoice' AS details,
            total AS amount, total - payment_now AS balance_effect, id AS reference_id, created_at
        FROM purchase_invoices WHERE trader_id = ?
        UNION ALL
        SELECT payment_date, 'Payment', 'Supplier Payment' || CASE WHEN description IS NULL OR description = '' THEN '' ELSE ' · ' || description END,
            -amount, -amount, id, created_at FROM payments
        WHERE trader_id = ? AND type = 'supplier_payment'
        ) ORDER BY activity_date, created_at, reference_id`).all(req.params.id, req.params.id);
    let balance = 0;
    const activity = chronological.map(row => ({ ...row, balance: balance += Number(row.balance_effect) })).reverse();
    const payments=db.prepare("SELECT id,payment_date,amount,description AS notes,created_at FROM payments WHERE trader_id=? AND type='supplier_payment' ORDER BY payment_date DESC,created_at DESC,id DESC").all(supplier.id);
    res.json({ ...supplier, activity, payments });
});

app.post('/api/suppliers/:id/payments', (req, res) => {
    try {
        if (!db.prepare('SELECT 1 FROM traders WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Supplier not found' });
        const amountText = String(req.body.amount ?? '').trim(), amount = Number(amountText), date = String(req.body.date || '').trim();
        if (!amountText || !Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid payment date is required');
        const result = db.transaction(() => {
            const balance = db.prepare('SELECT COALESCE(SUM(remaining),0) balance FROM purchase_invoices WHERE trader_id=?').get(req.params.id).balance;
            if (amount - Number(balance) > 0.000001) {
                throw new Error(`Payment cannot exceed the outstanding balance of $${Number(balance).toFixed(2)}.`);
            }
            const inserted = db.prepare(`INSERT INTO payments
                (payment_date, amount, type, direction, category, trader_id, description)
                VALUES (?, ?, 'supplier_payment', 'out', 'supplier', ?, ?)`)
                .run(date, amount, req.params.id, String(req.body.notes || '').trim() || null);
            rebuildSupplierAllocations(Number(req.params.id));
            return inserted;
        })();
        res.status(201).json({ id: Number(result.lastInsertRowid), amount, date });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.delete('/api/supplier-payments/:id', (req, res) => {
    try {
        const payment = db.prepare("SELECT id, trader_id FROM payments WHERE id = ? AND type = 'supplier_payment'").get(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Supplier payment not found' });
        db.transaction(() => {
            db.prepare('DELETE FROM purchase_payment_allocations WHERE payment_id = ?').run(payment.id);
            db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
            rebuildSupplierAllocations(payment.trader_id);
        })();
        res.status(204).end();
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/purchases/catalog', (req, res) => {
    const products = db.prepare(`SELECT id, 'product' AS source_type, name_en AS description,
        COALESCE(unit, 'piece') AS purchase_unit, cost_price AS current_cost FROM products WHERE archived = 0 ORDER BY name_en`).all();
    const cables = db.prepare(`SELECT e.id, 'cable' AS source_type,
        f.name || ' · ' || e.supplier || ' · ' || e.size || CASE WHEN e.variant IS NULL THEN '' ELSE ' (' || e.variant || ')' END AS description,
        CASE WHEN e.pricing_unit = 'roll' THEN 'roll' ELSE 'meter' END AS purchase_unit,
        CASE WHEN e.pricing_unit = 'roll' THEN e.list_price * r.primary_multiplier * r.additional_multiplier
             ELSE e.list_price * r.primary_multiplier * r.additional_multiplier END AS current_cost
        FROM cable_entries e JOIN cable_families f ON f.id = e.family_id
        JOIN cable_pricing_rules r ON r.supplier = e.supplier ORDER BY f.sort_order, e.sort_order`).all();
    const meterItems = db.prepare(`SELECT mi.id, 'meter_item' AS source_type, mf.name || ' · ' || mi.name AS description,
        'meter' AS purchase_unit, mi.cost_per_meter AS current_cost
        FROM meter_items mi JOIN meter_item_families mf ON mf.id = mi.family_id
        ORDER BY mf.sort_order, mi.sort_order`).all();
    res.json({ products, cables, meterItems });
});

function normalizePurchase(body) {
    const supplierId = Number(body.supplierId), date = String(body.date || '').trim();
    if (!Number.isInteger(supplierId) || !db.prepare('SELECT 1 FROM traders WHERE id = ?').get(supplierId)) throw new Error('Select a valid supplier');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid invoice date is required');
    if (!Array.isArray(body.items) || !body.items.length) throw new Error('Add at least one invoice item');
    const items = body.items.map(line => {
        const sourceType = String(line.sourceType), sourceId = Number(line.sourceId), description = String(line.description || '').trim();
        const quantityText = String(line.quantity ?? '').trim(), costText = String(line.cost ?? '').trim(), quantity = Number(quantityText), cost = Number(costText);
        if (!['product', 'cable', 'meter_item'].includes(sourceType) || !Number.isInteger(sourceId) || !description) throw new Error('An invoice item is invalid');
        if (!quantityText || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Every quantity must be greater than zero');
        if (!costText || !Number.isFinite(cost) || cost < 0) throw new Error('Every cost must be a valid non-negative number');
        return { sourceType, sourceId, description, quantity, cost, unit: String(line.unit || 'piece'), lineTotal: quantity * cost };
    });
    const total = accountingMoney(items.reduce((sum, line) => sum + line.lineTotal, 0)), paymentText = String(body.paymentNow ?? '').trim(), paymentNow = accountingMoney(paymentText === '' ? 0 : Number(paymentText));
    if (!Number.isFinite(paymentNow) || currencyCents(paymentNow) < 0 || currencyCents(paymentNow) > currencyCents(total)) throw new Error('Payment Now must be between zero and the invoice total');
    return { supplierId, date, invoiceNumber: String(body.invoiceNumber || '').trim() || null, notes: String(body.notes || '').trim() || null,
        items, total, paymentNow, remaining: accountingMoney(Math.max(0, total - paymentNow)) };
}

function savePurchase(id, body) {
    const purchase = normalizePurchase(body), editing = id !== null;
    return db.transaction(() => {
        let purchaseId = id, previousSupplierId = null;
        if (editing) {
            const existing = db.prepare('SELECT trader_id FROM purchase_invoices WHERE id = ?').get(id);
            if (!existing) throw new Error('Purchase invoice not found');
            previousSupplierId = existing.trader_id;
            db.prepare(`UPDATE purchase_invoices SET trader_id=?, invoice_date=?, invoice_number=?, total=?, payment_now=?, remaining=?,
                status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(purchase.supplierId, purchase.date, purchase.invoiceNumber,
                purchase.total, purchase.paymentNow, purchase.remaining, purchaseStatus(purchase.total, purchase.paymentNow), purchase.notes, id);
            db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id);
        } else {
            purchaseId = Number(db.prepare(`INSERT INTO purchase_invoices
                (trader_id, invoice_date, invoice_number, status, notes, total, payment_now, remaining)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(purchase.supplierId, purchase.date, purchase.invoiceNumber,
                purchaseStatus(purchase.total, purchase.paymentNow), purchase.notes, purchase.total, purchase.paymentNow, purchase.remaining).lastInsertRowid);
        }
        const insert = db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, source_type, source_id,
            description_at_purchase, quantity, purchase_unit, cost_price_at_purchase, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        purchase.items.forEach(line => {
            insert.run(purchaseId, line.sourceType === 'product' ? line.sourceId : null, line.sourceType, line.sourceId,
                line.description, line.quantity, line.unit, line.cost, line.lineTotal);
        });
        syncPurchaseStock(purchaseId,false,!editing);
        rebuildSupplierAllocations(purchase.supplierId);
        if (previousSupplierId && previousSupplierId !== purchase.supplierId) rebuildSupplierAllocations(previousSupplierId);
        const saved = db.prepare('SELECT total, payment_now, remaining, status FROM purchase_invoices WHERE id = ?').get(purchaseId);
        return { id: purchaseId, total: saved.total, paymentNow: saved.payment_now, remaining: saved.remaining, status: saved.status };
    })();
}

app.post('/api/purchases', (req, res) => {
    try { res.status(201).json(savePurchase(null, req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.put('/api/purchases/:id', (req, res) => {
    try { res.json(savePurchase(Number(req.params.id), req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/purchases/:id', (req, res) => {
    try {
        const invoice = db.prepare('SELECT id,trader_id FROM purchase_invoices WHERE id = ?').get(req.params.id);
        if (!invoice) return res.status(404).json({ error: 'Purchase invoice not found' });
        db.transaction(() => {
            syncPurchaseStock(invoice.id, true);
            db.prepare('DELETE FROM purchase_payment_allocations WHERE purchase_id = ?').run(invoice.id);
            db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(invoice.id);
            db.prepare('DELETE FROM purchase_invoices WHERE id = ?').run(invoice.id);
            rebuildSupplierAllocations(invoice.trader_id);
        })();
        res.status(204).end();
    } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/purchases/:id', (req, res) => {
    const invoice = db.prepare(`SELECT pi.*, pi.trader_id AS supplier_id, t.name AS supplier_name
        FROM purchase_invoices pi JOIN traders t ON t.id = pi.trader_id WHERE pi.id = ?`).get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Purchase invoice not found' });
    invoice.items = db.prepare(`SELECT id, source_type, source_id, description_at_purchase AS description,
        quantity, purchase_unit AS unit, cost_price_at_purchase AS cost, line_total FROM purchase_items WHERE purchase_id = ? ORDER BY id`).all(invoice.id);
    invoice.status = purchaseStatus(invoice.total, invoice.total - invoice.remaining);
    invoice.paid = accountingMoney(invoice.total - invoice.remaining);
    res.json(invoice);
});

app.get('/api/pos/catalog', (req, res) => {
    const search = String(req.query.q || '').trim(), like = `%${search}%`;
    if (!search) return res.json([]);
    const products = db.prepare(`SELECT id, 'product' AS source_type, name_en AS description,
        COALESCE(unit, 'piece') AS unit, cost_price AS cost, selling_price AS price
        FROM products WHERE archived = 0 AND (name_en LIKE ? OR COALESCE(name_ar, '') LIKE ?)
        ORDER BY name_en COLLATE NOCASE LIMIT 25`).all(like, like);
    const cables = db.prepare(`SELECT e.id, 'cable' AS source_type,
        f.name || ' — ' || e.supplier || ' — ' || e.size || CASE WHEN e.variant IS NULL OR e.variant = '' THEN '' ELSE ' (' || e.variant || ')' END AS description,
        f.name AS family_name, e.supplier, e.size, e.variant, e.roll_length_meters,
        CASE WHEN e.pricing_unit = 'roll' THEN e.list_price * r.primary_multiplier * r.additional_multiplier END AS roll_cost,
        CASE WHEN e.pricing_unit = 'roll' THEN e.list_price * r.primary_multiplier * r.additional_multiplier + r.roll_markup END AS roll_price,
        CASE WHEN e.pricing_unit = 'roll' AND e.roll_length_meters > 0 THEN (e.list_price * r.primary_multiplier * r.additional_multiplier) / e.roll_length_meters
             WHEN e.pricing_unit = 'meter' THEN e.list_price * r.primary_multiplier * r.additional_multiplier END AS meter_cost,
        CASE WHEN e.pricing_unit = 'roll' AND e.roll_length_meters > 0 THEN (e.list_price * r.primary_multiplier * r.additional_multiplier) / e.roll_length_meters + r.meter_markup
             WHEN e.pricing_unit = 'meter' THEN e.list_price * r.primary_multiplier * r.additional_multiplier + r.meter_markup END AS meter_price
        FROM cable_entries e JOIN cable_families f ON f.id = e.family_id JOIN cable_pricing_rules r ON r.supplier = e.supplier
        WHERE f.name LIKE ? OR e.supplier LIKE ? OR e.size LIKE ? OR COALESCE(e.variant, '') LIKE ? OR e.source_code LIKE ?
        ORDER BY f.sort_order, e.sort_order LIMIT 25`).all(like, like, like, like, like);
    const meterItems = db.prepare(`SELECT i.id, 'meter_item' AS source_type, i.name AS description,
        f.name AS family_name, 'meter' AS unit, i.cost_per_meter AS cost, i.selling_price_per_meter AS price
        FROM meter_items i JOIN meter_item_families f ON f.id = i.family_id
        WHERE i.name LIKE ? OR f.name LIKE ? ORDER BY f.sort_order, i.sort_order LIMIT 40`).all(like, like);
    res.json([...products, ...cables, ...meterItems].slice(0, 75));
});

app.get('/api/pos/recent', (req, res) => {
    res.json(db.prepare(`SELECT si.source_type, si.source_id, si.description_at_sale AS description,
        COUNT(*) AS sale_count, MAX(s.created_at) AS last_sold
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.source_id IS NOT NULL AND si.source_type IN ('product', 'cable', 'meter_item')
        GROUP BY si.source_type, si.source_id ORDER BY last_sold DESC, sale_count DESC LIMIT 12`).all());
});

app.get('/api/pos/clients', (req, res) => {
    const search = String(req.query.q || '').trim(), like = `%${search}%`;
    res.json(db.prepare(`SELECT id, name, phone FROM clients
        WHERE (? = '' OR name LIKE ? OR COALESCE(phone, '') LIKE ?)
        ORDER BY name COLLATE NOCASE LIMIT 100`).all(search, like, like));
});

app.post('/api/pos/clients', (req, res) => {
    try {
        const name = String(req.body.name || '').trim(), phone = String(req.body.mobile || '').trim() || null;
        if (!name) throw new Error('Client name is required');
        const existing = db.prepare('SELECT id, name, phone FROM clients WHERE name = ? COLLATE NOCASE').get(name);
        if (existing) return res.json(existing);
        const result = db.prepare('INSERT INTO clients (name, phone) VALUES (?, ?)').run(name, phone);
        res.status(201).json({ id: Number(result.lastInsertRowid), name, phone });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

function resolveSaleLine(raw) {
    const sourceType = String(raw?.source_type || ''), sourceId = Number(raw?.source_id), quantity = Number(raw?.quantity), selling = Number(raw?.selling_price);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Every quantity must be greater than zero');
    if (!Number.isFinite(selling) || selling < 0) throw new Error('Every selling price must be non-negative');
    if (sourceType === 'product') {
        const item = db.prepare(`SELECT id, name_en AS description, COALESCE(unit, 'piece') AS unit, cost_price AS cost
            FROM products WHERE id = ? AND archived = 0`).get(sourceId);
        if (!item) throw new Error('A selected product is no longer available');
        return { sourceType, sourceId: item.id, productId: item.id, description: item.description, unit: item.unit, cost: Number(item.cost), selling, quantity };
    }
    if (sourceType === 'meter_item') {
        const item = db.prepare(`SELECT i.id, i.name, f.name AS family_name, i.cost_per_meter AS cost
            FROM meter_items i JOIN meter_item_families f ON f.id = i.family_id WHERE i.id = ?`).get(sourceId);
        if (!item) throw new Error('A selected meter item is no longer available');
        return { sourceType, sourceId: item.id, productId: null, description: `${item.family_name} — ${item.name}`, unit: 'meter', cost: Number(item.cost), selling, quantity, meterFamily: item.family_name, meterProduct: item.name };
    }
    if (sourceType === 'cable') {
        const unit = raw?.unit === 'roll' ? 'roll' : 'meter';
        if (unit === 'roll' && !Number.isInteger(quantity)) throw new Error('Cable roll quantity must be a whole number');
        const item = db.prepare(`SELECT e.id, f.name AS family_name, e.supplier, e.size, e.variant,
            CASE WHEN ? = 'roll' AND e.pricing_unit = 'roll' THEN e.list_price * r.primary_multiplier * r.additional_multiplier
                 WHEN ? = 'meter' AND e.pricing_unit = 'roll' AND e.roll_length_meters > 0 THEN (e.list_price * r.primary_multiplier * r.additional_multiplier) / e.roll_length_meters
                 WHEN ? = 'meter' AND e.pricing_unit = 'meter' THEN e.list_price * r.primary_multiplier * r.additional_multiplier END AS cost
            FROM cable_entries e JOIN cable_families f ON f.id = e.family_id JOIN cable_pricing_rules r ON r.supplier = e.supplier WHERE e.id = ?`).get(unit, unit, unit, sourceId);
        if (!item || item.cost === null) throw new Error(`That cable cannot be sold by ${unit}`);
        const size = item.size + (item.variant ? ` (${item.variant})` : '');
        return { sourceType, sourceId: item.id, productId: null, description: `${item.family_name} — ${item.supplier} — ${size}`, unit, cost: Number(item.cost), selling, quantity, cableFamily: item.family_name, cableSupplier: item.supplier, cableSize: size };
    }
    if (sourceType === 'custom') {
        const description = String(raw?.description || '').trim(), cost = Number(raw?.cost_price);
        if (!description) throw new Error('Custom item name is required');
        if (!Number.isFinite(cost) || cost < 0) throw new Error('Custom item cost must be non-negative');
        return { sourceType, sourceId: null, productId: null, description, unit: 'piece', cost, selling, quantity };
    }
    throw new Error('A sale item has an invalid source');
}

app.post('/api/pos/sales', (req, res) => {
    try {
        if (!Array.isArray(req.body.items) || !req.body.items.length) throw new Error('Add at least one item before completing the sale');
        if (req.body.items.length > 200) throw new Error('This sale has too many lines');
        const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
        const lines = req.body.items.map(resolveSaleLine), itemsTotal = roundMoney(lines.reduce((sum, line) => sum + line.quantity * line.selling, 0));
        const finalTotal = Number(req.body.final_total), amountPaid = Number(req.body.amount_paid), clientId = req.body.client_id === null || req.body.client_id === '' ? null : Number(req.body.client_id);
        if (!Number.isFinite(finalTotal) || finalTotal < 0) throw new Error('Final Total must be a valid non-negative amount');
        if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > finalTotal + 0.000001) throw new Error('Amount Paid must be between zero and Final Total');
        const remaining = roundMoney(Math.max(0, finalTotal - amountPaid)), adjustment = roundMoney(finalTotal - itemsTotal), status = remaining < 0.000001 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
        if (remaining > 0 && (!Number.isInteger(clientId) || !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId))) throw new Error('Select or create a client for a Partial or Unpaid sale');
        if (clientId !== null && (!Number.isInteger(clientId) || !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId))) throw new Error('Selected client was not found');
        const result = db.transaction(() => {
            const sale = db.prepare(`INSERT INTO sales (sale_date, client_id, status, items_total, adjustment_amount, final_total, amount_paid, initial_amount_paid, remaining, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(String(req.body.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.body.date : new Date().toISOString().slice(0, 10), clientId, status, itemsTotal, adjustment, finalTotal, amountPaid, amountPaid, remaining, String(req.body.notes || '').trim() || null);
            const insert = db.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, quantity, cost_price_at_sale,
                selling_price_at_sale, line_type, source_type, source_id, sale_unit, cable_family_snapshot, cable_supplier_snapshot,
                cable_size_snapshot, meter_family_snapshot, meter_product_snapshot, description_at_sale, line_total)
                VALUES (?, ?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const line of lines) insert.run(sale.lastInsertRowid, line.productId, line.description, line.quantity, line.cost,
                line.selling, line.sourceType, line.sourceId, line.unit, line.cableFamily || null, line.cableSupplier || null,
                line.cableSize || null, line.meterFamily || null, line.meterProduct || null, line.description, roundMoney(line.quantity * line.selling));
            syncSaleStock(Number(sale.lastInsertRowid),false,true);
            if (clientId) db.prepare(`INSERT INTO order_history (sale_id, client_id, event_type, event_data)
                VALUES (?, ?, 'order_created', ?)`).run(sale.lastInsertRowid, clientId, JSON.stringify({ total: finalTotal, paid: amountPaid, remaining, items: lines.map(line => ({ description: line.description, quantity: line.quantity, price: line.selling })) }));
            return Number(sale.lastInsertRowid);
        })();
        res.status(201).json({ id: result, status, items_total: itemsTotal, adjustment_amount: adjustment, final_total: finalTotal, amount_paid: amountPaid, remaining, client_id: clientId });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/pos/orders', (req, res) => {
    res.json(db.prepare(`SELECT s.id, date(s.created_at,'localtime') AS date, s.created_at, s.status, s.final_total AS total,
        s.client_id, COALESCE(c.name, 'Walk-in') AS customer_name, s.notes,
        (SELECT GROUP_CONCAT(preview.description, '|||') FROM
            (SELECT COALESCE(description_at_sale, product_name_snapshot, 'Historical item') AS description
             FROM sale_items WHERE sale_id = s.id ORDER BY id LIMIT 2) preview) AS item_preview,
        COUNT(si.id) AS line_count, COALESCE(SUM(si.quantity), 0) AS item_count
        FROM sales s LEFT JOIN clients c ON c.id = s.client_id
        LEFT JOIN sale_items si ON si.sale_id = s.id
        WHERE date(s.created_at,'localtime')=date('now','localtime')
        GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC LIMIT 200`).all());
});

app.get('/api/orders', (req,res)=>{try{
    const from=String(req.query.from||''),to=String(req.query.to||''),status=String(req.query.status||'').toLowerCase(),search=String(req.query.search||'').trim().replace(/^#/,'');
    const page=Math.max(1,Math.floor(Number(req.query.page)||1)),limit=Math.min(100,Math.max(20,Math.floor(Number(req.query.limit)||50))),offset=(page-1)*limit;
    if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))throw new Error('Invalid From date');
    if(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))throw new Error('Invalid To date');
    if(status&&!['paid','partial','unpaid'].includes(status))throw new Error('Invalid order status');
    if(search&&!/^\d+$/.test(search))return res.json({orders:[],page,total:0,pages:0});
    const where=`WHERE (?='' OR date(s.created_at,'localtime')>=?) AND (?='' OR date(s.created_at,'localtime')<=?)
        AND (?='' OR lower(s.status)=?) AND (?='' OR CAST(s.id AS TEXT)=?)`,params=[from,from,to,to,status,status,search,search];
    const total=Number(db.prepare(`SELECT COUNT(*) total FROM sales s ${where}`).get(...params).total);
    const orders=db.prepare(`SELECT s.id,date(s.created_at,'localtime') date,s.created_at,s.updated_at,s.status,s.final_total total,
        s.amount_paid,s.remaining,s.client_id,COALESCE(c.name,'Walk-in') customer_name,
        (SELECT GROUP_CONCAT(preview.description,'|||') FROM (SELECT COALESCE(description_at_sale,product_name_snapshot,'Historical item') description FROM sale_items WHERE sale_id=s.id ORDER BY id LIMIT 2) preview) item_preview,
        (SELECT COUNT(*) FROM sale_items WHERE sale_id=s.id) line_count
        FROM sales s LEFT JOIN clients c ON c.id=s.client_id ${where}
        ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
    res.json({orders,page,total,pages:Math.ceil(total/limit)});
}catch(error){res.status(400).json({error:error.message})}});

app.get('/api/pos/orders/:id', (req, res) => {
    const order = db.prepare(`SELECT s.*, date(s.created_at,'localtime') AS date, COALESCE(c.name, 'Walk-in') AS customer_name
        FROM sales s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ?`).get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const laterPayments = db.prepare(`SELECT p.id, p.payment_date AS date, a.amount, p.description AS note, p.created_at
        FROM client_payment_allocations a JOIN payments p ON p.id=a.payment_id
        WHERE a.sale_id=? AND p.type='sale_payment' ORDER BY p.payment_date,p.created_at,p.id`).all(order.id);
    order.initial_amount_paid = Number(order.initial_amount_paid || 0);
    order.amount_paid = Math.round((order.initial_amount_paid + laterPayments.reduce((sum, payment) => sum + Number(payment.amount), 0) + Number.EPSILON) * 100) / 100;
    order.remaining = Math.max(0, Math.round((Number(order.final_total) - order.amount_paid + Number.EPSILON) * 100) / 100);
    order.status = order.remaining < 0.000001 ? 'paid' : order.amount_paid > 0 ? 'partial' : 'unpaid';
    order.payments = [{ id: null, date: order.sale_date, amount: order.initial_amount_paid, note: 'At Order', initial: true }, ...laterPayments].filter(payment => payment.amount > 0);
    order.items = db.prepare(`SELECT id, source_type, source_id,
        COALESCE(description_at_sale, product_name_snapshot, 'Historical item') AS description,
        sale_unit AS unit, quantity, cost_price_at_sale AS cost_price,
        selling_price_at_sale AS selling_price, line_total,
        cable_family_snapshot, cable_supplier_snapshot, cable_size_snapshot,
        meter_family_snapshot, meter_product_snapshot
        FROM sale_items WHERE sale_id = ? ORDER BY id`).all(order.id);
    order.history = db.prepare('SELECT id, event_type, event_data, created_at FROM order_history WHERE sale_id = ? ORDER BY created_at DESC, id DESC').all(order.id).map(row => ({ ...row, data: JSON.parse(row.event_data || '{}') }));
    res.json(order);
});

function saleAuditSnapshot(orderId) {
    const sale = db.prepare('SELECT client_id, final_total, amount_paid, remaining, status FROM sales WHERE id = ?').get(orderId);
    if (!sale) return null;
    sale.items = db.prepare(`SELECT COALESCE(description_at_sale, product_name_snapshot, 'Historical item') AS description,
        source_type, source_id, sale_unit AS unit, quantity, selling_price_at_sale AS price FROM sale_items WHERE sale_id = ? ORDER BY id`).all(orderId);
    return sale;
}
function saleAuditChanges(before, after) {
    const changes = [], key = item => `${item.source_type}|${item.source_id ?? ''}|${item.unit}|${item.description}`;
    const oldMap = new Map(before.items.map(item => [key(item), item])), newMap = new Map(after.items.map(item => [key(item), item]));
    for (const [itemKey, item] of oldMap) if (!newMap.has(itemKey)) changes.push({ type: 'item_removed', description: item.description, quantity: Number(item.quantity), price: Number(item.price) });
    for (const [itemKey, item] of newMap) {
        const old = oldMap.get(itemKey);
        if (!old) changes.push({ type: 'item_added', description: item.description, quantity: Number(item.quantity), price: Number(item.price) });
        else {
            if (Number(old.quantity) !== Number(item.quantity)) changes.push({ type: 'quantity_changed', description: item.description, old: Number(old.quantity), new: Number(item.quantity) });
            if (Number(old.price) !== Number(item.price)) changes.push({ type: 'price_changed', description: item.description, old: Number(old.price), new: Number(item.price) });
        }
    }
    if (Number(before.final_total) !== Number(after.final_total)) changes.push({ type: 'total_changed', old: Number(before.final_total), new: Number(after.final_total) });
    if (Number(before.amount_paid) !== Number(after.amount_paid)) changes.push({ type: 'paid_changed', old: Number(before.amount_paid), new: Number(after.amount_paid) });
    return changes;
}
function updatePosOrder(orderId, body) {
    const beforeAudit = saleAuditSnapshot(orderId);
    const order = db.prepare('SELECT id FROM sales WHERE id = ?').get(orderId);
    if (!order) throw new Error('Order not found');
    if (!Array.isArray(body.items) || !body.items.length) throw new Error('An order must contain at least one item');
    const existingItems = new Map(db.prepare(`SELECT id, product_id, source_type, source_id,
        COALESCE(description_at_sale, product_name_snapshot, 'Historical item') AS description,
        sale_unit AS unit, cost_price_at_sale AS cost, cable_family_snapshot AS cableFamily,
        cable_supplier_snapshot AS cableSupplier, cable_size_snapshot AS cableSize,
        meter_family_snapshot AS meterFamily, meter_product_snapshot AS meterProduct
        FROM sale_items WHERE sale_id = ?`).all(orderId).map(item => [item.id, item]));
    const lines = body.items.map(raw => {
        const quantity = Number(raw?.quantity), selling = Number(raw?.selling_price);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Every quantity must be greater than zero');
        if (!Number.isFinite(selling) || selling < 0) throw new Error('Every selling price must be non-negative');
        const existing = existingItems.get(Number(raw?.sale_item_id));
        if (!existing) return resolveSaleLine(raw);
        if (existing.source_type === 'cable' && existing.unit === 'roll' && !Number.isInteger(quantity)) throw new Error('Cable roll quantity must be a whole number');
        return { sourceType: existing.source_type, sourceId: existing.source_id, productId: existing.product_id,
            description: existing.description, unit: existing.unit, cost: Number(existing.cost), selling, quantity,
            cableFamily: existing.cableFamily, cableSupplier: existing.cableSupplier, cableSize: existing.cableSize,
            meterFamily: existing.meterFamily, meterProduct: existing.meterProduct };
    });
    const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const itemsTotal = roundMoney(lines.reduce((sum, line) => sum + line.quantity * line.selling, 0));
    const allocatedRow=db.prepare('SELECT COALESCE(SUM(amount),0) total FROM client_payment_allocations WHERE sale_id=?').get(orderId),hasAllocations=Number(allocatedRow.total)>0;
    const finalTotal = Number(body.final_total), laterPaid = hasAllocations?Number(allocatedRow.total):Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE sale_id = ? AND type = 'sale_payment'").get(orderId).total), requestedPaid = Number(body.amount_paid);
    const amountPaid = Number.isFinite(requestedPaid) ? requestedPaid : Number(db.prepare('SELECT initial_amount_paid FROM sales WHERE id = ?').get(orderId).initial_amount_paid) + laterPaid;
    if (!Number.isFinite(finalTotal) || finalTotal < 0) throw new Error('Total must be a valid non-negative amount');
    if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > finalTotal + 0.000001) throw new Error('Paid cannot exceed Total');
    if (amountPaid + 0.000001 < laterPaid) throw new Error('Paid cannot be less than separately recorded later payments');
    const clientId = body.client_id === null || body.client_id === '' ? null : Number(body.client_id);
    const remaining = roundMoney(Math.max(0, finalTotal - amountPaid));
    const paymentState = remaining < 0.000001 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
    if (remaining > 0 && (!Number.isInteger(clientId) || !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId))) throw new Error('Select or create a customer when a balance remains');
    if (clientId !== null && (!Number.isInteger(clientId) || !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId))) throw new Error('Selected customer was not found');
    const initialPaid = roundMoney(Math.max(0, amountPaid - laterPaid));
    return db.transaction(() => {
        db.prepare(`UPDATE sales SET client_id = ?, status = ?, items_total = ?, adjustment_amount = ?, final_total = ?,
            amount_paid = ?, initial_amount_paid = ?, remaining = ?, notes = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?`)
            .run(clientId, paymentState, itemsTotal, roundMoney(finalTotal - itemsTotal), finalTotal, amountPaid, initialPaid, remaining, String(body.notes || '').trim() || null, orderId);
        db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(orderId);
        const insert = db.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, quantity, cost_price_at_sale,
            selling_price_at_sale, line_type, source_type, source_id, sale_unit, cable_family_snapshot, cable_supplier_snapshot,
            cable_size_snapshot, meter_family_snapshot, meter_product_snapshot, description_at_sale, line_total)
            VALUES (?, ?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const line of lines) insert.run(orderId, line.productId, line.description, line.quantity, line.cost, line.selling,
            line.sourceType, line.sourceId, line.unit, line.cableFamily || null, line.cableSupplier || null,
            line.cableSize || null, line.meterFamily || null, line.meterProduct || null, line.description, roundMoney(line.quantity * line.selling));
        syncSaleStock(orderId);
        if(clientId)rebuildClientAllocations(clientId);
        const afterAudit = saleAuditSnapshot(orderId), changes = saleAuditChanges(beforeAudit, afterAudit);
        if (changes.length) db.prepare(`INSERT INTO order_history (sale_id, client_id, event_type, event_data)
            VALUES (?, ?, 'order_updated', ?)`).run(orderId, clientId, JSON.stringify({ changes, old_remaining: Number(beforeAudit.remaining), new_remaining: Number(afterAudit.remaining) }));
        return { id: orderId, status: afterAudit.status, items_total: itemsTotal, adjustment_amount: roundMoney(finalTotal - itemsTotal), final_total: finalTotal, amount_paid: afterAudit.amount_paid, remaining: afterAudit.remaining, client_id: clientId };
    })();
}

app.put('/api/pos/orders/:id', (req, res) => {
    try { res.json(updatePosOrder(Number(req.params.id), req.body)); }
    catch (error) { res.status(error.message === 'Order not found' ? 404 : 400).json({ error: error.message }); }
});

app.post('/api/pos/orders/:id/payments', (req, res) => {
    try {
        const order = db.prepare('SELECT id, client_id, final_total, initial_amount_paid FROM sales WHERE id = ?').get(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (!order.client_id) throw new Error('Assign a customer before adding a later payment');
        const amount = accountingMoney(Number(req.body.amount)), date = String(req.body.date || ''), note = String(req.body.note || '').trim() || null;
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Payment date is required');
        const result = db.transaction(() => {
            rebuildClientAllocations(order.client_id);
            const current = db.prepare(`SELECT s.final_total,
                s.initial_amount_paid + COALESCE((SELECT SUM(a.amount) FROM client_payment_allocations a WHERE a.sale_id=s.id),0) AS total_paid
                FROM sales s WHERE s.id=?`).get(order.id);
            const remainingCents = Math.max(0, currencyCents(current.final_total) - currencyCents(current.total_paid));
            if (currencyCents(amount) > remainingCents) throw new Error('Payment cannot exceed the remaining balance');
            const payment = db.prepare(`INSERT INTO payments (payment_date, amount, type, direction, category, client_id, sale_id, description)
                VALUES (?, ?, 'sale_payment', 'in', 'sale', ?, ?, ?)`).run(date, amount, order.client_id, order.id, note);
            rebuildClientAllocations(order.client_id);
            const updated=db.prepare('SELECT amount_paid,remaining,status FROM sales WHERE id=?').get(order.id);
            db.prepare(`INSERT INTO order_history (sale_id, client_id, event_type, event_data)
                VALUES (?, ?, 'payment_added', ?)`).run(order.id, order.client_id, JSON.stringify({ amount, payment_id: Number(payment.lastInsertRowid), note, remaining: updated.remaining }));
            return { id: Number(payment.lastInsertRowid), total_paid: updated.amount_paid, remaining: updated.remaining, status: updated.status };
        })();
        res.status(201).json(result);
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/clients/overview', (req, res) => {
    const clients = db.prepare(`SELECT c.id, c.name, c.phone,
        ROUND(COALESCE(SUM(CASE WHEN s.remaining > 0 THEN s.remaining ELSE 0 END), 0), 2) AS balance,
        MAX(s.sale_date) AS last_order,
        (SELECT MAX(payment_date) FROM (
            SELECT p.payment_date FROM payments p WHERE p.client_id = c.id AND p.type = 'sale_payment'
            UNION ALL SELECT s2.sale_date FROM sales s2 WHERE s2.client_id = c.id AND s2.initial_amount_paid > 0
        )) AS last_payment,
        COUNT(DISTINCT CASE WHEN s.remaining > 0 THEN s.id END) AS active_orders,
        COUNT(DISTINCT s.id) AS order_count
        FROM clients c JOIN sales s ON s.client_id = c.id GROUP BY c.id
        ORDER BY balance > 0 DESC, balance DESC, c.name COLLATE NOCASE`).all();
    const summary = db.prepare(`SELECT
        ROUND(COALESCE(SUM(CASE WHEN remaining > 0 THEN remaining ELSE 0 END), 0), 2) AS total_outstanding,
        COUNT(DISTINCT CASE WHEN remaining > 0 THEN client_id END) AS clients_with_debt,
        ROUND((SELECT COALESCE(SUM(amount), 0) FROM payments WHERE type = 'sale_payment' AND payment_date >= date('now','start of month') AND payment_date < date('now','start of month','+1 month')) +
            (SELECT COALESCE(SUM(initial_amount_paid), 0) FROM sales WHERE sale_date >= date('now','start of month') AND sale_date < date('now','start of month','+1 month')), 2) AS payments_this_month
        FROM sales WHERE client_id IS NOT NULL`).get();
    const activity = db.prepare(`SELECT * FROM (
        SELECT 'order' AS type, s.id AS id, s.id AS order_id, s.client_id, c.name AS client_name,
            s.sale_date AS date, s.created_at, s.final_total AS amount, s.status, s.debt_archived
        FROM sales s JOIN clients c ON c.id = s.client_id
        UNION ALL
        SELECT 'initial_payment', s.id, s.id, s.client_id, c.name, s.sale_date, s.created_at, -s.initial_amount_paid, s.status, s.debt_archived
        FROM sales s JOIN clients c ON c.id = s.client_id WHERE s.initial_amount_paid > 0
        UNION ALL
        SELECT 'payment', p.id, a.sale_id, p.client_id, c.name, p.payment_date, p.created_at, -a.amount, NULL, 0
        FROM payments p JOIN clients c ON c.id = p.client_id JOIN client_payment_allocations a ON a.payment_id=p.id WHERE p.type = 'sale_payment'
        UNION ALL
        SELECT 'change', h.id, h.sale_id, h.client_id, c.name, substr(h.created_at,1,10), h.created_at,
            COALESCE(json_extract(h.event_data,'$.new_remaining'),0)-COALESCE(json_extract(h.event_data,'$.old_remaining'),0), NULL, 0
        FROM order_history h JOIN clients c ON c.id = h.client_id WHERE h.event_type = 'order_updated'
    ) ORDER BY date DESC, created_at DESC, id DESC LIMIT 200`).all();
    res.json({ summary, clients, activity });
});

app.get('/api/clients/:id', (req, res) => {
    const client = db.prepare('SELECT id, name, phone FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    client.orders = db.prepare(`SELECT s.id, s.sale_date AS date, s.created_at, s.updated_at, s.final_total AS total,
        s.amount_paid AS paid, s.initial_amount_paid, s.remaining, s.status, s.debt_archived,
        (SELECT GROUP_CONCAT(x.description, '|||') FROM (SELECT COALESCE(description_at_sale, product_name_snapshot, 'Historical item') description FROM sale_items WHERE sale_id=s.id ORDER BY id LIMIT 2) x) item_preview,
        (SELECT COUNT(*) FROM sale_items WHERE sale_id=s.id) line_count
        FROM sales s WHERE s.client_id = ? ORDER BY s.sale_date DESC, s.created_at DESC, s.id DESC`).all(client.id);
    client.balance = Math.round((client.orders.reduce((sum, order) => sum + Math.max(0, Number(order.remaining)), 0) + Number.EPSILON) * 100) / 100;
    client.last_order = client.orders[0]?.date || null;
    client.payments = db.prepare(`SELECT p.id,a.sale_id AS order_id,p.payment_date AS date,a.amount,p.description AS note,p.created_at
        FROM payments p JOIN client_payment_allocations a ON a.payment_id=p.id
        WHERE p.client_id=? AND p.type='sale_payment' ORDER BY p.payment_date DESC,p.created_at DESC,p.id DESC,a.id`).all(client.id);
    client.last_payment = [...client.payments.map(payment => payment.date), ...client.orders.filter(order => Number(order.initial_amount_paid) > 0).map(order => order.date)].filter(Boolean).sort().pop() || null;
    client.changes = db.prepare("SELECT id, sale_id AS order_id, event_type, event_data, created_at FROM order_history WHERE client_id = ? AND event_type='order_updated' ORDER BY created_at DESC, id DESC").all(client.id).map(row => ({ ...row, data: JSON.parse(row.event_data || '{}') }));
    client.combined_items = db.prepare(`SELECT si.source_type,si.source_id,si.sale_unit AS unit,
        COALESCE(si.description_at_sale,si.product_name_snapshot,'Historical item') AS description,
        si.selling_price_at_sale AS price,si.quantity,si.cable_family_snapshot,si.cable_supplier_snapshot,
        si.cable_size_snapshot,si.meter_family_snapshot,si.meter_product_snapshot,s.id AS order_id,s.sale_date AS order_date
        FROM sales s JOIN sale_items si ON si.sale_id=s.id
        WHERE s.client_id=? AND s.remaining>0 ORDER BY s.sale_date,s.created_at,s.id,si.id`).all(client.id);
    res.json(client);
});

app.post('/api/clients/:id/payments', (req,res)=>{
    try{
        const client=db.prepare('SELECT id FROM clients WHERE id=?').get(req.params.id);if(!client)return res.status(404).json({error:'Client not found'});
        const amount=accountingMoney(Number(req.body.amount)),date=String(req.body.date||''),note=String(req.body.note||'').trim()||null;
        if(!Number.isFinite(amount)||amount<=0)throw new Error('Payment amount must be greater than zero');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Payment date is required');
        const result=db.transaction(()=>{rebuildClientAllocations(client.id);const balance=accountingMoney(db.prepare('SELECT COALESCE(SUM(remaining),0) total FROM sales WHERE client_id=?').get(client.id).total);if(currencyCents(amount)>currencyCents(balance))throw new Error(`Payment cannot exceed the outstanding balance of $${balance.toFixed(2)}.`);const payment=db.prepare(`INSERT INTO payments(payment_date,amount,type,direction,category,client_id,description)
            VALUES (?,?,'sale_payment','in','sale',?,?)`).run(date,amount,client.id,note);rebuildClientAllocations(client.id);const allocations=db.prepare('SELECT sale_id AS order_id,amount FROM client_payment_allocations WHERE payment_id=? ORDER BY id').all(payment.lastInsertRowid);for(const allocation of allocations)db.prepare(`INSERT INTO order_history(sale_id,client_id,event_type,event_data) VALUES (?,?,'payment_allocated',?)`).run(allocation.order_id,client.id,JSON.stringify({payment_id:Number(payment.lastInsertRowid),amount:allocation.amount}));return{id:Number(payment.lastInsertRowid),amount,allocations,balance:accountingMoney(balance-amount)}})();
        res.status(201).json(result);
    }catch(error){res.status(400).json({error:error.message})}
});

app.post('/api/clients/orders/:id/archive', (req, res) => {
    try {
        const order = db.prepare('SELECT id, client_id, remaining FROM sales WHERE id = ?').get(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (Number(order.remaining) > 0.000001) throw new Error('Only fully paid orders can be removed from the active debt view');
        db.transaction(() => {
            db.prepare("UPDATE sales SET debt_archived=1, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?").run(order.id);
            db.prepare("INSERT INTO order_history (sale_id, client_id, event_type, event_data) VALUES (?, ?, 'debt_archived', '{}')").run(order.id, order.client_id);
        })();
        res.json({ id: order.id, archived: true });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

app.delete('/api/pos/orders/:id', (req, res) => {
    try {
        const deletedOrder=db.prepare('SELECT id,client_id,final_total,remaining FROM sales WHERE id = ?').get(req.params.id);
        if (!deletedOrder) return res.status(404).json({ error: 'Order not found' });
        db.transaction(() => {
            syncSaleStock(deletedOrder.id, true);
            if(deletedOrder.client_id)db.prepare("INSERT INTO client_account_history(client_id,sale_id,event_type,event_data) VALUES (?,?,'order_deleted',?)").run(deletedOrder.client_id,deletedOrder.id,JSON.stringify({total:deletedOrder.final_total,remaining:deletedOrder.remaining}));
            db.prepare('DELETE FROM client_payment_allocations WHERE sale_id = ?').run(req.params.id);
            db.prepare("UPDATE payments SET sale_id=NULL WHERE sale_id=? AND type='sale_payment'").run(req.params.id);
            db.prepare('DELETE FROM order_history WHERE sale_id = ?').run(req.params.id);
            db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(req.params.id);
            db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
            if(deletedOrder.client_id)rebuildClientAllocations(deletedOrder.client_id);
        })();
        res.status(204).end();
    } catch (error) { res.status(400).json({ error: error.message }); }
});

function normalizeAliEntry(body){const entryDate=String(body.date||''),notes=String(body.notes||'').trim()||null;if(!/^\d{4}-\d{2}-\d{2}$/.test(entryDate))throw new Error('A valid entry date is required');if(!Array.isArray(body.items)||!body.items.length)throw new Error('Add at least one item');const items=body.items.map(raw=>{const sourceType=String(raw.source_type||''),sourceId=raw.source_id==null?null:Number(raw.source_id),description=String(raw.description||'').trim(),unit=String(raw.unit||'piece'),quantity=Number(raw.quantity),cost=Number(raw.cost),fromStock=raw.from_stock?1:0;if(!['product','cable','meter_item','custom'].includes(sourceType)||!description)throw new Error('An entry item is invalid');if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Every quantity must be greater than zero');if(!Number.isFinite(cost)||cost<0)throw new Error('Every cost must be non-negative');if(sourceType==='custom'&&fromStock)throw new Error('Unknown custom items cannot be marked From Stock');return{sourceType,sourceId,description,unit,quantity,cost,lineTotal:accountingMoney(quantity*cost),fromStock}});return{entryDate,notes,items,total:accountingMoney(items.reduce((n,x)=>n+x.lineTotal,0))}}
function saveAliEntry(id,body){const entry=normalizeAliEntry(body);return db.transaction(()=>{let entryId=id;if(id){if(!db.prepare('SELECT 1 FROM ali_baba_entries WHERE id=?').get(id))throw new Error('Ali Baba entry not found');db.prepare("UPDATE ali_baba_entries SET entry_date=?,total=?,notes=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?").run(entry.entryDate,entry.total,entry.notes,id);db.prepare('DELETE FROM ali_baba_entry_items WHERE entry_id=?').run(id)}else entryId=Number(db.prepare('INSERT INTO ali_baba_entries(entry_date,total,notes) VALUES (?,?,?)').run(entry.entryDate,entry.total,entry.notes).lastInsertRowid);const insert=db.prepare(`INSERT INTO ali_baba_entry_items(entry_id,source_type,source_id,description_at_entry,unit,quantity,cost_at_entry,line_total,from_stock) VALUES (?,?,?,?,?,?,?,?,?)`);for(const item of entry.items)insert.run(entryId,item.sourceType,item.sourceId,item.description,item.unit,item.quantity,item.cost,item.lineTotal,item.fromStock);return{id:entryId,total:entry.total}})()}
app.get('/api/ali-baba',(req,res)=>{const chronological=db.prepare(`SELECT id,date,type,details,amount,notes,created_at FROM (SELECT e.id,e.entry_date date,'entry' type,COALESCE((SELECT GROUP_CONCAT(description_at_entry,' + ') FROM (SELECT description_at_entry FROM ali_baba_entry_items WHERE entry_id=e.id ORDER BY id LIMIT 3)),'Entry') details,e.total amount,e.notes,e.created_at FROM ali_baba_entries e UNION ALL SELECT p.id,p.payment_date,'payment','Payment',-p.amount,p.notes,p.created_at FROM ali_baba_payments p) ORDER BY date,created_at,id`).all();let balance=0;const history=chronological.map(row=>({...row,balance:accountingMoney(balance+=Number(row.amount))})).reverse();res.json({balance:accountingMoney(balance),history})});
app.get('/api/ali-baba/entries/:id',(req,res)=>{const entry=db.prepare('SELECT id,entry_date AS date,total,notes,created_at,updated_at FROM ali_baba_entries WHERE id=?').get(req.params.id);if(!entry)return res.status(404).json({error:'Ali Baba entry not found'});entry.items=db.prepare(`SELECT id,source_type,source_id,description_at_entry AS description,unit,quantity,cost_at_entry AS cost,line_total,from_stock FROM ali_baba_entry_items WHERE entry_id=? ORDER BY id`).all(entry.id);res.json(entry)});
app.post('/api/ali-baba/entries',(req,res)=>{try{const result=db.transaction(()=>{const saved=saveAliEntry(null,req.body);syncAliStock(saved.id,false,true);return saved})();res.status(201).json(result)}catch(error){res.status(400).json({error:error.message})}});
app.put('/api/ali-baba/entries/:id',(req,res)=>{try{const result=db.transaction(()=>{const saved=saveAliEntry(Number(req.params.id),req.body);syncAliStock(saved.id);return saved})();res.json(result)}catch(error){res.status(error.message==='Ali Baba entry not found'?404:400).json({error:error.message})}});
app.delete('/api/ali-baba/entries/:id',(req,res)=>{try{const result=db.transaction(()=>{syncAliStock(Number(req.params.id),true);db.prepare('DELETE FROM ali_baba_entry_items WHERE entry_id=?').run(req.params.id);return db.prepare('DELETE FROM ali_baba_entries WHERE id=?').run(req.params.id)})();if(!result.changes)return res.status(404).json({error:'Ali Baba entry not found'});res.status(204).end()}catch(error){res.status(400).json({error:error.message})}});
app.post('/api/ali-baba/payments',(req,res)=>{try{const amount=Number(req.body.amount),date=String(req.body.date||''),notes=String(req.body.notes||'').trim()||null;if(!Number.isFinite(amount)||amount<=0)throw new Error('Payment must be greater than zero');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('A valid payment date is required');const result=db.prepare('INSERT INTO ali_baba_payments(amount,payment_date,notes) VALUES (?,?,?)').run(amount,date,notes);res.status(201).json({id:Number(result.lastInsertRowid),amount,date})}catch(error){res.status(400).json({error:error.message})}});
app.delete('/api/ali-baba/payments/:id',(req,res)=>{const result=db.prepare('DELETE FROM ali_baba_payments WHERE id=?').run(req.params.id);if(!result.changes)return res.status(404).json({error:'Ali Baba payment not found'});res.status(204).end()});

const cashTypes={expense:'out',salary:'out',personal_withdrawal:'out',other_income:'in'};
function normalizeCash(body){const date=String(body.date||''),description=String(body.description||'').trim(),type=String(body.type||''),amount=Number(body.amount),notes=String(body.notes||'').trim()||null;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('A valid date is required');if(!description)throw new Error('Description is required');if(!cashTypes[type])throw new Error('Select a valid transaction type');if(!Number.isFinite(amount)||amount<=0)throw new Error('Amount must be greater than zero');return{date,description,type,direction:cashTypes[type],amount:accountingMoney(amount),notes}}
function normalizeSimpleCash(body){const direction=String(body.direction||''),mapped=direction==='received'?'other_income':direction==='paid'?'expense':null;if(!mapped)throw new Error('Choose Received or Paid');return normalizeCash({...body,type:mapped})}
app.get('/api/cash-transactions',(req,res)=>res.json(db.prepare('SELECT id,transaction_date AS date,description,type,direction,amount,notes,created_at,updated_at FROM cash_transactions ORDER BY transaction_date DESC,created_at DESC,id DESC').all()));
app.post('/api/cash-transactions',(req,res)=>{try{const x=req.body.direction?normalizeSimpleCash(req.body):normalizeCash(req.body),result=db.prepare('INSERT INTO cash_transactions(transaction_date,description,type,direction,amount,notes) VALUES (?,?,?,?,?,?)').run(x.date,x.description,x.type,x.direction,x.amount,x.notes);res.status(201).json({id:Number(result.lastInsertRowid),...x})}catch(error){res.status(400).json({error:error.message})}});
app.put('/api/cash-transactions/:id',(req,res)=>{try{const x=req.body.direction?normalizeSimpleCash(req.body):normalizeCash(req.body),result=db.prepare("UPDATE cash_transactions SET transaction_date=?,description=?,type=?,direction=?,amount=?,notes=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?").run(x.date,x.description,x.type,x.direction,x.amount,x.notes,req.params.id);if(!result.changes)return res.status(404).json({error:'Transaction not found'});res.json({id:Number(req.params.id),...x})}catch(error){res.status(400).json({error:error.message})}});
app.delete('/api/cash-transactions/:id',(req,res)=>{const result=db.prepare('DELETE FROM cash_transactions WHERE id=?').run(req.params.id);if(!result.changes)return res.status(404).json({error:'Transaction not found'});res.status(204).end()});
app.get('/api/income-expenses',(req,res)=>res.json(db.prepare(`WITH daily_received AS (
    SELECT date,ROUND(SUM(amount),2) amount,MAX(created_at) created_at FROM (
        SELECT sale_date date,initial_amount_paid amount,created_at FROM sales WHERE initial_amount_paid>0
        UNION ALL SELECT payment_date,amount,created_at FROM payments WHERE type='sale_payment'
    ) GROUP BY date
) SELECT * FROM (
    SELECT 'manual' source,id,transaction_date date,description,CASE direction WHEN 'in' THEN 'received' ELSE 'paid' END direction,amount,notes,created_at FROM cash_transactions
    UNION ALL SELECT 'daily_received',0,date,'Daily Sales / Client Income','received',amount,NULL,created_at FROM daily_received
    UNION ALL SELECT 'purchase',pi.id,pi.invoice_date,'Purchase Invoice - '||t.name,'paid',pi.payment_now,pi.notes,pi.created_at FROM purchase_invoices pi JOIN traders t ON t.id=pi.trader_id WHERE pi.payment_now>0
    UNION ALL SELECT 'supplier',p.id,p.payment_date,'Supplier Payment - '||t.name,'paid',p.amount,p.description,p.created_at FROM payments p JOIN traders t ON t.id=p.trader_id WHERE p.type='supplier_payment'
    UNION ALL SELECT 'ali_baba',p.id,p.payment_date,'Ali Baba Payment','received',p.amount,p.notes,p.created_at FROM ali_baba_payments p
) ORDER BY date DESC,created_at DESC,id DESC` ).all()));

const utilityText=value=>{const text=String(value||'').trim();if(!text)throw new Error('Text is required');if(text.length>1000)throw new Error('Text is too long');return text};
app.get('/api/nawa2is',(req,res)=>res.json(db.prepare('SELECT id,text,created_at,updated_at FROM nawa2is WHERE completed=0 ORDER BY id').all()));
app.post('/api/nawa2is',(req,res)=>{try{const text=utilityText(req.body.text),result=db.prepare('INSERT INTO nawa2is(text) VALUES(?)').run(text);res.status(201).json({id:Number(result.lastInsertRowid),text})}catch(error){res.status(400).json({error:error.message})}});
app.put('/api/nawa2is/:id',(req,res)=>{try{const text=utilityText(req.body.text),result=db.prepare('UPDATE nawa2is SET text=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND completed=0').run(text,req.params.id);if(!result.changes)return res.status(404).json({error:'Nawa2is entry not found'});res.json({id:Number(req.params.id),text})}catch(error){res.status(400).json({error:error.message})}});
app.post('/api/nawa2is/:id/complete',(req,res)=>{const result=db.prepare('UPDATE nawa2is SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND completed=0').run(req.params.id);if(!result.changes)return res.status(404).json({error:'Nawa2is entry not found'});res.status(204).end()});
app.get('/api/reminders',(req,res)=>res.json(db.prepare('SELECT id,text,due_date,created_at,updated_at FROM reminders WHERE completed=0 ORDER BY due_date,id').all()));
app.get('/api/reminders/due',(req,res)=>{const today=beirutNow().toISODate(),rows=db.prepare('SELECT id,text,due_date FROM reminders WHERE completed=0 AND due_date<=? ORDER BY due_date,id').all(today);res.json({today_date:today,today:rows.filter(x=>x.due_date===today),overdue:rows.filter(x=>x.due_date<today),count:rows.length})});
app.post('/api/reminders',(req,res)=>{try{const text=utilityText(req.body.text),dueDate=String(req.body.due_date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!DateTime.fromISO(dueDate,{zone:AUTH_TIME_ZONE}).isValid)throw new Error('A valid reminder date is required');const result=db.prepare('INSERT INTO reminders(text,due_date) VALUES(?,?)').run(text,dueDate);res.status(201).json({id:Number(result.lastInsertRowid),text,due_date:dueDate})}catch(error){res.status(400).json({error:error.message})}});
app.put('/api/reminders/:id',(req,res)=>{try{const text=utilityText(req.body.text),dueDate=String(req.body.due_date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!DateTime.fromISO(dueDate,{zone:AUTH_TIME_ZONE}).isValid)throw new Error('A valid reminder date is required');const result=db.prepare('UPDATE reminders SET text=?,due_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND completed=0').run(text,dueDate,req.params.id);if(!result.changes)return res.status(404).json({error:'Reminder not found'});res.json({id:Number(req.params.id),text,due_date:dueDate})}catch(error){res.status(400).json({error:error.message})}});
app.post('/api/reminders/:id/complete',(req,res)=>{const result=db.prepare('UPDATE reminders SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND completed=0').run(req.params.id);if(!result.changes)return res.status(404).json({error:'Reminder not found'});res.status(204).end()});

app.get('/api/dashboard/hourly',(req,res)=>{try{
    const todayStart=beirutNow().startOf('day'),utcCutoff=todayStart.toUTC().toFormat('yyyy-LL-dd HH:mm:ss.SSS');
    const orders=db.prepare('SELECT id,created_at,final_total FROM sales WHERE created_at < ? ORDER BY created_at,id').all(utcCutoff);
    const activeDays=new Set(),hourly=new Map();
    for(const order of orders){
        const placed=DateTime.fromSQL(String(order.created_at),{zone:'utc'}).setZone(AUTH_TIME_ZONE);
        if(!placed.isValid||placed>=todayStart)continue;
        const day=placed.toISODate(),hour=placed.hour;activeDays.add(day);
        const value=hourly.get(hour)||{orders:0,sales:0};value.orders+=1;value.sales+=Number(order.final_total||0);hourly.set(hour,value);
    }
    const dayCount=activeDays.size,actualHours=[...hourly.keys()],first=Math.min(8,...actualHours),last=Math.max(20,...actualHours);
    const hours=dayCount?Array.from({length:last-first+1},(_,index)=>{const hour=first+index,value=hourly.get(hour)||{orders:0,sales:0};return{
        hour,average_orders:Math.round(value.orders/dayCount*100)/100,average_sales:Math.round(value.sales/dayCount*100)/100
    }}):[];
    res.json({active_days:dayCount,hours});
}catch(error){res.status(400).json({error:error.message})}});

app.get('/api/dashboard',(req,res)=>{try{
    const month=/^\d{4}-\d{2}$/.test(String(req.query.month||''))?String(req.query.month):new Date().toISOString().slice(0,7),year=month.slice(0,4),start=`${month}-01`;
    const nextMonth=db.prepare("SELECT date(?,'+1 month') value").get(start).value,yearStart=`${year}-01-01`,nextYear=`${Number(year)+1}-01-01`;
    const daily=db.prepare(`SELECT s.sale_date date,ROUND(SUM(s.final_total),2) sales,COUNT(*) orders,
        ROUND(SUM(s.final_total-COALESCE((SELECT SUM(si.quantity*si.cost_price_at_sale) FROM sale_items si WHERE si.sale_id=s.id),0)),2) profit
        FROM sales s WHERE s.sale_date>=? AND s.sale_date<? GROUP BY s.sale_date ORDER BY s.sale_date`).all(start,nextMonth);
    const hourly=db.prepare(`SELECT date,hour,ROUND(SUM(final_total),2) sales,ROUND(SUM(items),2) items,COUNT(*) orders FROM (
        SELECT s.id,s.sale_date date,CAST(strftime('%H',s.created_at,'localtime') AS INTEGER) hour,s.final_total,
            COALESCE((SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id=s.id),0) items
        FROM sales s WHERE s.sale_date>=? AND s.sale_date<?
    ) GROUP BY date,hour ORDER BY date,hour`).all(start,nextMonth);
    const period=(from,to)=>db.prepare(`SELECT ROUND(COALESCE(SUM(s.final_total),0),2) sales,COUNT(*) orders,
        ROUND(COALESCE(SUM(s.final_total-COALESCE((SELECT SUM(si.quantity*si.cost_price_at_sale) FROM sale_items si WHERE si.sale_id=s.id),0)),0),2) profit
        FROM sales s WHERE s.sale_date>=? AND s.sale_date<?`).get(from,to);
    const monthly=period(start,nextMonth),yearly=period(yearStart,nextYear);
    monthly.purchases=Number(db.prepare('SELECT ROUND(COALESCE(SUM(total),0),2) value FROM purchase_invoices WHERE invoice_date>=? AND invoice_date<?').get(start,nextMonth).value);
    const cashRows=db.prepare(`SELECT date,direction,ROUND(SUM(amount),2) amount FROM (
        SELECT transaction_date date,CASE direction WHEN 'in' THEN 'received' ELSE 'paid' END direction,amount FROM cash_transactions
        UNION ALL SELECT sale_date,'received',initial_amount_paid FROM sales WHERE initial_amount_paid>0
        UNION ALL SELECT payment_date,'received',amount FROM payments WHERE type='sale_payment'
        UNION ALL SELECT invoice_date,'paid',payment_now FROM purchase_invoices WHERE payment_now>0
        UNION ALL SELECT payment_date,'paid',amount FROM payments WHERE type='supplier_payment'
        UNION ALL SELECT payment_date,'received',amount FROM ali_baba_payments
    ) WHERE date>=? AND date<? GROUP BY date,direction ORDER BY date`).all(start,nextMonth);
    monthly.cash_received=accountingMoney(cashRows.filter(x=>x.direction==='received').reduce((n,x)=>n+Number(x.amount),0));
    monthly.cash_paid=accountingMoney(cashRows.filter(x=>x.direction==='paid').reduce((n,x)=>n+Number(x.amount),0));
    const position=db.prepare(`SELECT ROUND(COALESCE((SELECT SUM(CASE WHEN remaining>0 AND debt_archived=0 THEN remaining ELSE 0 END) FROM sales WHERE client_id IS NOT NULL),0),2) customers_owe,
        ROUND(COALESCE((SELECT SUM(CASE WHEN remaining>0 THEN remaining ELSE 0 END) FROM purchase_invoices),0),2) suppliers_owed`).get();
    const recent=db.prepare(`SELECT * FROM (
        SELECT 'sale' type,s.id,s.sale_date date,'Sale #'||s.id description,s.final_total amount,'sale' direction,s.created_at FROM sales s
        UNION ALL SELECT 'client_payment',p.id,p.payment_date,'Client Payment - '||COALESCE(c.name,'Client'),p.amount,'received',p.created_at FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.type='sale_payment'
        UNION ALL SELECT 'purchase',pi.id,pi.invoice_date,'Purchase - '||t.name,pi.total,'purchase',pi.created_at FROM purchase_invoices pi JOIN traders t ON t.id=pi.trader_id
        UNION ALL SELECT 'supplier_payment',p.id,p.payment_date,'Supplier Payment - '||t.name,p.amount,'paid',p.created_at FROM payments p JOIN traders t ON t.id=p.trader_id WHERE p.type='supplier_payment'
        UNION ALL SELECT 'manual',c.id,c.transaction_date,c.description,c.amount,CASE c.direction WHEN 'in' THEN 'received' ELSE 'paid' END,c.created_at FROM cash_transactions c
    ) ORDER BY date DESC,created_at DESC,id DESC LIMIT 12`).all();
    res.json({month,days:daily,hourly,monthly,yearly,position,cash_by_day:cashRows,recent,net_profit:{available:false,reason:'Manual paid transactions are not classified as operating expenses.'}});
}catch(error){res.status(400).json({error:error.message})}});

app.get('/api/settings/navigation-order',(req,res)=>{const value=db.prepare("SELECT value FROM app_settings WHERE key='top_navigation_order'").get()?.value;try{res.json({order:value?JSON.parse(value):[]})}catch{res.json({order:[]})}});
app.put('/api/settings/navigation-order',(req,res)=>{try{const order=Array.isArray(req.body.order)?req.body.order.map(String).filter(x=>/^[A-Za-z][A-Za-z0-9]*$/.test(x)):[];if(!order.length)throw new Error('Navigation order is required');db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES('top_navigation_order',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify([...new Set(order)]));res.json({order:[...new Set(order)]})}catch(error){res.status(400).json({error:error.message})}});

app.post('/api/settings/reset-transactions',(req,res)=>{try{if(req.body.confirm!=='RESET')throw new Error('Type RESET to confirm');const selected={sales:Boolean(req.body.sales),clients:Boolean(req.body.clients),purchases:Boolean(req.body.purchases),cash:Boolean(req.body.cash),aliBaba:Boolean(req.body.aliBaba),stock:Boolean(req.body.stock)};if(!Object.values(selected).some(Boolean))throw new Error('Select at least one data category');const result=db.transaction(()=>{const deleted={sales:0,clients:0,client_payments:0,purchase_invoices:0,supplier_payments:0,cash_transactions:0,ali_entries:0,ali_payments:0,stock_movements:0};if(selected.sales||selected.clients){const condition=selected.sales?'1=1':'client_id IS NOT NULL',saleIds=db.prepare(`SELECT id FROM sales WHERE ${condition}`).all().map(x=>x.id);if(saleIds.length){const marks=saleIds.map(()=>'?').join(',');deleted.client_payments=db.prepare(`SELECT COUNT(1)n FROM payments WHERE type='sale_payment' AND (sale_id IN (${marks}) OR client_id IN (SELECT client_id FROM sales WHERE id IN (${marks})))`).get(...saleIds,...saleIds).n;db.prepare(`DELETE FROM client_payment_allocations WHERE sale_id IN (${marks}) OR payment_id IN (SELECT id FROM payments WHERE type='sale_payment' AND client_id IN (SELECT client_id FROM sales WHERE id IN (${marks})))`).run(...saleIds,...saleIds);db.prepare(`DELETE FROM payments WHERE type='sale_payment' AND (sale_id IN (${marks}) OR client_id IN (SELECT client_id FROM sales WHERE id IN (${marks})))`).run(...saleIds,...saleIds);db.prepare(`DELETE FROM order_history WHERE sale_id IN (${marks})`).run(...saleIds);db.prepare(`DELETE FROM sale_items WHERE sale_id IN (${marks})`).run(...saleIds);deleted.sales=db.prepare(`DELETE FROM sales WHERE id IN (${marks})`).run(...saleIds).changes}db.prepare('DELETE FROM client_account_history').run();if(selected.clients)deleted.clients=db.prepare('DELETE FROM clients WHERE NOT EXISTS(SELECT 1 FROM sales WHERE sales.client_id=clients.id)').run().changes}
if(selected.purchases){deleted.supplier_payments=db.prepare("SELECT COUNT(1)n FROM payments WHERE type='supplier_payment'").get().n;deleted.purchase_invoices=db.prepare('SELECT COUNT(1)n FROM purchase_invoices').get().n;db.prepare('DELETE FROM purchase_payment_allocations').run();db.prepare("DELETE FROM payments WHERE type='supplier_payment'").run();db.prepare('DELETE FROM purchase_items').run();db.prepare('DELETE FROM purchase_invoices').run()}
if(selected.cash)deleted.cash_transactions=db.prepare('DELETE FROM cash_transactions').run().changes;if(selected.aliBaba){deleted.ali_entries=db.prepare('SELECT COUNT(1)n FROM ali_baba_entries').get().n;deleted.ali_payments=db.prepare('DELETE FROM ali_baba_payments').run().changes;db.prepare('DELETE FROM ali_baba_entry_items').run();db.prepare('DELETE FROM ali_baba_entries').run()}if(selected.stock)deleted.stock_movements=db.prepare('DELETE FROM stock_movements').run().changes;const preserved={products:db.prepare('SELECT COUNT(1)n FROM products').get().n,cables:db.prepare('SELECT COUNT(1)n FROM cable_entries').get().n,by_meter:db.prepare('SELECT COUNT(1)n FROM meter_items').get().n,suppliers:db.prepare('SELECT COUNT(1)n FROM traders').get().n};return{deleted,preserved}})();res.json(result)}catch(error){res.status(400).json({error:error.message})}});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'CSV file is too large (maximum 5 MB)' : error.message });
    }
    console.error('Unhandled request error:', error);
    res.status(500).json({ error: NODE_ENV === 'production' ? 'Request failed' : (error.message || 'Request failed') });
});

// Start the server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dakkak Electric is running at http://localhost:${PORT}`);
});

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down cleanly.`);
    server.close(() => {
        try { sessionDb.close(); } catch {}
        try { db.close(); } catch {}
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
