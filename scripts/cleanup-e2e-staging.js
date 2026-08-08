/**
 * scripts/cleanup-e2e-staging.js
 *
 * Supprime toutes les données laissées par les suites e2e-api
 * en cas d'interruption (Ctrl+C, crash, timeout).
 *
 * Les tests taguent leurs données avec le préfixe 'e2e' (voir
 * tests/helpers/e2eDbKit.js::RUN_TAG = `e2e${timestamp}${hex}`).
 *
 * Usage :
 *   node scripts/cleanup-e2e-staging.js           -- aperçu (dry-run)
 *   node scripts/cleanup-e2e-staging.js --delete  -- suppression réelle
 *
 * Toujours lancer sans --delete d'abord pour vérifier ce qui sera supprimé.
 */

'use strict';

const db = require('../db');

const DRY_RUN = !process.argv.includes('--delete');

if (DRY_RUN) {
  console.log('DRY-RUN — aucune suppression. Ajoutez --delete pour supprimer réellement.\n');
} else {
  console.log('⚠️  MODE SUPPRESSION — les données e2e vont être effacées.\n');
}

async function count(table, where, params = []) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return rows[0].n;
}

async function del(table, where, params = []) {
  if (DRY_RUN) return 0;
  const { rowCount } = await db.query(`DELETE FROM ${table} WHERE ${where}`, params);
  return rowCount;
}

async function main() {
  // ── Identifier les user_id e2e ───────────────────────────────────────────
  const { rows: e2eUsers } = await db.query(
    `SELECT id, email FROM users WHERE email LIKE 'e2e%@komerce.test' ORDER BY created_at`
  );
  const e2eIds = e2eUsers.map((u) => u.id);

  console.log(`Utilisateurs e2e trouvés : ${e2eUsers.length}`);
  e2eUsers.forEach((u) => console.log(`  ${u.email}`));

  if (e2eUsers.length === 0) {
    console.log('\nAucune donnée e2e à nettoyer.');
    await db.end?.();
    return;
  }

  // ── Compter / supprimer en cascade ──────────────────────────────────────
  const placeholder = e2eIds.map((_, i) => `$${i + 1}`).join(',');

  // Shared carts
  const scRows = await db.query(
    `SELECT id FROM shared_carts WHERE organizer_user_id IN (${placeholder})`, e2eIds
  );
  const scIds = scRows.rows.map((r) => r.id);
  if (scIds.length) {
    const scPh = scIds.map((_, i) => `$${i + 1}`).join(',');
    const sciCount = await count('shared_cart_items', `shared_cart_id IN (${scPh})`, scIds);
    console.log(`\nshared_cart_items : ${sciCount}`);
    await del('shared_cart_items', `shared_cart_id IN (${scPh})`, scIds);
    const scEvCount = await count('shared_cart_events', `shared_cart_id IN (${scPh})`, scIds);
    console.log(`shared_cart_events : ${scEvCount}`);
    await del('shared_cart_events', `shared_cart_id IN (${scPh})`, scIds);
  }
  const scCount = await count('shared_carts', `organizer_user_id IN (${placeholder})`, e2eIds);
  console.log(`shared_carts : ${scCount}`);
  await del('shared_carts', `organizer_user_id IN (${placeholder})`, e2eIds);

  // Orders
  const ordRows = await db.query(
    `SELECT id FROM orders WHERE user_id IN (${placeholder})`, e2eIds
  );
  const ordIds = ordRows.rows.map((r) => r.id);
  if (ordIds.length) {
    const ordPh = ordIds.map((_, i) => `$${i + 1}`).join(',');
    const oiCount = await count('order_items', `order_id IN (${ordPh})`, ordIds);
    console.log(`order_items : ${oiCount}`);
    await del('order_items', `order_id IN (${ordPh})`, ordIds);
    const paymCount = await count('payments', `order_id IN (${ordPh})`, ordIds);
    console.log(`payments : ${paymCount}`);
    await del('payments', `order_id IN (${ordPh})`, ordIds);
  }
  const ordCount = await count('orders', `user_id IN (${placeholder})`, e2eIds);
  console.log(`orders : ${ordCount}`);
  await del('orders', `user_id IN (${placeholder})`, e2eIds);

  // Wallet
  const wevCount = await count('wallet_events', `user_id IN (${placeholder})`, e2eIds);
  console.log(`wallet_events : ${wevCount}`);
  await del('wallet_events', `user_id IN (${placeholder})`, e2eIds);

  // Purchasing
  const poCount = await count('purchase_orders', `created_by IN (${placeholder})`, e2eIds);
  console.log(`purchase_orders : ${poCount}`);
  await del('purchase_orders', `created_by IN (${placeholder})`, e2eIds);

  // Relais e2e
  const relCount = await count('relais', `name LIKE 'E2E%'`, []);
  console.log(`relais E2E : ${relCount}`);
  await del('relais', `name LIKE 'E2E%'`);

  // Utilisateurs e2e (en dernier — FK)
  console.log(`users e2e : ${e2eUsers.length}`);
  await del('users', `email LIKE 'e2e%@komerce.test'`);

  console.log(DRY_RUN
    ? '\n-- DRY-RUN terminé. Relancez avec --delete pour supprimer.'
    : '\n✓ Nettoyage terminé.'
  );

  await db.end?.();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
