-- Seed nine known suppliers + aliases (Handbook Section 5).
-- Idempotent: uses INSERT OR IGNORE keyed on UNIQUE (name) / UNIQUE (supplier_id, normalized).

INSERT OR IGNORE INTO suppliers (name, canonical_name, currency) VALUES
    ('Founding IP',          'founding ip',          'GBP'),
    ('Cairo Logistics',      'cairo logistics',      'EGP'),
    ('Nile Print House',     'nile print house',     'EGP'),
    ('Alex Customs Agents',  'alex customs agents',  'EGP'),
    ('Sahara Freight Co',    'sahara freight co',    'USD'),
    ('Mediterranean Movers', 'mediterranean movers', 'EUR'),
    ('Delta Packaging',      'delta packaging',      'EGP'),
    ('Pyramid Office Supply','pyramid office supply','EGP'),
    ('Sphinx Legal Partners','sphinx legal partners','USD');

INSERT OR IGNORE INTO supplier_aliases (supplier_id, alias, normalized)
SELECT id, 'Founding IP Ltd', 'founding ip ltd' FROM suppliers WHERE name = 'Founding IP'
UNION ALL SELECT id, 'FoundingIP', 'foundingip' FROM suppliers WHERE name = 'Founding IP'
UNION ALL SELECT id, 'Founding I.P.', 'founding ip' FROM suppliers WHERE name = 'Founding IP'

UNION ALL SELECT id, 'Cairo Logistics LLC', 'cairo logistics llc' FROM suppliers WHERE name = 'Cairo Logistics'
UNION ALL SELECT id, 'CairoLogistics', 'cairologistics' FROM suppliers WHERE name = 'Cairo Logistics'

UNION ALL SELECT id, 'Nile Print', 'nile print' FROM suppliers WHERE name = 'Nile Print House'
UNION ALL SELECT id, 'Nile Printing House', 'nile printing house' FROM suppliers WHERE name = 'Nile Print House'

UNION ALL SELECT id, 'Alex Customs', 'alex customs' FROM suppliers WHERE name = 'Alex Customs Agents'
UNION ALL SELECT id, 'Alexandria Customs Agents', 'alexandria customs agents' FROM suppliers WHERE name = 'Alex Customs Agents'

UNION ALL SELECT id, 'Sahara Freight', 'sahara freight' FROM suppliers WHERE name = 'Sahara Freight Co'
UNION ALL SELECT id, 'Sahara Freight Company', 'sahara freight company' FROM suppliers WHERE name = 'Sahara Freight Co'

UNION ALL SELECT id, 'Med Movers', 'med movers' FROM suppliers WHERE name = 'Mediterranean Movers'
UNION ALL SELECT id, 'Mediterranean Moving', 'mediterranean moving' FROM suppliers WHERE name = 'Mediterranean Movers'

UNION ALL SELECT id, 'Delta Pack', 'delta pack' FROM suppliers WHERE name = 'Delta Packaging'

UNION ALL SELECT id, 'Pyramid Office', 'pyramid office' FROM suppliers WHERE name = 'Pyramid Office Supply'
UNION ALL SELECT id, 'Pyramid Office Supplies', 'pyramid office supplies' FROM suppliers WHERE name = 'Pyramid Office Supply'

UNION ALL SELECT id, 'Sphinx Legal', 'sphinx legal' FROM suppliers WHERE name = 'Sphinx Legal Partners'
UNION ALL SELECT id, 'Sphinx Partners', 'sphinx partners' FROM suppliers WHERE name = 'Sphinx Legal Partners';
