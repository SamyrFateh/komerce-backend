'use strict';

/**
 * Golden 1D-B: read-only provenance assessment.
 * Does not infer order-level final remittance from a holder balance or FIFO.
 * @param {{query: Function}} client transaction-aware PG client
 * @param {string} orderId
 */
async function assessCashOrderProvenance(client, orderId) {
  const { rows: collections } = await client.query(
    `SELECT cc.id, cc.order_id, cc.collected_by, cc.amount_kmf::text AS amount_kmf,
            cash_collection_market(cc.relais_id, cc.collected_by) AS market_id
       FROM cash_collections cc WHERE cc.order_id = $1 ORDER BY cc.confirmed_at, cc.id`,
    [orderId]
  );
  if (!collections.length) return { status: 'MISSING_COLLECTION', order_id: orderId, collections: [] };

  const ids = collections.map(c => c.id);
  const { rows: allocations } = await client.query(
    `SELECT a.collection_id, a.deposit_id, a.amount_kmf::text AS amount_kmf,
            a.allocation_basis, d.movement_kind, d.status
       FROM cash_deposit_allocations a
       JOIN cash_deposits d ON d.id = a.deposit_id
      WHERE a.collection_id = ANY($1::uuid[])
      ORDER BY a.collection_id, a.deposit_id`,
    [ids]
  );
  const byCollection = new Map();
  for (const a of allocations) {
    if (!byCollection.has(a.collection_id)) byCollection.set(a.collection_id, []);
    byCollection.get(a.collection_id).push({
      deposit_id: a.deposit_id, amount_kmf: Number(a.amount_kmf),
      basis: a.allocation_basis, movement_kind: a.movement_kind, deposit_status: a.status,
    });
  }
  return {
    status: 'FINAL_REMITTANCE_NOT_ATTRIBUTABLE',
    order_id: orderId,
    // A confirmed deposit allocation is not a proven multi-hop final receipt.
    final_remittance_proven_kmf: 0,
    collections: collections.map(c => ({
      collection_id: c.id, market_id: c.market_id, collected_by: c.collected_by,
      amount_kmf: Number(c.amount_kmf),
      allocations: byCollection.get(c.id) || [],
    })),
  };
}

module.exports = { assessCashOrderProvenance };
