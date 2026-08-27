'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text); }
function replaceOnce(file, from, to) {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file}: target not found: ${from.slice(0, 140)}`);
  write(file, text.replace(from, to));
}
function removeLineContaining(file, needle) {
  const text = read(file);
  const lines = text.split('\n');
  const next = lines.filter(line => !line.includes(needle));
  if (next.length === lines.length) throw new Error(`${file}: line not found for ${needle}`);
  write(file, next.join('\n'));
}
function addConsume(file, target, rationale = 'dépendance data cross-feature observée et gouvernée par O5') {
  let text = read(file);
  const start = text.indexOf('consumes: [');
  if (start < 0) throw new Error(`${file}: consumes array not found`);
  const end = text.indexOf('\n    ],', start);
  if (end < 0) throw new Error(`${file}: consumes array end not found`);
  const block = text.slice(start, end);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const already = new RegExp(`['\"]${escaped}(?:\\s|\\()`).test(block);
  if (already) return;
  const insertAt = text.indexOf('\n', start) + 1;
  text = text.slice(0, insertAt) + `      '${target} (${rationale})',\n` + text.slice(insertAt);
  write(file, text);
}

// ── 23 lectures cross-feature légitimes : rendre le contrat fidèle au runtime.
const dependencies = {
  'features/auth-identity.feature.js': ['catalog', 'logistics', 'loyalty', 'orders'],
  'features/business-rules.feature.js': ['auth-identity'],
  'features/customs.feature.js': ['catalog'],
  'features/documents.feature.js': ['catalog', 'logistics'],
  'features/economic-engine.feature.js': ['auth-identity', 'business-rules', 'customs', 'platform-ops', 'refunds'],
  'features/incident-management.feature.js': ['orders'],
  'features/logistics.feature.js': ['documents'],
  'features/loyalty.feature.js': ['economic-engine', 'orders'],
  'features/notifications.feature.js': ['auth-identity', 'logistics', 'orders'],
  'features/payments.feature.js': ['auth-identity'],
  'features/platform-ops.feature.js': ['documents'],
  'features/purchasing.feature.js': ['catalog'],
};
for (const [file, targets] of Object.entries(dependencies)) {
  for (const target of targets) addConsume(file, target);
}

// ── Écriture #1 : routes/admin-loyalty.js appartient au lifecycle loyalty.
replaceOnce('routes/admin-loyalty.js', '@role          dashboard-admin-loyalty', '@role          loyalty-admin-rewards');
replaceOnce('routes/admin-loyalty.js', '@domain        dashboard', '@domain        loyalty');
replaceOnce('routes/admin-loyalty.js', '@impact-areas  dashboard, admin-dashboard', '@impact-areas  loyalty, dashboard, admin-dashboard');

removeLineContaining('features/dashboard.feature.js', "'routes/admin-loyalty.js'");
removeLineContaining('features/dashboard.feature.js', "'loyalty_rewards: RW'");
for (const endpoint of [
  'GET /api/admin/loyalty/pending',
  'GET /api/admin/loyalty/history',
  'POST /api/admin/loyalty/reward/:id',
  'POST /api/admin/loyalty/skip/:id',
  'GET /api/admin/loyalty/stats',
]) removeLineContaining('features/dashboard.feature.js', endpoint);

replaceOnce(
  'features/loyalty.feature.js',
  "    routes: [\n      'routes/loyalty.js',",
  "    routes: [\n      'routes/loyalty.js',\n      'routes/admin-loyalty.js',"
);
replaceOnce(
  'features/loyalty.feature.js',
  "    exposes: [\n      'GET /api/loyalty/tiers',",
  "    exposes: [\n      'GET /api/loyalty/tiers',\n      'GET /api/admin/loyalty/pending',\n      'GET /api/admin/loyalty/history',\n      'POST /api/admin/loyalty/reward/:id',\n      'POST /api/admin/loyalty/skip/:id',\n      'GET /api/admin/loyalty/stats',"
);
replaceOnce(
  'features/loyalty.feature.js',
  "      'traitement admin des recompenses en attente (routes/admin-loyalty.js — actuellement @domain dashboard, ' +\n        'ecrit loyalty_rewards.status ; voir ONTOLOGY_GAP, non deplace dans ce lot)',\n",
  ''
);
replaceOnce(
  'features/loyalty.feature.js',
  "      'creation des recompenses \"pending\" (loyalty_rewards) au declenchement du seuil gros panier',",
  "      'creation et traitement des recompenses (pending/granted/skipped), y compris les actions admin',"
);
replaceOnce('features/loyalty.feature.js', 'authedRoutesDetected: 6,', 'authedRoutesDetected: 11,');
replaceOnce('features/loyalty.feature.js', 'totalRoutes: 7,', 'totalRoutes: 12,');
replaceOnce(
  'features/loyalty.feature.js',
  'note: "6/7 routes protégées. 1 route publique par design : GET /api/loyalty/tiers (grille des paliers de fidélité, information publique vitrine).",',
  'note: "11/12 routes protégées. 1 route publique par design : GET /api/loyalty/tiers (grille des paliers de fidélité, information publique vitrine).",'
);

// ── Écriture #2 : Dashboard ne supprime plus directement baskets/basket_items.
const cleanupService = `/**\n * @komerce-arch\n * @role          shared-cart-user-cleanup-boundary\n * @domain        shared-cart\n * @layer         service\n * @criticality   high\n * @inputs        caller_owned_executor, user_id\n * @outputs       deletion_result\n * @depends       none\n * @used-by       dashboard\n * @db-read       none\n * @db-write      basket_items, baskets\n * @db-txn        caller-owned\n * @doctrine      lifecycle_owner_persistence_boundary\n * @impact-areas  shared-cart, dashboard\n * @version       2026-08\n */\n\n'use strict';\n\nfunction requireExecutor(executor) {\n  if (!executor || typeof executor.query !== 'function') {\n    throw new TypeError('shared-cart-user-cleanup: executor.query requis');\n  }\n  return executor;\n}\n\nasync function deleteUserBasketData(executor, userId) {\n  const db = requireExecutor(executor);\n  await db.query(\n    'DELETE FROM basket_items WHERE basket_id IN (SELECT id FROM baskets WHERE user_id = $1::uuid)',\n    [userId],\n  );\n  return db.query('DELETE FROM baskets WHERE user_id = $1::uuid', [userId]);\n}\n\nmodule.exports = { deleteUserBasketData };\n`;
write('services/shared-cart-user-cleanup.js', cleanupService);

replaceOnce(
  'routes/admin/users.js',
  '@db-write      basket_items, baskets, order_status_history, recipients, scan_events, sms_log, wallet_transactions, wallets',
  '@db-write      order_status_history, recipients, scan_events, sms_log, wallet_transactions, wallets'
);
replaceOnce(
  'routes/admin/users.js',
  "const { detachUserFromIncidents } = require('../../services/incident-write-service');",
  "const { detachUserFromIncidents } = require('../../services/incident-write-service');\nconst { deleteUserBasketData } = require('../../services/shared-cart-user-cleanup');"
);
replaceOnce(
  'routes/admin/users.js',
  "        'DELETE FROM basket_items WHERE basket_id IN (SELECT id FROM baskets WHERE user_id = $1::uuid)',\n        'DELETE FROM baskets WHERE user_id = $1::uuid',",
  "        () => deleteUserBasketData(db, id),"
);

replaceOnce(
  'features/shared-cart.feature.js',
  "      'services/cart-share-service.js',",
  "      'services/cart-share-service.js',\n      'services/shared-cart-user-cleanup.js', // lifecycle-owned cleanup appelé par l'admin users"
);
replaceOnce(
  'features/shared-cart.feature.js',
  "    consumes: [",
  "    internalApi: [\n      { fn: 'deleteUserBasketData', file: 'services/shared-cart-user-cleanup.js' },\n    ],\n    consumes: ["
);
addConsume('features/dashboard.feature.js', 'shared-cart', 'suppression des paniers utilisateur via API interne lifecycle-owned');
removeLineContaining('features/dashboard.feature.js', "'basket_items: W'");
removeLineContaining('features/dashboard.feature.js', "'baskets: W'");

console.log('Debt Zero: 25 data dependencies closed at source');
