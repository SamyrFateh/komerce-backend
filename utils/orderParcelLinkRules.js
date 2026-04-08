/**
 * KOMERCE — Order ↔ Parcel Link Rules
 *
 * Les deux cycles sont INDÉPENDANTS :
 *   order.status  = cycle business   (confirmed → ordered → preparation → in_transit → available → collected | cancelled)
 *   parcel.status = cycle logistique (draft → preparation → shipped → in_transit → available → collected | cancelled)
 *
 * Seuls les événements définis ici peuvent provoquer une transition sur orders.status.
 * Aucune déduction automatique hors de ces règles.
 *
 * Règles autorisées :
 *   R1 — Tous les colis actifs = collected
 *        → orders.status = 'collected' (livraison totale confirmée)
 *
 *   R2 — Tous les colis = cancelled (même les actifs)
 *        → orders.computed_status = 'parcels_all_cancelled' (signal, pas de changement du status business)
 *
 *   R3 — Premier colis expédié (shipped | in_transit | available | collected)
 *        → orders.status = 'in_transit', uniquement si l'ordre est encore en ['confirmed', 'ordered', 'preparation']
 *
 * @param {string} order_id
 * @param {object} db - instance pg pool
 * @returns {string|null} code de la règle déclenchée, ou null
 */
async function evaluateOrderParcelLinkRules(order_id, db) {
  // Snapshot complet des colis de la commande
  const { rows: allParcels } = await db.query(
    'SELECT status FROM parcels WHERE order_id = $1',
    [order_id]
  );

  if (!allParcels.length) return null;

  // Snapshot de la commande
  const { rows: orderRows } = await db.query(
    'SELECT id, status FROM orders WHERE id = $1',
    [order_id]
  );
  if (!orderRows.length) return null;
  const order = orderRows[0];

  const activeParcels = allParcels.filter(p => p.status !== 'cancelled');

  // ── R1 — Tous les colis actifs sont collectés ──────────────────────────
  if (activeParcels.length > 0 && activeParcels.every(p => p.status === 'collected')) {
    await db.query(
      `UPDATE orders
          SET status = 'collected', computed_status = 'collected', updated_at = NOW()
        WHERE id = $1`,
      [order_id]
    );
    return 'R1_ALL_COLLECTED';
  }

  // ── R2 — Tous les colis (y compris actifs) sont annulés ───────────────
  if (allParcels.every(p => p.status === 'cancelled') && order.status !== 'collected') {
    await db.query(
      `UPDATE orders
          SET computed_status = 'parcels_all_cancelled', updated_at = NOW()
        WHERE id = $1`,
      [order_id]
    );
    return 'R2_ALL_PARCELS_CANCELLED';
  }

  // ── R3 — Premier colis expédié / en transit ────────────────────────────
  const SHIPPED_OR_BEYOND = ['shipped', 'in_transit', 'available', 'collected'];
  const hasShippedParcel = activeParcels.some(p => SHIPPED_OR_BEYOND.includes(p.status));
  const orderInEarlyStage = ['confirmed', 'ordered', 'preparation'].includes(order.status);

  if (hasShippedParcel && orderInEarlyStage) {
    await db.query(
      `UPDATE orders
          SET status = 'in_transit', updated_at = NOW()
        WHERE id = $1`,
      [order_id]
    );
    return 'R3_FIRST_PARCEL_SHIPPED';
  }

  return null;
}

module.exports = { evaluateOrderParcelLinkRules };
