'use strict';
/**
 * Génère `governance/data-ownership.json` — registre des rôles de données.
 *
 * Source : écritures RUNTIME SEULEMENT (scripts, DDL, migrations et schéma de
 * démarrage exclus, ce sont des technical-writers par nature), croisées avec
 * les arbitrages du 2026-07-29.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const load = (dir, sfx) => fs.readdirSync(path.join(ROOT, dir))
  .filter(f => f.endsWith(sfx) && !f.startsWith('_'))
  .map(f => { const m = { ...require(path.join(ROOT, dir, f)) }; m._file = `${dir}/${f}`; return m; });

const manifests = [...load('features', '.feature.js'), ...load('capabilities', '.capability.js')];

const RUNTIME_GROUPS = new Set(['services', 'routes', 'middleware', 'utils', 'validators', 'core', 'bootstrap']);
const TECHNICAL_FILES = new Set(['bootstrap/startup-migrations.js', 'bootstrap/crons.js']);

const owner = new Map();
for (const m of manifests) {
  for (const [g, fl] of Object.entries(m.files || {})) {
    if (!RUNTIME_GROUPS.has(g) || !Array.isArray(fl)) continue;
    for (const f of fl) {
      const k = String(f).split(path.sep).join('/');
      if (/\.js$/.test(k)) owner.set(k, m.name || m._file);
    }
  }
}

const REAL_TABLES = new Set(
  (fs.readFileSync(path.join(ROOT, 'schema_railway.sql'), 'utf8')
    .match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_0-9]+)"?/gi) || [])
    .map(x => x.replace(/.*[ .]/, '').replace(/"/g, '').toLowerCase())
);

const WRITE_RX = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi;

const writes = new Map(); // table → Map(feature → Set(file))
for (const [file, feature] of owner) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  WRITE_RX.lastIndex = 0;
  let m;
  while ((m = WRITE_RX.exec(src)) !== null) {
    const table = m[2].toLowerCase();
    if (!REAL_TABLES.has(table)) continue;
    if (!writes.has(table)) writes.set(table, new Map());
    if (!writes.get(table).has(feature)) writes.get(table).set(feature, new Set());
    writes.get(table).get(feature).add(file);
  }
}

// Propriétaires arbitrés : quand la mesure seule ne tranche pas, la décision
// de gouvernance prime — et doit être écrite ici, pas devinée.
const ARBITRATED_OWNER = {
  users: 'auth-identity',                    // arbitrage A
  business_rules: 'business-rules',          // arbitrage B
  business_rules_history: 'business-rules',  // arbitrage B
  finance_config: 'economic-engine',         // arbitrage B
  charges: 'economic-engine',                // arbitrage B
  economic_snapshots: 'economic-engine',     // arbitrage B
  products: 'catalog',                       // arbitrage D
  catalog_media: 'catalog',
  product_variants: 'catalog',
  product_skus: 'catalog',
  product_sku_media: 'catalog',
  sourcing_candidates: 'sourcing',           // arbitrage D (sens inverse)
  sourcing_candidate_events: 'sourcing',
  orders: 'orders',
  order_items: 'orders',
  order_status_history: 'orders',
  parcels: 'logistics',
  parcel_items: 'logistics',
  scans: 'logistics',
  pickup_reveal_codes: 'logistics',
  pickup_print_tokens: 'logistics',
  incidents: 'incident-management',
  alerts: 'notifications',
  revoked_tokens: 'auth-identity',
  // ── Propositions issues de décisions déjà écrites dans le dépôt ───────────
  purchase_orders: 'purchasing',          // Lot O1.4 : purchasing possède l'engagement fournisseur
  cart_shares: 'shared-cart',
  baskets: 'shared-cart',
  basket_items: 'shared-cart',
  recipients: 'orders',
  invoices: 'orders',
  order_comments: 'orders',
  sms_log: 'notifications',
  notification_log: 'notifications',
  price_history: 'economic-engine',
  stripe_events_processed: 'payments',
  loyalty_rewards: 'loyalty',
  relais: 'logistics',
  scan_events: 'logistics',
  wallets: 'wallet',
  wallet_transactions: 'wallet',
  wallet_credit_lots: 'wallet',
  wallet_consumptions: 'wallet',
};

// `dashboard` ne peut jamais être propriétaire : sa propre classification pose
// ownsTables:false — elle agrège la vérité des autres, elle ne la possède pas.
const NEVER_OWNER = new Set(['dashboard', 'platform-ops', 'infrastructure']);

// Writers techniques : le fichier ne porte aucune décision métier.
const isTechnical = file => TECHNICAL_FILES.has(file);

const tables = [];
for (const [table, byFeat] of [...writes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const feats = [...byFeat.keys()];
  const resolvedOwner = ARBITRATED_OWNER[table]
    || (feats.length === 1 && !NEVER_OWNER.has(feats[0]) ? feats[0] : null);

  const roles = feats.map(f => {
    const files = [...byFeat.get(f)].sort();
    const allTechnical = files.every(isTechnical);
    let role;
    if (f === resolvedOwner) role = 'owner';
    else if (allTechnical) role = 'technical-writer';
    else role = 'authorized-writer';
    return { feature: f, role, files };
  }).sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.feature.localeCompare(b.feature)));

  tables.push({
    table,
    owner: resolvedOwner,
    ownerSource: ARBITRATED_OWNER[table] ? 'arbitrage-2026-07-29' : (feats.length === 1 ? 'writer-unique' : 'NON-ARBITRÉ'),
    roles,
  });
}

const unarbitrated = tables.filter(t => !t.owner);
const contested = tables.filter(t => t.roles.filter(r => r.role !== 'technical-writer').length > 1);

const doc = {
  _doctrine: 'Rôles de données — modèle arrêté le 2026-07-29. Le but n\'est pas qu\'un seul fichier écrive physiquement, mais qu\'une seule feature possède la donnée et contrôle son protocole de mutation.',
  _roles: {
    owner: 'Une seule feature. Définit le schéma, les invariants et le protocole de mutation. Doit exposer une API interne pour toute mutation par un tiers.',
    'authorized-writer': 'Feature autorisée à muter, via l\'API interne du propriétaire ou par exception nominative sur colonnes. Doit déclarer via: et columns:.',
    'technical-writer': 'Écriture ne portant aucune décision métier : DDL de démarrage, migration, backfill, purge planifiée, simulateur. Interdit de porter une règle.',
  },
  _method: 'Écritures RUNTIME seulement. Exclus du calcul : scripts/**, migrations/**, db/**, tests/**, bootstrap/startup-migrations.js. Filtre de vocabulaire sur les 103 tables de schema_railway.sql.',
  _generatedAt: new Date().toISOString().slice(0, 10),
  _summary: {
    tablesWrittenAtRuntime: tables.length,
    tablesWithMultipleNonTechnicalWriters: contested.length,
    tablesWithoutArbitratedOwner: unarbitrated.length,
  },
  tables,
};

fs.writeFileSync(path.join(ROOT, 'governance/data-ownership.json'), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

console.log(`Tables écrites en runtime          : ${tables.length}`);
console.log(`Tables à writers multiples (non tech.) : ${contested.length}`);
console.log(`Tables sans propriétaire arbitré   : ${unarbitrated.length}`);
if (unarbitrated.length) {
  console.log('\n--- À arbitrer ---');
  unarbitrated.forEach(t => console.log(`   ${t.table.padEnd(34)} ${t.roles.map(r => r.feature).join(', ')}`));
}
console.log('\n--- Tables contestées après arbitrage ---');
contested.forEach(t => console.log(`   ${t.table.padEnd(30)} owner=${String(t.owner).padEnd(20)} autres: ${t.roles.filter(r => r.role !== 'owner').map(r => `${r.feature}[${r.role}]`).join(', ')}`));
