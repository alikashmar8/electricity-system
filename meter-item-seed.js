module.exports = function seedMeterItems(db) {
    const families = [
        ['Strip LED 220V', [['240Led', 0.85, 1.50], ['120Led', 0.60, 1.20], ['276Led', 1.00, 1.50], ['180Led', 0.70, 1.50], ['RGB96Led', 1.00, 1.80]]],
        ['Internet Cables', [['Cosmostar Cat6', 0.15, 0.35], ['Tecathlon Cat6', 0.10, 0.20]]],
        ['Satellite', [['Cosmostar RG6', 0.13, 0.30], ['Starsat RG6', 0.13, 0.30]]],
        ['Camera', [['Camera Cable', 0.20, 0.35]]]
    ];
    const addFamily = db.prepare('INSERT OR IGNORE INTO meter_item_families (name, sort_order) VALUES (?, ?)');
    const getFamily = db.prepare('SELECT id FROM meter_item_families WHERE name = ?');
    const addItem = db.prepare(`INSERT OR IGNORE INTO meter_items
        (family_id, name, cost_per_meter, selling_price_per_meter, sort_order) VALUES (?, ?, ?, ?, ?)`);
    db.transaction(() => families.forEach(([name, items], familyIndex) => {
        addFamily.run(name, familyIndex + 1);
        const familyId = getFamily.get(name).id;
        items.forEach(([itemName, cost, price], itemIndex) => addItem.run(familyId, itemName, cost, price, itemIndex + 1));
    }))();
};
