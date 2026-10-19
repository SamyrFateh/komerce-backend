/**
 * @komerce-arch-lite
 * @role          rct1-checkout-readiness
 * @domain        orders
 * @layer         script
 * @owner         backend-core
 * @purpose       Diagnostiquer en lecture seule les prerequis produit et relais avant checkout RCT1.
 * @impact-areas  staging-only, orders, recette
 */
'use strict';

// Ne cree rien et ne declenche jamais le checkout. Tant que le checkout
// n'assigne pas atomiquement simulation_scope avant COMMIT, apply est refuse.
const { PRODUCTS } = require('./rct1-install-plan');
const REQUIRED_REFS = Object.values(PRODUCTS).map(p => p.ref);
async function inspect({ db }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows: products } = await client.query(
      'SELECT product_ref, id, is_active, is_available, lifecycle_status, price_kmf FROM products WHERE product_ref = ANY($1::text[]) ORDER BY product_ref',
      [REQUIRED_REFS]
    );
    const { rows: relays } = await client.query(
      "SELECT r.id, r.name, m.code AS market_code, m.lifecycle_status AS market_status FROM relais r JOIN markets m ON m.id=r.market_id WHERE r.is_active=TRUE AND m.code = ANY($1::text[]) ORDER BY m.code, r.name",
      [['KM', 'CM', 'CG']]
    );
    const { rows: orders } = await client.query(
      "SELECT reference, simulation_scope FROM orders WHERE reference LIKE 'RCT1-%' ORDER BY reference"
    );
    const productByRef = new Map(products.map(p => [p.product_ref, p]));
    const missingProducts = REQUIRED_REFS.filter(ref => !productByRef.has(ref));
    const marketCodes = new Set(relays.filter(r => r.market_status === 'ACTIVE').map(r => r.market_code));
    const missingMarkets = ['KM', 'CM', 'CG'].filter(x => !marketCodes.has(x));
    const unscoped = orders.filter(o => o.simulation_scope !== 'RCT1').map(o => o.reference);
    await client.query('ROLLBACK');
    return {
      mode: 'READ_ONLY', scope: 'RCT1', products, relays, orders,
      missing_products: missingProducts, missing_markets_with_active_relay: missingMarkets,
      unscoped_orders: unscoped,
      checkout_apply_allowed: false,
      blocker: 'Atomic checkout simulation_scope assignment before COMMIT not yet proven',
      next: 'Finish sourcing/catalog approvals, then establish staging-only atomic checkout scope before any created RCT1 order',
    };
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { client.release(); }
}
async function main() {
  if (process.argv.includes('--apply')) throw Error('RCT1_CHECKOUT_APPLY_FORBIDDEN');
  const db = require('../../db');
  try { process.stdout.write(JSON.stringify(await inspect({ db }), null, 2)+'\n'); }
  finally { await db.pool.end(); }
}
if (require.main === module) main().catch(e => { process.stderr.write('RCT1 READINESS REFUS: '+e.message+'\n'); process.exitCode=1; });
module.exports = { inspect };
