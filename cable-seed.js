const families = [
    { name: 'مفرد', order: 1, entries: {
        'Liban Cables': { code: 'NYA', rows: [['0.75',21.70],['3/029',31.50],['1.5',37],['2',49.50],['2.5',56.50],['3',66.50],['4',89],['6',131],['10',224],['16',366],['25',568],['35',786]] },
        MCC: { code: 'NYA-m', rows: [['3/0.029',17.20],['1.5',19.90],['2',27.10],['2.5',31.57],['3',38.50],['4',50.30],['6',73.10],['10',123.90],['16',195.55],['25',309.15],['35',424.25]] }
    }},
    { name: 'مبسط', order: 2, entries: {
        'Liban Cables': { code: 'NYZ', rows: [['2×0.5',35.20],['2×1',57],['2×1.5',76],['2×2',102.50],['2×2.5',120],['2×0.5',38,91.44,'RN'],['2×1',61.50,91.44,'RN'],['2×1.5',80.50,91.44,'RN'],['2×2',110.50,91.44,'RN']] },
        MCC: { code: 'NYZ', rows: [['2×0.5',17.73],['2×1',30.10],['2×1.5',40.74],['2×2',56.54],['2×2.5',65.82],['2×0.5',20.92,91.44,'RN'],['2×1',34.87,91.44,'RN'],['2×1.5',46.60,91.44,'RN'],['2×2',64.65,91.44,'RN'],['2×2.5',76.76,91.44,'RN']] }
    }},
    { name: 'مبروم', order: 4, entries: {
        'Liban Cables': { code: 'NYMHY', rows: [['2×1.5',93],['2×2.5',146.50],['2×4',221],['2×6',312],['2×10',288,45.72,'50 yd'],['3×1.5',132],['3×2.5',201],['3×4',318],['3×6',477],['3×10',450,45.72,'50 yd'],['4×1.5',175],['4×2.5',270],['4×4',410],['4×6',596],['4×10',520,45.72,'50 yd']] },
        MCC: { code: 'NYMHY', rows: [['2×0.5',22.72],['2×0.75',28.55],['2×1',38.55],['2×1.5',52],['2×2.5',81.50],['2×4',129.57],['2×6',186.47],['2×10',163.46,45.72,'50 yd'],['3×0.5',29.12],['3×0.75',38.13],['3×1',50.80],['3×1.5',71.44],['3×2.5',116.78],['3×4',180.38],['3×6',262.59],['3×10',228.65,45.72,'50 yd'],['4×0.5',34.53],['4×0.75',47.37],['4×1',63.07],['4×1.5',95.07],['4×2.5',150.55],['4×4',234.40],['4×6',343.70],['4×10',305.80,45.72]] }
    }},
    { name: 'شعري', order: 3, entries: {
        'Liban Cables': { code: 'NYAF', rows: [['1',29],['1.5',40],['2',58.20],['2.5',63],['4',99],['6',137.50],['10',232],['16',371],['25',571],['35',795]] },
        MCC: { code: 'NYAF', rows: [['0.75',10.80],['1',14.32],['1.5',20.30],['2',28.70],['2.5',33.47],['3',41.29],['4',53.74],['6',78.30],['10',130.20],['16',204.11],['25',320.52],['35',456]] }
    }},
    { name: 'تلفون', order: 5, entries: {
        'Liban Cables': { code: 'LIBTEL', rows: [['01 Pair+T',27.30,100],['02 Pair+T',46,100],['03 Pair+T',64.50,100],['04 Pair+T',73.70,100],['05 Pair+T',95,100],['06 Pair+T',110.50,100],['08 Pair+T',139,100],['10 Pair+T',171,100],['20 Pair+T',342,100]] }
    }},
    { name: 'مبروم أسود', order: 6, entries: {
        'Liban Cables': { code: 'NYMHY BLACK', rows: [['2×1.5',99],['2×2.5',166],['3×1.5',151],['3×2.5',210],['4×1.5',196],['4×2.5',309]] }
    }},
    { name: 'كابل أسود NYM', order: 7, entries: {
        'Liban Cables': { code: 'NYM', unit: 'meter', rows: [['2×1.5',1.50],['2×2.5',2.32],['2×4',3.15],['2×6',4.10],['3×1.5',1.98],['3×2.5',2.50],['3×4',3.80],['3×6',5.55],['4×1.5',2.58],['4×2.5',3.45],['4×4',5.05],['4×6',7.80],['2×10',6.15],['3×10',9.35],['3×16',14],['3×10+6',10.70],['3×16+10',16],['3×25+16',24.50],['4×10',11.40],['4×16',17.40],['4×25',27.30]] },
        MCC: { code: 'NYM', unit: 'roll', length: 100, rows: [['2×1.5',74.90],['2×2.5',108.50],['2×4',165.80],['2×6',225.04],['2×10',350.10],['2×16',494],['3×1.5',95.37],['3×2.5',150.75],['3×4',225.25],['3×6',325.10],['3×10',492.15],['3×16',751.20],['3×25',1176],['3×6+4',364.20],['3×10+6',580.30],['3×16+10',911],['3×25+16',1397],['3×35+16',1788],['4×1.5',123.97],['4×2.5',195.30],['4×4',303],['4×6',430],['4×10',645],['4×16',989],['4×25',1540]] }
    }},
    { name: 'NYY', order: 8, entries: {
        'Liban Cables': { code: 'NYY', unit: 'meter', rows: [['3×35+16',33.50],['3×50+25',50.50],['3×70+35',65.50],['3×95+50',96],['3×120+70',115.50],['3×150+70',138],['3×185+95',175],['3×240+120',227.50],['4×35',37.60],['4×50',54.20],['4×70',73],['4×95',101.50],['4×120',127],['4×150',156],['4×185',195],['4×240',258]] },
        MCC: { code: 'NYY', unit: 'meter', rows: [['3×50+25',25.25],['3×70+35',36.14],['3×95+50',49.66],['3×120+70',64.17],['3×150+70',75.75],['3×185+95',98.18],['3×240+120',129.23],['4×35',21.08],['4×50',29.60],['4×70',41.54],['4×95',57.48],['4×120',75.38],['4×150',93.10],['4×185',116.22],['4×240',154]] }
    }},
    { name: 'EX', order: 9, entries: {
        'Liban Cables': { code: 'EX', unit: 'meter', rows: [['4×35',38.30],['4×50',55.20],['4×95',103.30],['4×120',129.20],['4×150',158.70],['4×240',262.20]] }
    }},
    { name: 'Drop Wire - هاتف اسود', order: 10, entries: {
        'Liban Cables': { code: 'DROP', unit: 'roll', rows: [['2×0.8/PTT/100',39.50,100],['2×0.8/PTT/250',98.75,250],['2×0.8/PTT/500',197.50,500]] },
        MCC: { code: 'DROP', unit: 'roll', rows: [['2×0.8/PTT/100',20.45,100],['2×0.8/PTT/250',51.06,250],['2×0.8/PTT/500',102.27,500]] }
    }},
    { name: 'Bell Wire / جرس', order: 11, entries: {
        'Liban Cables': { code: 'BELL', rows: [['2×0.50',13.50]] },
        MCC: { code: 'BELL', unit: 'unknown', rows: [['1×0.50',4.15],['2×0.50',8.50]] }
    }},
    { name: 'Solar PV', order: 12, entries: {
        'Liban Cables': { code: 'SOLAR PV', unit: 'meter', rows: [['SH1Z2Z2 1×4-MOBI',1.42],['SH1Z2Z2 1×6-MOBI',1.90],['SH1Z2Z2 1×10-DRUM',2.85]] }
    }},
    { name: 'Bare Copper', order: 13, entries: {
        'Liban Cables': { code: 'CNUD', unit: 'meter', rows: [['CNUD 50',9.80],['CNUD 70',13.85]] }
    }}
];

function seedCables(db) {
    const addFamily = db.prepare(`INSERT INTO cable_families (name, sort_order) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET sort_order = excluded.sort_order`);
    const getFamily = db.prepare('SELECT id FROM cable_families WHERE name = ?');
    const addEntry = db.prepare(`INSERT OR IGNORE INTO cable_entries
        (family_id, supplier, source_code, size, variant, list_price, pricing_unit, roll_length_meters, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
        db.prepare(`INSERT OR IGNORE INTO cable_pricing_rules
            (supplier, primary_multiplier, additional_multiplier, roll_markup, meter_markup)
            VALUES ('Liban Cables', 0.85, 1.11, 5, 0.20)`).run();
        db.prepare(`INSERT OR IGNORE INTO cable_pricing_rules
            (supplier, primary_multiplier, additional_multiplier, roll_markup, meter_markup)
            VALUES ('MCC', 1.06, 1.11, 5, 0.20)`).run();
        db.prepare("UPDATE cable_families SET name = 'Drop Wire - هاتف اسود' WHERE name = 'Drop Wire'").run();
        for (const family of families) {
            addFamily.run(family.name, family.order);
            const familyId = getFamily.get(family.name).id;
            if (family.name === 'مبروم') {
                const label50Yards = db.prepare(`UPDATE cable_entries SET variant = '50 yd', updated_at = CURRENT_TIMESTAMP
                    WHERE family_id = ? AND supplier = ? AND size = ? AND variant IS NULL`);
                for (const size of ['2×10', '3×10', '4×10']) label50Yards.run(familyId, 'Liban Cables', size);
                for (const size of ['2×10', '3×10']) label50Yards.run(familyId, 'MCC', size);
            }
            if (family.name === 'كابل أسود NYM') {
                db.prepare(`UPDATE cable_entries SET pricing_unit = 'roll', roll_length_meters = 100,
                    updated_at = CURRENT_TIMESTAMP WHERE family_id = ? AND supplier = 'MCC'`).run(familyId);
            }
            if (family.name === 'Drop Wire - هاتف اسود') {
                db.prepare(`UPDATE cable_entries SET pricing_unit = 'roll',
                    roll_length_meters = CASE
                        WHEN size LIKE '%/100' THEN 100 WHEN size LIKE '%/250' THEN 250 WHEN size LIKE '%/500' THEN 500
                    END, updated_at = CURRENT_TIMESTAMP WHERE family_id = ?`).run(familyId);
            }
            for (const [supplier, group] of Object.entries(family.entries)) {
                group.rows.forEach((row, index) => {
                    const [size, price] = row;
                    const length = row.length > 2 ? row[2] : ((group.unit || 'roll') === 'roll' ? (group.length ?? 91.44) : null);
                    const variant = row.length > 3 ? row[3] : null;
                    addEntry.run(familyId, supplier, group.code, size, variant, price, group.unit || 'roll', length, index + 1);
                });
            }
        }
    })();
}

module.exports = seedCables;
