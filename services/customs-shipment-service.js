/**
 * @komerce-arch
 * @role          customs-shipment-service
 * @domain        customs
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/cost-allocation/index.js, services/documents/customs-invoice.js, services/parcel-mutation-service.js
 * @used-by       routes/admin-customs-shipments.js, services/order-status-machine.js
 * @db-read       customs_effective_rates, customs_shipment_parcels, customs_shipments, order_items, orders, parcels, products
 * @db-write      customs_shipment_parcels, customs_shipments, orders
 * @db-write-via:parcel-mutation-service parcels
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

const { markCustomsCleared } = require('./parcel-mutation-service');

/**
 * customs-shipment-service.js
 *
 * Logique métier extraite de routes/admin-customs-shipments.js (R8).
 *
 * Exports :
 *   allocateCustoms(shipment, parcels)
 *     → Array<{parcel_id, cif_kmf, weight_kg, customs_share_kmf, allocation_basis}>
 *     Fonction pure — pas de DB.
 *
 *   propagateCostDouane(client, parcelIds)
 *     → void
 *     Recalcule orders.cost_douane_kmf + margin_real_pct pour les orders liées.
 *     Doit être appelé DANS une transaction existante.
 *
 *   listShipments(db, { from?, to?, active? })
 *     → { shipments }
 *
 *   getEffectiveRates(db)
 *     → { rates, fallback_rate_pct }
 *
 *   getShipment(db, id)
 *     → { shipment, parcels }
 *     ✗ throws err.status=404 si introuvable
 *
 *   createShipment(db, body, userId)
 *     → { shipment, allocations }
 *     Transaction complète (INSERT envoi + ventilation + propagation).
 *
 *   updateShipment(db, id, body)
 *     → { shipment }
 *     ✗ throws err.status=400 (aucun champ) | 404
 *
 *   deactivateShipment(db, id, reason?)
 *     → { shipment, message, parcels_reset }
 *     ✗ throws err.status=404
 *
 *   activateShipment(db, id, parcelIds)
 *     → { shipment, allocations, message }
 *     ✗ throws err.status=404
 *
 *   deleteShipment(db, id)
 *     → { deleted, id, parcels_recalculated }
 *     ✗ throws err.status=404
 */

// ── Helpers purs ──────────────────────────────────────────────────────────────

/**
 * Calcule la part de douane de chaque colis selon la méthode choisie.
 *
 * @param {{ customs_paid_kmf, allocation_method?, allocation_config? }} shipment
 * @param {Array<{ parcel_id, cif_kmf, weight_kg, volume_m3? }>} parcels
 * @returns {Array<{ parcel_id, cif_kmf, weight_kg, customs_share_kmf, allocation_basis }>}
 */
function allocateCustoms(shipment, parcels) {
  const total  = Number(shipment.customs_paid_kmf) || 0;
  const method = shipment.allocation_method || 'by_cif_value';
  const cfg    = shipment.allocation_config  || {};

  if (!parcels.length || total === 0) return [];

  // manual : pas de calcul automatique
  if (method === 'manual') {
    return parcels.map(p => ({
      ...p,
      customs_share_kmf: 0,
      allocation_basis:  'manual',
    }));
  }

  function pickMetric(p, metric) {
    if (metric === 'by_cif_value') return Number(p.cif_kmf)   || 0;
    if (metric === 'by_weight')    return Number(p.weight_kg)  || 0;
    if (metric === 'by_volume')    return Number(p.volume_m3)  || 0;
    return 0;
  }

  let weights;
  if (method === 'mixed') {
    const cifW   = Number(cfg.cif)    || 0.5;
    const wgtW   = Number(cfg.weight) || 0.5;
    const cifSum = parcels.reduce((s, p) => s + pickMetric(p, 'by_cif_value'), 0);
    const wgtSum = parcels.reduce((s, p) => s + pickMetric(p, 'by_weight'),    0);
    weights = parcels.map(p => {
      const cifPart = cifSum > 0 ? pickMetric(p, 'by_cif_value') / cifSum : 0;
      const wgtPart = wgtSum > 0 ? pickMetric(p, 'by_weight')    / wgtSum : 0;
      return cifPart * cifW + wgtPart * wgtW;
    });
  } else {
    const values = parcels.map(p => pickMetric(p, method));
    const sum    = values.reduce((s, v) => s + v, 0);
    weights = sum > 0 ? values.map(v => v / sum) : parcels.map(() => 1 / parcels.length);
  }

  return parcels.map((p, i) => ({
    ...p,
    customs_share_kmf: Math.round((total * weights[i]) * 100) / 100,
    allocation_basis:  method,
  }));
}

/**
 * Propage customs_share_kmf → orders.cost_douane_kmf + margin_real_pct.
 * À appeler dans une transaction existante.
 *
 * @param {import('pg').PoolClient} client
 * @param {string[]} parcelIds
 */
async function propagateCostDouane(client, parcelIds) {
  if (!Array.isArray(parcelIds) || parcelIds.length === 0) return;

  const { rows: ordersToUpdate } = await client.query(
    `SELECT DISTINCT order_id FROM parcels WHERE id = ANY($1::uuid[])`,
    [parcelIds]
  );
  if (!ordersToUpdate.length) return;
  const orderIds = ordersToUpdate.map(r => r.order_id);

  await client.query(
    `UPDATE orders o
        SET cost_douane_kmf = COALESCE((
              SELECT SUM(csp.customs_share_kmf)
                FROM customs_shipment_parcels csp
                JOIN parcels p ON p.id = csp.parcel_id
                JOIN customs_shipments cs ON cs.id = csp.shipment_id
               WHERE p.order_id = o.id
                 AND cs.is_active = TRUE
            ), 0)
      WHERE o.id = ANY($1::uuid[])`,
    [orderIds]
  );

  await client.query(
    `UPDATE orders
        SET margin_real_pct = CASE
              WHEN total_kmf > 0 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0)
                THEN ROUND(((total_kmf - COALESCE(cost_transport_kmf,0) - COALESCE(cost_douane_kmf,0))::numeric
                            / total_kmf * 100)::numeric, 2)
              ELSE margin_real_pct
            END
      WHERE id = ANY($1::uuid[])`,
    [orderIds]
  );
}

// ── Lecture ───────────────────────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} db
 * @param {{ from?: string, to?: string, active?: string }} filters
 */
async function listShipments(db, { from, to, active } = {}) {
  const conds  = ['1=1'];
  const params = [];
  let pi = 1;

  if (from)             { conds.push(`shipment_date >= $${pi++}`); params.push(from); }
  if (to)               { conds.push(`shipment_date <= $${pi++}`); params.push(to); }
  if (active !== undefined) {
    conds.push(`is_active = $${pi++}`);
    params.push(active === 'true' || active === '1');
  }

  const { rows } = await db.query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM customs_shipment_parcels WHERE shipment_id = s.id) AS nb_parcels_linked
       FROM customs_shipments s
      WHERE ${conds.join(' AND ')}
      ORDER BY shipment_date DESC, created_at DESC
      LIMIT 500`,
    params
  );
  return { shipments: rows };
}

/**
 * @param {import('pg').Pool} db
 */
async function getEffectiveRates(db) {
  const { rows } = await db.query(`SELECT * FROM customs_effective_rates`);
  const out = {};
  rows.forEach(r => { out[r.period] = r; });
  return { rates: out, fallback_rate_pct: 15 };
}

/**
 * @param {import('pg').Pool} db
 * @param {string} id
 * ✗ throws err.status=404
 */
async function getShipment(db, id) {
  const { rows: [shipment] } = await db.query(
    `SELECT * FROM customs_shipments WHERE id = $1`, [id]
  );
  if (!shipment) {
    const e = new Error('Shipment not found'); e.status = 404; throw e;
  }

  const { rows: parcels } = await db.query(
    `SELECT csp.*, p.reference AS parcel_ref, p.status AS parcel_status,
            o.reference AS order_ref, o.client_name
       FROM customs_shipment_parcels csp
       JOIN parcels p ON p.id = csp.parcel_id
       LEFT JOIN orders o ON o.id = p.order_id
      WHERE csp.shipment_id = $1
      ORDER BY p.reference`,
    [id]
  );
  return { shipment, parcels };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Insère les lignes de ventilation et propage vers orders (dans tx). */
async function _insertAllocations(client, shipmentId, shipmentMeta, parcelIds) {
  if (!Array.isArray(parcelIds) || parcelIds.length === 0) return [];

  const { rows: parcelData } = await client.query(
    `SELECT p.id, p.reference,
            COALESCE(p.customs_value_kmf, o.total_kmf) AS cif_kmf,
            COALESCE(p.customs_weight_kg,
              (SELECT SUM(COALESCE(pr.weight_kg,0) * oi.quantity)
                 FROM order_items oi
                 JOIN products pr ON pr.id = oi.product_id
                WHERE oi.order_id = p.order_id)) AS weight_kg,
            COALESCE(p.volume_cm3,
              (SELECT SUM(COALESCE(pr.volume_cm3,0) * oi.quantity)
                 FROM order_items oi
                 JOIN products pr ON pr.id = oi.product_id
                WHERE oi.order_id = p.order_id)) AS volume_cm3
       FROM parcels p
       LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.id = ANY($1::uuid[])`,
    [parcelIds]
  );

  // volume_m3 : requis par allocateCustoms (méthode 'by_volume', doctrine fret
  // maritime au m³ — cf. migration 095). cm3 → m3.
  const allocations = allocateCustoms(
    shipmentMeta,
    parcelData.map(p => ({
      parcel_id:  p.id,
      cif_kmf:    Number(p.cif_kmf)    || 0,
      weight_kg:  Number(p.weight_kg)  || 0,
      volume_m3:  (Number(p.volume_cm3) || 0) / 1e6,
    }))
  );
  const volumeByParcelId = new Map(parcelData.map(p => [p.id, Number(p.volume_cm3) || 0]));

  for (const a of allocations) {
    await client.query(
      `INSERT INTO customs_shipment_parcels
         (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg, parcel_volume_cm3,
          customs_share_kmf, allocation_basis)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (shipment_id, parcel_id) DO UPDATE
         SET customs_share_kmf = EXCLUDED.customs_share_kmf,
             allocation_basis  = EXCLUDED.allocation_basis,
             parcel_volume_cm3 = EXCLUDED.parcel_volume_cm3,
             updated_at        = NOW()`,
      [
        shipmentId, a.parcel_id, a.cif_kmf, a.weight_kg,
        volumeByParcelId.get(a.parcel_id) || null,
        a.customs_share_kmf, a.allocation_basis,
      ]
    );
  }

  await propagateCostDouane(client, allocations.map(a => a.parcel_id));
  return allocations;
}

/**
 * Crée un envoi douane + ventilation initiale (transaction complète).
 *
 * @param {import('pg').Pool} db
 * @param {object} body
 * @param {string} userId
 * @returns {{ shipment, allocations }}
 * ✗ throws err.status=400 si champs requis manquants
 */
async function createShipment(db, body, userId) {
  const {
    reference, shipment_date, transitaire_name, transport_mode,
    cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
    nb_parcels, allocation_method, allocation_config, notes,
    supplier_id, parcel_ids,
  } = body;

  // customs_paid_kmf n'est plus requis à la création (workflow en deux étapes)
  // Il est saisi lors de la déclaration (declareCustomsPayment).
  if (!reference || !shipment_date || !cif_value_kmf) {
    const e = new Error('Champs requis: reference, shipment_date, cif_value_kmf');
    e.status = 400; throw e;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [shipment] } = await client.query(
      `INSERT INTO customs_shipments
        (reference, shipment_date, transitaire_name, transport_mode,
         cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
         nb_parcels, allocation_method, allocation_config, notes, supplier_id, created_by,
         status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')
       RETURNING *`,
      [
        reference, shipment_date, transitaire_name || null, transport_mode || null,
        cif_value_kmf,
        customs_paid_kmf != null ? customs_paid_kmf : null,
        freight_kmf || null, total_weight_kg || null,
        nb_parcels || null, allocation_method || 'by_cif_value',
        allocation_config ? JSON.stringify(allocation_config) : null,
        notes || null, supplier_id || null, userId,
      ]
    );

    // Ventilation immédiate uniquement si le montant est déjà fourni
    // (rétrocompatibilité : ancien flow où tout était saisi d'un coup)
    let allocations = [];
    if (customs_paid_kmf != null && Number(customs_paid_kmf) > 0 && parcel_ids?.length) {
      allocations = await _insertAllocations(
        client,
        shipment.id,
        { customs_paid_kmf, allocation_method: allocation_method || 'by_cif_value', allocation_config },
        parcel_ids
      );
      // Marquer comme déclaré immédiatement
      await client.query(
        `UPDATE customs_shipments
            SET status = 'declared', declared_at = NOW(), declared_by = $2
          WHERE id = $1`,
        [shipment.id, userId]
      );
    } else if (parcel_ids?.length) {
      // Rattacher les colis sans ventilation (montant inconnu pour l'instant)
      for (const pid of parcel_ids) {
        await client.query(
          `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [shipment.id, pid]
        );
      }
    }

    await client.query('COMMIT');
    return { shipment, allocations };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Met à jour les métadonnées d'un envoi (sans recalcul de ventilation).
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * @param {object} body
 * @returns {{ shipment }}
 * ✗ throws err.status=400 | 404
 */
async function updateShipment(db, id, body) {
  const allowed = [
    'reference', 'shipment_date', 'transitaire_name', 'transport_mode',
    'cif_value_kmf', 'customs_paid_kmf', 'freight_kmf', 'total_weight_kg',
    'nb_parcels', 'allocation_method', 'allocation_config', 'notes', 'supplier_id',
  ];
  const updates = [];
  const params  = [];
  let pi = 1;
  for (const k of allowed) {
    if (body[k] !== undefined) {
      updates.push(`${k} = $${pi++}`);
      params.push(body[k]);
    }
  }
  if (!updates.length) {
    const e = new Error('Aucun champ à modifier'); e.status = 400; throw e;
  }
  params.push(id);

  const { rows: [shipment] } = await db.query(
    `UPDATE customs_shipments SET ${updates.join(', ')} WHERE id = $${pi} RETURNING *`,
    params
  );
  if (!shipment) {
    const e = new Error('Shipment not found'); e.status = 404; throw e;
  }
  return { shipment };
}

/**
 * Désactive un envoi + retire la ventilation + recalcule marges.
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * @param {string?} reason
 * ✗ throws err.status=404
 */
async function deactivateShipment(db, id, reason) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [shipment] } = await client.query(
      `UPDATE customs_shipments
          SET is_active = FALSE,
              deactivated_at = NOW(),
              deactivated_reason = $2
        WHERE id = $1
        RETURNING *`,
      [id, reason || null]
    );
    if (!shipment) {
      await client.query('ROLLBACK');
      const e = new Error('Shipment not found'); e.status = 404; throw e;
    }

    const { rows: removed } = await client.query(
      `DELETE FROM customs_shipment_parcels WHERE shipment_id = $1 RETURNING parcel_id`,
      [id]
    );
    await propagateCostDouane(client, removed.map(r => r.parcel_id));

    await client.query('COMMIT');
    return {
      shipment,
      message:       `Envoi désactivé. Ventilation retirée de ${removed.length} colis. Marges recalculées.`,
      parcels_reset: removed.length,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Réactive un envoi + recalcule la ventilation pour les colis fournis.
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * @param {string[]} parcelIds
 * ✗ throws err.status=404
 */
async function activateShipment(db, id, parcelIds) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [shipment] } = await client.query(
      `UPDATE customs_shipments
          SET is_active = TRUE,
              deactivated_at = NULL,
              deactivated_reason = NULL
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    if (!shipment) {
      await client.query('ROLLBACK');
      const e = new Error('Shipment not found'); e.status = 404; throw e;
    }

    const allocations = await _insertAllocations(client, shipment.id, shipment, parcelIds || []);

    await client.query('COMMIT');
    return {
      shipment,
      allocations,
      message: `Envoi réactivé. ${allocations.length} colis ventilés. Marges recalculées.`,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Supprime définitivement un envoi (cascade sur customs_shipment_parcels)
 * et recalcule les marges des commandes liées.
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * ✗ throws err.status=404
 */
async function deleteShipment(db, id) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: linkedParcels } = await client.query(
      `SELECT parcel_id FROM customs_shipment_parcels WHERE shipment_id = $1`,
      [id]
    );

    const { rowCount } = await client.query(
      `DELETE FROM customs_shipments WHERE id = $1`, [id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      const e = new Error('Shipment not found'); e.status = 404; throw e;
    }

    await propagateCostDouane(client, linkedParcels.map(r => r.parcel_id));

    await client.query('COMMIT');
    return { deleted: true, id, parcels_recalculated: linkedParcels.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  declareCustomsPayment,
  isCustomsDeclaredForOrder,
  allocateCustoms,
  propagateCostDouane,
  listShipments,
  getEffectiveRates,
  getShipment,
  createShipment,
  updateShipment,
  deactivateShipment,
  activateShipment,
  deleteShipment,
};

// ── Déclaration douanière (workflow deux étapes) ──────────────────────────────

/**
 * Deuxième étape du workflow douane : l'admin saisit le montant réel payé.
 *
 * Déclenche automatiquement toute la chaîne de ventilation :
 *   customs_paid_kmf → customs_shipment_parcels.customs_share_kmf
 *   → orders.cost_douane_kmf + margin_real_pct
 *   → order_item_real_cost_allocations (via cost-allocation.js)
 *   → parcels.customs_cleared_at
 *
 * Idempotent : peut être appelé plusieurs fois (recalcule).
 *
 * @param {import('pg').Pool} db
 * @param {string} shipmentId
 * @param {{ customs_paid_kmf: number, freight_kmf?: number, notes?: string }} payload
 * @param {string} userId
 */
async function declareCustomsPayment(db, shipmentId, payload, userId) {
  const { customs_paid_kmf, freight_kmf, notes } = payload;

  if (!customs_paid_kmf || Number(customs_paid_kmf) <= 0) {
    const e = new Error('customs_paid_kmf requis et doit être > 0');
    e.status = 400; throw e;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Charger et verrouiller le shipment
    const { rows: [ship] } = await client.query(
      `SELECT * FROM customs_shipments WHERE id = $1 FOR UPDATE`,
      [shipmentId]
    );
    if (!ship) {
      const e = new Error('Expédition introuvable'); e.status = 404; throw e;
    }
    if (ship.status === 'confirmed') {
      const e = new Error('Expédition déjà confirmée — impossible de modifier la déclaration');
      e.status = 409; throw e;
    }

    // 2. Mettre à jour le montant + statut
    const updates = {
      customs_paid_kmf,
      status: 'declared',
      declared_at: new Date(),
      declared_by: userId,
    };
    if (freight_kmf != null) updates.freight_kmf = freight_kmf;
    if (notes != null) updates.notes = notes;

    const fields = Object.keys(updates);
    const vals   = Object.values(updates);
    const setParts = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

    await client.query(
      `UPDATE customs_shipments SET ${setParts} WHERE id = $1`,
      [shipmentId, ...vals]
    );

    // 3. Charger les colis rattachés
    const { rows: linked } = await client.query(
      `SELECT parcel_id FROM customs_shipment_parcels WHERE shipment_id = $1`,
      [shipmentId]
    );
    const parcelIds = linked.map(r => r.parcel_id);

    // 4. Recalculer la ventilation par colis
    if (parcelIds.length > 0) {
      await _insertAllocations(
        client,
        shipmentId,
        {
          customs_paid_kmf,
          allocation_method: ship.allocation_method || 'by_cif_value',
          allocation_config: ship.allocation_config,
        },
        parcelIds
      );

      // 5. Propager vers orders.cost_douane_kmf + margin_real_pct
      await propagateCostDouane(client, parcelIds);

      // 6. Poser customs_cleared_at sur les colis
      await markCustomsCleared(client, {
        parcelIds,
        notes,
      });
    }

    await client.query('COMMIT');

    // 7. Ventilation par order_item (hors transaction principale — idempotent)
    try {
      const costAllocation = require('./cost-allocation');
      await costAllocation.allocateShipmentRealCosts(shipmentId);
    } catch (allocErr) {
      // Non bloquant : la ventilation items peut être relancée manuellement
      console.warn('[customs-shipment] allocateShipmentRealCosts partiel:', allocErr.message);
    }

    // 8. Émettre la facture classifiée par colis (Lot B — DOUANE_DECLARATION_PIVOT)
    // Non bloquant : la facture peut être régénérée via l'endpoint admin.
    if (parcelIds.length > 0) {
      try {
        const customsInvoice = require('./documents/customs-invoice');
        await customsInvoice.issueForShipment(parcelIds, shipmentId, userId);
      } catch (invErr) {
        console.warn('[customs-shipment] customs-invoice partiel:', invErr.message);
      }
    }

    return {
      shipment_id: shipmentId,
      status: 'declared',
      customs_paid_kmf,
      parcels_updated: parcelIds.length,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gate : vérifie que tous les colis d'une commande sont rattachés à une
 * expédition déclarée. Retourne true si la commande peut passer en 'available'.
 *
 * Logique : si la commande a des colis liés à un customs_shipment non déclaré,
 * on bloque. Si aucun colis n'est lié à une expédition (commande locale / hors
 * groupage), on laisse passer.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} q
 * @param {string} orderId
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
async function isCustomsDeclaredForOrder(q, orderId) {
  const { rows } = await q.query(
    `SELECT cs.status, cs.reference
       FROM parcels p
       JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
       JOIN customs_shipments        cs  ON cs.id = csp.shipment_id
      WHERE p.order_id = $1
        AND cs.is_active = TRUE
        AND cs.status = 'pending'`,
    [orderId]
  );

  if (rows.length > 0) {
    const refs = rows.map(r => r.reference).join(', ');
    return {
      allowed: false,
      reason: `Douane non déclarée pour l'expédition : ${refs}. ` +
               `Saisissez le montant douane avant de marquer la commande comme reçue.`,
    };
  }

  return { allowed: true };
}
