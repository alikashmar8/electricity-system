const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const db = require('./database');

const csvPath = path.join(__dirname, 'System 2026 - Products.csv');
const fileContent = fs.readFileSync(csvPath, 'utf8');

const rows = parse(fileContent, {
    skip_empty_lines: true,
    trim: true
});

// Remove header row
rows.shift();

const insertProduct = db.prepare(`
    INSERT INTO products (
        name_en,
        cost_price,
        selling_price,
        unit,
        is_cable,
        archived
    )
    VALUES (?, ?, ?, 'piece', 0, 0)
`);

const importProducts = db.transaction(() => {
    let imported = 0;

    for (const row of rows) {
        const name = row[0];
        const cost = parseFloat(row[1]) || 0;
        const selling = parseFloat(row[2]) || 0;

        if (!name) continue;

        insertProduct.run(name, cost, selling);
        imported++;
    }

    return imported;
});
const imported = importProducts();

console.log(`Imported ${imported} products into sandbox.db`);