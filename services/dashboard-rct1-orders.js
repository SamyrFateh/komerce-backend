/**
 * @komerce-arch-lite
 * @role          rct1-orders-readonly-projection
 * @domain        admin-dashboard
 * @owner         backend-core
 * @layer         service
 * @purpose       Liste exhaustive des commandes fictives RCT1, jamais les files opérationnelles réelles.
 * @db-read       orders, markets
 * @db-write      none
 * @db-txn        none
 */
'use strict';
const db = require('../db');

async function listRct1Orders({ marketCode = null } = {}) {
  if (marketCode != null && !/^(KM|CM|CG|DJ)$/.test(marketCode)) {
    const error = new Error('Marché de recette non autorisé');
    error.status = 400;
    throw error;
  }
  const { rows } = await db.query(
    `SELECT o.reference, o.status, o.payment_status, o.total_kmf,
            o.simulation_scope, m.code AS market_code
       FROM orders o
       JOIN markets m ON m.id = o.market_id
      WHERE o.simulation_scope = $1
        AND ($2::text IS NULL OR m.code = $2)
      ORDER BY o.created_at ASC, o.reference ASC`,
    ['RCT1', marketCode],
  );
  return Object.freeze({
    mode: 'RCT1',
    simulation_scope: 'RCT1',
    data_quality: { warnings: ['Données fictives — RCT1 : exclues de l’activité réelle.'] },
    total: rows.length,
    orders: rows,
  });
}
module.exports = { listRct1Orders };
