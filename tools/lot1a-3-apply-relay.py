from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count == 0 and new in text:
        print(f'{path}: already patched')
        return
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'{path}: patched')


# Allocation réelle : même valeur CURRENT, autorité cost_components d'abord.
replace_once(
    'services/cost-allocation/allocate.js',
    '@depends       db, ./_helpers (shareByWeight)\n',
    '@depends       db, ./_helpers (shareByWeight), utils/relay-commission.js\n',
)
replace_once(
    'services/cost-allocation/allocate.js',
    '@db-read       customs_shipment_parcels, customs_shipments, finance_config, order_items, orders, parcel_items, parcels, products\n',
    '@db-read       cost_components, customs_shipment_parcels, customs_shipments, finance_config, order_items, orders, parcel_items, parcels, products\n',
)
replace_once(
    'services/cost-allocation/allocate.js',
    "const db = require('../../db');\nconst { shareByWeight } = require('./_helpers');\n",
    "const db = require('../../db');\nconst { shareByWeight } = require('./_helpers');\nconst { resolveRelayCommissionCurrent } = require('../../utils/relay-commission');\n",
)
replace_once(
    'services/cost-allocation/allocate.js',
    " *   - relay (commission relais) : per_item, depuis finance_config\n *\n * Ces couts sont calcules a partir des moyennes finance_config faute de\n * factures detaillees au parcel pres. is_actual=TRUE car ils sont engages\n * de facon predictible.\n",
    " *   - relay (commission relais) : per_item, autorité cost_components\n *     (`commission_relais_kmf`), avec finance_config.standard en fallback legacy.\n *\n * LOT 1A-3 : aucune sélection implicite showroom. Tant qu'aucun contexte runtime\n * ne porte explicitement ce type de relais, le composant global est la vérité.\n * is_actual=TRUE car la commission est engagée de façon prévisible.\n",
)
replace_once(
    'services/cost-allocation/allocate.js',
    "    // Charger finance_config (commission relais standard, transport)\n    const fcRes = await client.query(\n      `SELECT commission_relais_standard_kmf\n       FROM finance_config LIMIT 1`\n    );\n    const fc = fcRes.rows[0] || {};\n    const commissionPerItem = Number(fc.commission_relais_standard_kmf) || 500;\n",
    "    // LOT 1A-3 — une priorité runtime explicite :\n    //   1. cost_components.commission_relais_kmf (autorité OWNED)\n    //   2. finance_config.commission_relais_standard_kmf (fallback legacy)\n    //   3. 500 KMF (fallback CURRENT)\n    // commission_relais_pct/showroom ne sont jamais devinés ici.\n    const relayCfgRes = await client.query(`\n      SELECT\n        (SELECT default_value\n           FROM cost_components\n          WHERE key = 'commission_relais_kmf'\n            AND is_active = TRUE\n            AND is_exceptional = FALSE\n            AND (active_from IS NULL OR active_from <= CURRENT_DATE)\n            AND (active_until IS NULL OR active_until >= CURRENT_DATE)\n          ORDER BY display_order, key\n          LIMIT 1) AS component_value,\n        (SELECT commission_relais_standard_kmf\n           FROM finance_config\n          WHERE id = 1) AS legacy_standard_value\n    `);\n    const relayCommission = resolveRelayCommissionCurrent(relayCfgRes.rows[0] || {});\n    const commissionPerItem = relayCommission.amount_kmf;\n",
)
replace_once(
    'services/cost-allocation/allocate.js',
    "         VALUES ($1,$2,$3,'relay',$4,'per_item','finance_config',TRUE,'medium')`,
    "         VALUES ($1,$2,$3,'relay',$4,'per_item',$5,TRUE,'medium')",
)
replace_once(
    'services/cost-allocation/allocate.js',
    "        [parcel.order_id, it.order_item_id, parcelId, amount]\n",
    "        [parcel.order_id, it.order_item_id, parcelId, amount, relayCommission.source]\n",
)
replace_once(
    'services/cost-allocation/allocate.js',
    "      allocations_count: allocations,\n      items_count: items.length,\n",
    "      allocations_count: allocations,\n      items_count: items.length,\n      relay_commission_kmf: commissionPerItem,\n      relay_commission_source: relayCommission.source,\n",
)

# Finance config : les trois anciens champs ne sont plus des éditeurs runtime.
replace_once(
    'routes/admin-finance-config.js',
    ' * @doctrine      resolve_before_behavior_change\n',
    ' * @doctrine      lot1a_relay_commission_one_runtime_truth\n',
)
replace_once(
    'routes/admin-finance-config.js',
    "  commission_relais_pct:       { type: 'decimal', group: 'ops',      label: 'Commission relais',         unit: '%',   min: 0, max: 100 },\n",
    '',
)
replace_once(
    'routes/admin-finance-config.js',
    "const ALLOWED_FIELDS = Object.keys(FIELD_SCHEMA);\n",
    "const ALLOWED_FIELDS = Object.keys(FIELD_SCHEMA);\n\nconst RETIRED_RELAY_COMMISSION_FIELDS = new Set([\n  'commission_relais_pct',\n  'commission_relais_standard_kmf',\n  'commission_relais_showroom_kmf',\n]);\n",
)
replace_once(
    'routes/admin-finance-config.js',
    "    const body = req.body || {};\n    const updates = {};\n\n    for (const field of ALLOWED_FIELDS) {\n",
    "    const body = req.body || {};\n    const retiredRelayFields = Object.keys(body).filter((field) => RETIRED_RELAY_COMMISSION_FIELDS.has(field));\n    if (retiredRelayFields.length) {\n      return res.status(410).json({\n        error: 'relay_commission_editor_retired',\n        retired_fields: retiredRelayFields,\n        source_of_truth: 'cost_components.commission_relais_kmf',\n        component_key: 'commission_relais_kmf',\n        message: 'LOT 1A-3 : la commission relais est éditée via le composant de coût canonique.',\n      });\n    }\n\n    const updates = {};\n\n    for (const field of ALLOWED_FIELDS) {\n",
)
replace_once(
    'routes/admin-finance-config.js',
    "      commission_relais_pct:        Number(cfg.commission_relais_pct || 0),\n",
    "      // Lecture legacy conservée pour compat/forensic ; ce champ n'est plus éditable.\n      commission_relais_pct:        Number(cfg.commission_relais_pct || 0),\n",
)
