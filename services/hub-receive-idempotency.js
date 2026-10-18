'use strict';

/**
 * @komerce-arch
 * @role          hub-receive-idempotency
 * @domain        hub
 * @layer         service
 * @criticality   high
 * @inputs        db, reception_reference, normalized_contents
 * @outputs       prior_reception_lookup, idempotent_replay_or_conflict
 * @depends       db
 * @used-by       services/hub-operations.js
 * @db-read       hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, hub_custody_events
 * @db-write      none
 * @doctrine      same_reference_same_content_is_replay, same_reference_other_content_is_controlled_conflict, never_double_place
 * @impact-areas  hub, purchasing
 * @version       2026-10
 *
 * Idempotence de la réception fournisseur : la `reference` (UNIQUE) identifie la saisie.
 * Même référence + même contenu = déjà traité (aucune nouvelle mutation) ; contenu différent = conflit contrôlé.
 */

const db = require('../db');

function aggregate(entries) {
  const byPo = new Map();
  const bySku = new Map();
  let total = 0;
  for (const entry of entries) {
    const quantity = Number(entry.quantity);
    const po = String(entry.purchase_order_id);
    byPo.set(po, (byPo.get(po) || 0) + quantity);
    if (entry.product_sku_id) {
      const key = `${po}|${entry.product_sku_id}`;
      bySku.set(key, (bySku.get(key) || 0) + quantity);
    }
    total += quantity;
  }
  return { byPo, bySku, total };
}

/** Contenu demandé = contenu déjà enregistré ? (SKU comparé seulement quand la demande le fournit.) */
function sameContent(requested, prior) {
  const want = aggregate(requested);
  const have = aggregate(prior);
  if (want.total !== have.total || want.byPo.size !== have.byPo.size) return false;
  for (const [po, quantity] of want.byPo) {
    if (have.byPo.get(po) !== quantity) return false;
  }
  for (const [key, quantity] of want.bySku) {
    if (have.bySku.get(key) !== quantity) return false;
  }
  return true;
}

async function findPriorReception(reference, executor = db) {
  const ref = String(reference || '').trim();
  if (!ref) return null;
  const { rows: [unit] } = await executor.query(
    'SELECT id, reference, unit_type, state FROM hub_physical_units WHERE reference = $1',
    [ref]
  );
  if (!unit) return null;
  if (unit.unit_type !== 'SUPPLIER_PACKAGE') return { unit, contents: null };

  if (unit.state === 'QUARANTINED') {
    const { rows: [event] } = await executor.query(
      // Les événements d'une même transaction partagent l'horodatage : on cible celui qui porte le manifeste.
      `SELECT details FROM hub_custody_events
        WHERE physical_unit_id = $1 AND details->'manifest' IS NOT NULL LIMIT 1`,
      [unit.id]
    );
    const manifest = event && event.details && Array.isArray(event.details.manifest) ? event.details.manifest : null;
    return { unit, contents: manifest };
  }

  const { rows } = await executor.query(
    `SELECT a.purchase_order_id, a.product_sku_id, SUM(p.quantity)::integer AS quantity
       FROM hub_physical_unit_placements p
       JOIN hub_purchase_allocations a ON a.id = p.allocation_id
      WHERE p.physical_unit_id = $1 AND p.operation_type = 'RECEIVE'
      GROUP BY a.purchase_order_id, a.product_sku_id`,
    [unit.id]
  );
  return { unit, contents: rows };
}

/** Réponse HTTP contrôlée pour une référence déjà connue. */
function replayResponse(prior, requestedContents) {
  const matches = prior.contents && sameContent(requestedContents, prior.contents);
  if (!matches) {
    return {
      status: 409,
      body: {
        error: 'Cette référence de réception a déjà été utilisée avec un contenu différent',
        code: 'HUB_RECEPTION_REFERENCE_CONFLICT',
        reference: prior.unit.reference,
      },
    };
  }
  return {
    status: 200,
    body: {
      idempotent_replay: true,
      quarantined: prior.unit.state === 'QUARANTINED',
      unit: prior.unit,
      message: 'Réception déjà traitée pour cette référence : aucune nouvelle mutation',
    },
  };
}

module.exports = { sameContent, findPriorReception, replayResponse };
