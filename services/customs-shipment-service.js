/**
 * @komerce-arch
 * @role          customs-shipment-service
 * @domain        customs
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/cost-allocation/index.js, services/cost-allocation/_helpers.js, services/documents/customs-invoice.js, services/parcel-mutation-service.js
 * @used-by       routes/admin-customs-shipments.js, services/order-status-machine.js, services/shipping-customs-workspace.js
 * @db-read       customs_effective_rates, customs_shipment_parcels, customs_shipments, order_item_real_cost_allocations, order_items, orders, parcel_items, parcels, products
 * @db-write      customs_shipment_parcel_events, customs_shipment_parcels, customs_shipments, order_item_real_cost_allocations, orders
 * @db-write-via:parcel-mutation-service parcels
 * @db-write-via:cost-allocation order_item_real_cost_allocations
 * @db-txn        createShipment_owns_full_transaction, declaration_allocation_atomic
 * @doctrine      trusted_market_scope_options_never_request_body, resolve_before_behavior_change, customs_unknown_is_not_zero, customs_allocation_conserved_and_atomic
 * @impact-areas  customs, logistics, market-authorization
 * @version       2026-09
 */

'use strict';

const { assertMarketOperationAllowed } = require('./market-operation-guard');
const { markCustomsCleared } = require('./parcel-mutation-service');
const { recomputeCustomsCosts } = require('./order-mutation-service');
const { shareByWeight } = require('./cost-allocation/_helpers');
const { normalizeFeeAllocation } = require('./transport-cost-allocation');

// ── Intégrité financière des coûts douaniers ─────────────────────────────────
//   - NULL = montant inconnu (expédition pending) ; 0 explicite = aucun frais
//     confirmé. Les deux ne se confondent jamais.
//   - Déclaration, ventilation par colis, ventilation par article et agrégats
//     commande sont écrits dans UNE transaction : tout ou rien.
//   - La somme des parts égale exactement le montant déclaré (au centime) ;
//     sinon l'opération est refusée (COST_ALLOCATION_INCOMPLETE).
//   - Une expédition déclarée n'est jamais supprimée : on la désactive, ce qui
//     retire ses allocations actives et conserve le fait source tracé.

const FINANCIAL_FIELDS = Object.freeze(['customs_paid_kmf', 'freight_kmf', 'allocation_method', 'allocation_config']);

function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function setLocalCustomsAuditContext(client, actorId, reason) {
  // Session-local values scoped to the ongoing transaction; no pool leakage.
  await client.query(
    "SELECT set_config('komerce.actor_id', $1, true), set_config('komerce.change_reason', $2, true)",
    [actorId == null ? '' : String(actorId), reason == null ? '' : String(reason)]
  );
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function isBlankAmount(value) {
  return value === null || value === undefined || value === '';
}

/** Montant confirmé obligatoire : 0 accepté (aucun frais), jamais inféré. */
function parseConfirmedAmount(value, field) {
  if (isBlankAmount(value)) {
    throw httpError(400, `${field} requis — saisir 0 si l'absence de frais est confirmée`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, `${field} doit être un montant ≥ 0`);
  return n;
}

/** Montant facultatif : undefined = non fourni, null/'' = inconnu, sinon ≥ 0. */
function parseOptionalAmount(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, `${field} doit être un montant ≥ 0`);
  return n;
}

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
 *   createShipment(db, body, userId, { marketId? })
 *     → { shipment, allocations }
 *     Transaction complète (INSERT envoi + market snapshot + ventilation + propagation).
 *     marketId est une option de service de confiance, jamais lue depuis body.
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
 * Méthode de ventilation à la CRÉATION d'une expédition : une méthode fournie
 * est toujours respectée ; à défaut, le maritime se ventile au volume (m³,
 * doctrine fret — migration 095), le reste par valeur CIF. Ne s'applique jamais
 * aux expéditions existantes (colonne NOT NULL, relectures inchangées).
 */
function defaultAllocationMethod(allocationMethod, transportMode) {
  if (allocationMethod) return allocationMethod;
  return transportMode === 'sea' ? 'by_volume' : 'by_cif_value';
}

/**
 * Répartition manuelle (A4) : une part colis par colis, saisie contrôlée.
 * Entrée : tableau [{ parcel_id, customs_share_kmf }] ou objet { parcel_id: montant }.
 * Sortie : objet { parcel_id: "123.45" } (chaînes à 2 décimales, jamais de flottant persisté).
 * Les parts sont persistées dans allocation_config.manual_shares : colonne déjà auditée
 * (acteur, raison, avant / après) par le trigger d'audit financier.
 */
function normalizeManualShares(raw) {
  if (raw === undefined || raw === null) return null;
  const entries = Array.isArray(raw)
    ? raw.map(item => [item && item.parcel_id, item && item.customs_share_kmf])
    : (typeof raw === 'object' ? Object.entries(raw) : null);
  if (!entries || !entries.length) {
    throw httpError(400, 'parcel_shares : liste de parts colis requise', 'CUSTOMS_SHARES_INVALID');
  }
  const out = {};
  for (const [parcelId, amount] of entries) {
    const id = parcelId == null ? '' : String(parcelId).trim();
    const n = typeof amount === 'string' ? Number(amount.replace(',', '.')) : Number(amount);
    if (!id || amount === null || amount === '' || !Number.isFinite(n) || n < 0
        || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
      throw httpError(400, 'parcel_shares : colis et montant ≥ 0 (2 décimales max) requis', 'CUSTOMS_SHARES_INVALID');
    }
    if (Object.prototype.hasOwnProperty.call(out, id)) {
      throw httpError(400, 'parcel_shares : colis en double', 'CUSTOMS_SHARES_INVALID');
    }
    out[id] = (Math.round(n * 100) / 100).toFixed(2);
  }
  return out;
}

function withManualShares(allocationConfig, shares) {
  const base = allocationConfig && typeof allocationConfig === 'object' ? allocationConfig : {};
  return { ...base, manual_shares: shares };
}

/**
 * Calcule la part de douane de chaque colis selon la méthode choisie.
 *
 * @param {{ customs_paid_kmf, allocation_method?, allocation_config? }} shipment
 * @param {Array<{ parcel_id, cif_kmf, weight_kg, volume_m3? }>} parcels
 * @returns {Array<{ parcel_id, cif_kmf, weight_kg, customs_share_kmf, allocation_basis }>}
 */
function allocateCustoms(shipment, parcels) {
  const method = shipment.allocation_method || 'by_cif_value';
  const cfg    = shipment.allocation_config  || {};

  // Montant inconnu : aucune part n'est fabriquée. 0 confirmé : part nulle
  // explicite pour chaque colis (remplace toute ancienne part non nulle).
  if (!parcels.length || isBlankAmount(shipment.customs_paid_kmf)) return [];
  const total = Number(shipment.customs_paid_kmf);
  if (!Number.isFinite(total)) return [];

  // manual : pas de calcul automatique
  if (method === 'manual') {
    return parcels.map(p => ({
      ...p,
      customs_share_kmf: p.manual_share_kmf != null ? Number(p.manual_share_kmf) : 0,
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
  let basis = method;
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
    if (sum > 0) {
      weights = values.map(v => v / sum);
    } else {
      // Métrique absente sur tous les colis : parts égales, conservées au
      // centime, et tracées dans allocation_basis (jamais silencieux).
      weights = parcels.map(() => 1 / parcels.length);
      basis = `${method}:equal_fallback`;
    }
  }

  // Aucun signal exploitable (ex. mixed sans CIF ni poids) : répartition égale
  // plutôt qu'un montant entier perdu.
  if (!weights.some(w => w > 0)) weights = parcels.map(() => 1);

  // Plus grand reste au centime : la somme des parts égale exactement le total.
  const centShares = shareByWeight(toCents(total), weights.map((weight, index) => ({ id: index, weight })));

  return parcels.map((p, i) => ({
    ...p,
    customs_share_kmf: centShares[i].share / 100,
    allocation_basis:  basis,
  }));
}

/**
 * Refuse toute ventilation colis qui ne couvre pas exactement le montant
 * déclaré (méthode manual sans parts saisies, colis manquant, arrondi).
 */
function assertParcelSharesComplete(allocations, customsPaidKmf, expectedParcels) {
  const declaredCents = toCents(customsPaidKmf);
  const allocatedCents = allocations.reduce((s, a) => s + toCents(a.customs_share_kmf), 0);
  if (allocations.length !== expectedParcels || allocatedCents !== declaredCents) {
    throw httpError(422,
      `Ventilation douane incomplète : ${allocatedCents / 100} ventilés sur ${declaredCents / 100} déclarés ` +
      `(${allocations.length}/${expectedParcels} colis)`,
      'COST_ALLOCATION_INCOMPLETE');
  }
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

  // A8 : writer canonique actif → il est l'unique écrivain de margin_real_pct (l'ancien recalcul
  // de marge est coupé) ; désactivé → comportement historique strictement inchangé.
  const canonical = require('./cost-allocation/canonical-margin-writer');
  const canonicalOn = await canonical.isEnabled();
  await recomputeCustomsCosts(client, { orderIds, skipLegacyMargin: canonicalOn });
  if (canonicalOn) {
    // Colis groupé : les lignes d'autres commandes portent aussi une part (audit P0-PRE).
    const { rows: lineOrders } = await client.query(
      `SELECT DISTINCT oi.order_id FROM parcel_items pi JOIN order_items oi ON oi.id = pi.order_item_id
        WHERE pi.parcel_id = ANY($1::uuid[])`,
      [parcelIds]
    );
    const all = [...new Set([...orderIds, ...(lineOrders || []).map(r => r.order_id)])];
    await canonical.refreshCanonicalMarginForOrders(all, { client });
  }
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

/**
 * Defence in depth: a parcel may only join a shipment in its own market.
 * Check inside the caller-owned transaction, locking parcel rows against
 * concurrent reassignment. The workspace check alone is insufficient.
 */
async function assertShipmentParcelMarket(client, shipmentId, parcelIds) {
  const ids = Array.isArray(parcelIds) ? parcelIds : [];
  if (!ids.length) return;
  if (new Set(ids.map(String)).size !== ids.length) {
    throw httpError(409, 'Colis en double dans une expédition', 'CUSTOMS_DUPLICATE_PARCEL');
  }
  const { rows: [shipment] } = await client.query(
    'SELECT market_id FROM customs_shipments WHERE id = $1', [shipmentId]
  );
  if (!shipment) throw httpError(404, 'Expédition introuvable', 'CUSTOMS_SHIPMENT_NOT_FOUND');
  if (!shipment.market_id) {
    throw httpError(409, 'Marché de l’expédition non renseigné', 'CUSTOMS_SHIPMENT_MARKET_REQUIRED');
  }
  const { rows } = await client.query(
    `SELECT p.id, o.market_id
       FROM parcels p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ANY($1::uuid[])
      FOR UPDATE OF p`, [ids]
  );
  if (rows.length !== ids.length || rows.some(row => String(row.market_id) !== String(shipment.market_id))) {
    throw httpError(409, 'Colis absent ou relevant d’un autre marché', 'CUSTOMS_PARCEL_MARKET_MISMATCH');
  }
  // Un colis ne porte qu'UNE expédition active : sinon ses droits/fret seraient comptés deux fois.
  // Les lignes colis sont verrouillées ci-dessus : le contrôle tient face à un rattachement concurrent.
  const { rows: grouped } = await client.query(
    `SELECT csp.parcel_id
       FROM customs_shipment_parcels csp
       JOIN customs_shipments cs ON cs.id = csp.shipment_id
      WHERE csp.parcel_id = ANY($1::uuid[]) AND csp.shipment_id <> $2 AND cs.is_active = TRUE
      LIMIT 1`, [ids, shipmentId]
  );
  if (grouped.length) {
    throw httpError(409, 'Colis déjà rattaché à une autre expédition active', 'CUSTOMS_PARCEL_ALREADY_GROUPED');
  }
}

/**
 * Éligibilité d'un NOUVEAU rattachement (groupage expédié) : colis `shipped` ou `in_transit`,
 * commande ni annulée ni remboursée. Préparation et expédition ne se mélangent pas. Ne s'applique
 * qu'aux colis pas encore liés à cette expédition : une annulation ou une arrivée survenue après
 * le groupage ne bloque ni la déclaration, ni la réactivation, ni une correction.
 */
const GROUPABLE_PARCEL_STATUSES = Object.freeze(['shipped', 'in_transit']);

async function assertParcelsEligibleForGrouping(client, parcelIds, shipmentId = null) {
  const ids = Array.isArray(parcelIds) ? parcelIds : [];
  if (!ids.length) return;
  const { rows } = await client.query(
    `SELECT p.id
       FROM orders o JOIN parcels p ON p.order_id = o.id
      WHERE p.id = ANY($1::uuid[])
        AND ($2::uuid IS NULL OR NOT EXISTS (
              SELECT 1 FROM customs_shipment_parcels l WHERE l.shipment_id = $2 AND l.parcel_id = p.id))
        AND (NOT (p.status::text = ANY($3::text[])) OR o.status IN ('cancelled', 'refunded'))
      LIMIT 1`, [ids, shipmentId, GROUPABLE_PARCEL_STATUSES]
  );
  if (rows.length) {
    throw httpError(409,
      'Colis non groupable : seuls les colis expédiés (shipped / in_transit) de commandes non annulées sont rattachables',
      'CUSTOMS_PARCEL_NOT_ELIGIBLE');
  }
}

/** Insère les lignes de ventilation et propage vers orders (dans tx). */
async function _insertAllocations(client, shipmentId, shipmentMeta, parcelIds) {
  if (!Array.isArray(parcelIds) || parcelIds.length === 0) return [];
  await assertShipmentParcelMarket(client, shipmentId, parcelIds);

  // Métriques physiques par colis. Priorité : valeur propre du colis, puis ses
  // parcel_items (quantité × prix/poids/volume), puis — colis sans item d'une
  // commande multi-colis — part égale de la commande (jamais N fois le total).
  // Commande à un seul colis : comportement historique (métriques commande).
  const { rows: parcelData } = await client.query(
    `SELECT p.id, p.reference,
            COALESCE(p.customs_value_kmf, CASE
              WHEN COALESCE(pc.n, 0) <= 1 THEN o.total_kmf
              WHEN pit.n_items > 0 THEN pit.cif
              ELSE o.total_kmf / pc.n END) AS cif_kmf,
            COALESCE(p.customs_weight_kg, CASE
              WHEN COALESCE(pc.n, 0) <= 1 THEN ord.weight_kg
              WHEN pit.n_items > 0 THEN pit.weight_kg
              ELSE ord.weight_kg / pc.n END) AS weight_kg,
            COALESCE(p.volume_cm3, CASE
              WHEN COALESCE(pc.n, 0) <= 1 THEN ord.volume_cm3
              WHEN pit.n_items > 0 THEN pit.volume_cm3
              ELSE ord.volume_cm3 / pc.n END) AS volume_cm3
       FROM parcels p
       LEFT JOIN orders o ON o.id = p.order_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n FROM parcels p2 WHERE p2.order_id = p.order_id
       ) pc ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n_items,
                SUM(pi.quantity * oi.price_kmf)                AS cif,
                SUM(COALESCE(pr.weight_kg, 0) * pi.quantity)   AS weight_kg,
                SUM(COALESCE(pr.volume_cm3, 0) * pi.quantity)  AS volume_cm3
           FROM parcel_items pi
           JOIN order_items oi ON oi.id = pi.order_item_id
           LEFT JOIN products pr ON pr.id = pi.product_id
          WHERE pi.parcel_id = p.id
       ) pit ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(COALESCE(pr.weight_kg, 0) * oi.quantity)  AS weight_kg,
                SUM(COALESCE(pr.volume_cm3, 0) * oi.quantity) AS volume_cm3
           FROM order_items oi
           JOIN products pr ON pr.id = oi.product_id
          WHERE oi.order_id = p.order_id
       ) ord ON TRUE
      WHERE p.id = ANY($1::uuid[])`,
    [parcelIds]
  );

  // volume_m3 : requis par allocateCustoms (méthode 'by_volume', doctrine fret
  // maritime au m³ — cf. migration 095). cm3 → m3.
  let manualShares = null;
  if ((shipmentMeta.allocation_method || 'by_cif_value') === 'manual') {
    const stored = shipmentMeta.allocation_config && shipmentMeta.allocation_config.manual_shares;
    const zeroTotal = toCents(shipmentMeta.customs_paid_kmf) === 0;
    if (stored) {
      const keys = Object.keys(stored);
      if (keys.length !== parcelIds.length || parcelIds.some(id => !Object.prototype.hasOwnProperty.call(stored, String(id)))) {
        throw httpError(422,
          'Répartition manuelle : une part par colis rattaché est requise (parcel_shares à jour après tout ajout / retrait)',
          'COST_ALLOCATION_INCOMPLETE');
      }
      manualShares = stored;
    } else if (!zeroTotal) {
      throw httpError(422,
        'Répartition manuelle : parcel_shares requis (une part par colis, somme = montant déclaré)',
        'COST_ALLOCATION_INCOMPLETE');
    }
  }
  const allocations = allocateCustoms(
    shipmentMeta,
    parcelData.map(p => ({
      parcel_id:  p.id,
      cif_kmf:    Number(p.cif_kmf)    || 0,
      weight_kg:  Number(p.weight_kg)  || 0,
      volume_m3:  (Number(p.volume_cm3) || 0) / 1e6,
      manual_share_kmf: manualShares ? manualShares[String(p.id)] : null,
    }))
  );
  const volumeByParcelId = new Map(parcelData.map(p => [p.id, Number(p.volume_cm3) || 0]));

  for (const a of allocations) {
    await client.query(
      `INSERT INTO customs_shipment_parcels
         (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg, parcel_volume_cm3,
          customs_share_kmf, allocation_basis, manual_override)
       VALUES ($1,$2,$3,$4,$5,$6,$7,($7 = 'manual'))
       ON CONFLICT (shipment_id, parcel_id) DO UPDATE
         SET customs_share_kmf = EXCLUDED.customs_share_kmf,
             allocation_basis  = EXCLUDED.allocation_basis,
             manual_override   = EXCLUDED.manual_override,
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
 * Ventilation complète d'une expédition au montant connu, DANS la
 * transaction de l'appelant : parts colis → agrégats commande → lignes
 * article. Toute incomplétude lève et fait annuler l'ensemble.
 */
async function _reallocateDeclared(client, shipmentId, shipmentMeta, parcelIds) {
  const ids = Array.isArray(parcelIds) ? parcelIds : [];
  if (!ids.length) {
    throw httpError(409,
      'Aucun colis rattaché : un montant douane ne peut pas être déclaré ou ventilé sans porteur',
      'CUSTOMS_SHIPMENT_WITHOUT_PARCELS');
  }
  const allocations = await _insertAllocations(client, shipmentId, shipmentMeta, ids);
  assertParcelSharesComplete(allocations, shipmentMeta.customs_paid_kmf, ids.length);

  const costAllocation = require('./cost-allocation');
  const itemResult = await costAllocation.allocateShipmentRealCosts(shipmentId, client);
  return { allocations, itemResult: itemResult || {} };
}

async function _linkedParcelIds(client, shipmentId) {
  const { rows } = await client.query(
    `SELECT parcel_id FROM customs_shipment_parcels WHERE shipment_id = $1`,
    [shipmentId]
  );
  return rows.map(r => r.parcel_id);
}

/**
 * Crée un envoi douane + snapshot marché + ventilation initiale dans une seule transaction.
 *
 * @param {import('pg').Pool} db
 * @param {object} body
 * @param {string} userId
 * @param {{ marketId?: string|null }} options — contexte serveur de confiance
 * @returns {{ shipment, allocations }}
 * ✗ throws err.status=400 si champs requis manquants
 */
async function createShipment(db, body, userId, options = {}) {
  const {
    reference, shipment_date, transitaire_name, transport_mode,
    cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
    nb_parcels, allocation_method, allocation_config, notes,
    supplier_id, parcel_ids,
  } = body;
  const marketId = options.marketId || null;
  const effectiveMethod = defaultAllocationMethod(allocation_method, transport_mode);
  const manualShares = normalizeManualShares(body.parcel_shares);
  if (allocation_config != null) {
    const cfgObj = typeof allocation_config === 'string' ? JSON.parse(allocation_config) : allocation_config;
    normalizeFeeAllocation(cfgObj && cfgObj.fee_allocation);
  }
  if (manualShares && effectiveMethod !== 'manual') {
    throw httpError(400, 'parcel_shares exige allocation_method = manual', 'CUSTOMS_SHARES_REQUIRE_MANUAL');
  }
  const effectiveConfig = manualShares ? withManualShares(allocation_config, manualShares) : allocation_config;

  // customs_paid_kmf n'est plus requis à la création (workflow en deux étapes)
  // Il est saisi lors de la déclaration (declareCustomsPayment).
  if (!reference || !shipment_date || !cif_value_kmf) {
    const e = new Error('Champs requis: reference, shipment_date, cif_value_kmf');
    e.status = 400; throw e;
  }

  // Montant fourni à la création (flux rétrocompatible) : 0 confirmé accepté,
  // mais jamais sans colis porteur — sinon déclarer plus tard.
  const hasAmount = !isBlankAmount(customs_paid_kmf);
  const amount = hasAmount ? parseConfirmedAmount(customs_paid_kmf, 'customs_paid_kmf') : null;
  const freight = parseOptionalAmount(freight_kmf, 'freight_kmf');
  if (hasAmount && !parcel_ids?.length) {
    throw httpError(400,
      'customs_paid_kmf fourni sans parcel_ids : rattacher les colis ou déclarer le montant plus tard',
      'CUSTOMS_SHIPMENT_WITHOUT_PARCELS');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Q2 : nouvelle expédition refusée hors marché actif ; marché suspendu seulement pour des colis de commandes existantes.
    await assertMarketOperationAllowed(client, marketId, 'customs_shipment_create', { carriesOnlyExistingOrders: Boolean(parcel_ids?.length) });

    const { rows: [shipment] } = await client.query(
      `INSERT INTO customs_shipments
        (reference, shipment_date, transitaire_name, transport_mode,
         cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
         nb_parcels, allocation_method, allocation_config, notes, supplier_id, created_by,
         market_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')
       RETURNING *`,
      [
        reference, shipment_date, transitaire_name || null, transport_mode || null,
        cif_value_kmf,
        amount,
        freight == null ? null : freight, total_weight_kg || null,
        nb_parcels || null, effectiveMethod,
        effectiveConfig ? JSON.stringify(effectiveConfig) : null,
        notes || null, supplier_id || null, userId, marketId,
      ]
    );

    if (parcel_ids?.length) await assertShipmentParcelMarket(client, shipment.id, parcel_ids);
    if (parcel_ids?.length) await assertParcelsEligibleForGrouping(client, parcel_ids, shipment.id);

    // Ventilation immédiate uniquement si le montant est déjà fourni
    // (rétrocompatibilité : ancien flow où tout était saisi d'un coup).
    // 0 confirmé est une déclaration valide ; NULL reste pending.
    let allocations = [];
    if (hasAmount) {
      // Marquer comme déclaré, puis ventilation complète dans la même transaction.
      await client.query(
        `UPDATE customs_shipments
            SET status = 'declared', declared_at = NOW(), declared_by = $2
          WHERE id = $1`,
        [shipment.id, userId]
      );
      ({ allocations } = await _reallocateDeclared(
        client,
        shipment.id,
        { customs_paid_kmf: amount, allocation_method: effectiveMethod, allocation_config: effectiveConfig },
        parcel_ids
      ));
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

    // Retourner l'état final réellement commité (notamment status='declared'
    // dans le chemin rétrocompatible), tout en restant dans la même transaction.
    const { rows: [finalShipment] } = await client.query(
      `SELECT * FROM customs_shipments WHERE id = $1`,
      [shipment.id]
    );

    await client.query('COMMIT');
    return { shipment: finalShipment || shipment, allocations };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Met à jour un envoi.
 *
 * Métadonnées seules : mise à jour directe. Champs financiers
 * (FINANCIAL_FIELDS) : transaction verrouillée — refus sur expédition
 * confirmée, refus du montant douane sur une expédition pending (passer par
 * la déclaration), reventilation atomique complète sur une expédition
 * déclarée active. Jamais de parts colis/article périmées.
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * @param {object} body
 * @returns {{ shipment, reallocated? }}
 * ✗ throws err.status=400 | 404 | 409 | 422
 */
async function updateShipment(db, id, body, actor = {}) {
  const allowed = [
    'reference', 'shipment_date', 'transitaire_name', 'transport_mode',
    'cif_value_kmf', 'customs_paid_kmf', 'freight_kmf', 'total_weight_kg',
    'nb_parcels', 'allocation_method', 'allocation_config', 'notes', 'supplier_id',
  ];
  const values = {};
  for (const k of allowed) {
    if (body[k] !== undefined) values[k] = body[k];
  }
  const manualShares = normalizeManualShares(body.parcel_shares);
  if (values.allocation_config != null) {
    const cfgObj = typeof values.allocation_config === 'string' ? JSON.parse(values.allocation_config) : values.allocation_config;
    normalizeFeeAllocation(cfgObj && cfgObj.fee_allocation);
  }
  if (!Object.keys(values).length && !manualShares) {
    const e = new Error('Aucun champ à modifier'); e.status = 400; throw e;
  }

  const touchesFinancial = manualShares ? true : FINANCIAL_FIELDS.some(k => values[k] !== undefined);
  if (values.customs_paid_kmf !== undefined) {
    values.customs_paid_kmf = parseConfirmedAmount(values.customs_paid_kmf, 'customs_paid_kmf');
  }
  if (values.freight_kmf !== undefined) {
    values.freight_kmf = parseOptionalAmount(values.freight_kmf, 'freight_kmf');
  }

  const buildUpdate = () => {
    const keys = Object.keys(values);
    const setClause = keys.length ? keys.map((k, i) => `${k} = $${i + 1}`).join(', ') : 'reference = reference';
    return {
      params: [...keys.map(k => values[k]), id],
      updateSql: `UPDATE customs_shipments SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    };
  };
  let { updateSql, params } = buildUpdate();

  if (!touchesFinancial) {
    const { rows: [shipment] } = await db.query(updateSql, params);
    if (!shipment) {
      const e = new Error('Shipment not found'); e.status = 404; throw e;
    }
    return { shipment };
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalCustomsAuditContext(client, actor.id, body && body.reason);
    const { rows: [current] } = await client.query(
      `SELECT * FROM customs_shipments WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current) throw httpError(404, 'Shipment not found');
    if (current.status === 'confirmed') {
      throw httpError(409, 'Expédition confirmée : montants et ventilation ne sont plus modifiables');
    }
    if (current.status === 'pending' && values.customs_paid_kmf !== undefined) {
      throw httpError(400,
        'Expédition pending : le montant douane se saisit par la déclaration (POST /:id/declare)');
    }

    if (manualShares) {
      const method = values.allocation_method !== undefined ? values.allocation_method : current.allocation_method;
      if ((method || 'by_cif_value') !== 'manual') {
        throw httpError(400, 'parcel_shares exige allocation_method = manual', 'CUSTOMS_SHARES_REQUIRE_MANUAL');
      }
      const baseConfig = values.allocation_config !== undefined ? values.allocation_config : current.allocation_config;
      values.allocation_config = JSON.stringify(withManualShares(
        typeof baseConfig === 'string' ? JSON.parse(baseConfig) : baseConfig, manualShares));
      ({ updateSql, params } = buildUpdate());
    }
    const { rows: [shipment] } = await client.query(updateSql, params);

    let reallocated = false;
    if (shipment.status === 'declared' && shipment.is_active !== false) {
      await _reallocateDeclared(client, shipment.id, {
        customs_paid_kmf: shipment.customs_paid_kmf,
        allocation_method: shipment.allocation_method || 'by_cif_value',
        allocation_config: shipment.allocation_config,
      }, await _linkedParcelIds(client, shipment.id));
      reallocated = true;
    }

    await client.query('COMMIT');
    return { shipment, reallocated };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
    // Aucune allocation article active ne survit à la désactivation. Le fait
    // source (montant, méthode, deactivated_at/reason) reste sur customs_shipments
    // et la réactivation reventile entièrement.
    const itemAllocations = await client.query(
      `DELETE FROM order_item_real_cost_allocations WHERE shipment_id = $1`,
      [id]
    );
    await propagateCostDouane(client, removed.map(r => r.parcel_id));

    await client.query('COMMIT');
    return {
      shipment,
      message:       `Envoi désactivé. Ventilation retirée de ${removed.length} colis. Marges recalculées.`,
      parcels_reset: removed.length,
      item_allocations_removed: (itemAllocations && itemAllocations.rowCount) || 0,
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
async function activateShipment(db, id, parcelIds, rawShares) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    let { rows: [shipment] } = await client.query(
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

    if (rawShares !== undefined && rawShares !== null) {
      await setLocalCustomsAuditContext(client, null, 'réactivation avec parts manuelles');
      shipment = await _applyManualSharesInTx(client, shipment, rawShares);
    }
    const ids = Array.isArray(parcelIds) ? parcelIds : [];
    await assertShipmentParcelMarket(client, shipment.id, ids);
    await assertParcelsEligibleForGrouping(client, ids, shipment.id);
    let allocations = [];
    if (shipment.status === 'pending' || isBlankAmount(shipment.customs_paid_kmf)) {
      // Montant encore inconnu : rattacher les colis sans fabriquer de part
      // (auparavant le rattachement était perdu faute de montant).
      for (const pid of ids) {
        await client.query(
          `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [shipment.id, pid]
        );
      }
      await propagateCostDouane(client, ids);
    } else {
      // Montant connu : reventilation complète (colis + articles) atomique.
      ({ allocations } = await _reallocateDeclared(client, shipment.id, shipment, ids));
    }

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
 * Supprime définitivement un envoi encore pending (aucun fait financier),
 * avec ses rattachements, et recalcule les marges des commandes liées.
 *
 * Une expédition déclarée/confirmée porte un historique financier : elle
 * doit être désactivée, jamais supprimée (sinon order_item_real_cost_allocations
 * deviendrait orpheline via shipment_id ON DELETE SET NULL).
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * ✗ throws err.status=404 | 409
 */
async function deleteShipment(db, id) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [current] } = await client.query(
      `SELECT id, status FROM customs_shipments WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current) {
      await client.query('ROLLBACK');
      const e = new Error('Shipment not found'); e.status = 404; throw e;
    }
    if (current.status !== 'pending') {
      throw httpError(409,
        'Expédition déclarée : historique financier — la désactiver plutôt que la supprimer',
        'CUSTOMS_SHIPMENT_HAS_FINANCIAL_HISTORY');
    }

    const { rows: linkedParcels } = await client.query(
      `SELECT parcel_id FROM customs_shipment_parcels WHERE shipment_id = $1`,
      [id]
    );

    // Défensif : jamais d'allocation orpheline (FK ON DELETE SET NULL).
    await client.query(
      `DELETE FROM order_item_real_cost_allocations WHERE shipment_id = $1`,
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

/**
 * Canonical international shipping: record customs amount at the customs owner's
 * transaction boundary. The calling journey owns market/role/arrival/box checks.
 * Never allocate customs duties to historical parcels, orders or item margins.
 */
async function declareInternationalCustomsAmount(client,{shipmentId,marketId,amountKmf,actorId}){
  const {rows:[record]}=await client.query(
    'SELECT id,status,is_active,customs_paid_kmf FROM customs_shipments WHERE id=$1 AND market_id=$2 FOR UPDATE',
    [shipmentId,marketId]);
  if(!record?.is_active){
    const e=new Error('Dossier douane actif absent');e.status=409;e.code='JOURNEY_CUSTOMS_INACTIVE';throw e;
  }
  if(record.customs_paid_kmf!=null){
    const e=new Error('Droits déjà déclarés, correction documentée requise');e.status=409;e.code='JOURNEY_CUSTOMS_AMOUNT_IMMUTABLE';throw e;
  }
  const {rows:[linked]}=await client.query(
    'SELECT COUNT(*)::int AS n FROM customs_shipment_parcels WHERE shipment_id=$1',[record.id]);
  if(Number(linked.n)>0){
    const e=new Error('Composition douanière historique interdite pour KOM-BOX');e.status=409;e.code='JOURNEY_CUSTOMS_LEGACY_MEMBERSHIP';throw e;
  }
  await client.query(
    "UPDATE customs_shipments SET customs_paid_kmf=$3,status='declared',declared_at=now(),declared_by=$4 WHERE id=$1 AND market_id=$2",
    [record.id,marketId,amountKmf,String(actorId)]);
  return {id:record.id,status:'declared',amount_kmf:amountKmf};
}

module.exports = {
  declareInternationalCustomsAmount,
  assertShipmentParcelMarket,
  declareCustomsPayment,
  isCustomsDeclaredForOrder,
  confirmCustomsShipmentsForOrder,
  allocateCustoms,
  defaultAllocationMethod,
  propagateCostDouane,
  listShipments,
  getEffectiveRates,
  addParcelsToShipment,
  removeParcelsFromShipment,
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
 * 0 explicite est une déclaration valide (absence de frais confirmée) ;
 * un montant absent reste inconnu et est refusé.
 *
 * Atomique : montant, parts colis, agrégats commande, lignes article et
 * customs_cleared_at sont écrits dans la même transaction — tout ou rien.
 * Seule la facture (document régénérable) est émise après COMMIT, et son
 * échec est retourné explicitement (invoice_issued=false), jamais silencieux.
 *
 * Idempotent : peut être appelé plusieurs fois (recalcule à l'identique).
 *
 * @param {import('pg').Pool} db
 * @param {string} shipmentId
 * @param {{ customs_paid_kmf: number, freight_kmf?: number|null, notes?: string }} payload
 * @param {string} userId
 */
async function declareCustomsPayment(db, shipmentId, payload, userId) {
  const customs_paid_kmf = parseConfirmedAmount(payload && payload.customs_paid_kmf, 'customs_paid_kmf');
  const freight_kmf = parseOptionalAmount(payload && payload.freight_kmf, 'freight_kmf');
  const notes = payload && payload.notes;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalCustomsAuditContext(client, userId, payload && payload.reason);

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
    if (ship.is_active === false) {
      throw httpError(409, 'Expédition désactivée — la réactiver avant de déclarer');
    }

    // 2. Colis porteurs : aucun montant déclaré sans affectation possible
    const parcelIds = await _linkedParcelIds(client, shipmentId);
    await assertShipmentParcelMarket(client, shipmentId, parcelIds);
    if (!parcelIds.length) {
      throw httpError(409,
        'Aucun colis rattaché : un montant douane ne peut pas être déclaré sans porteur',
        'CUSTOMS_SHIPMENT_WITHOUT_PARCELS');
    }

    // 2b. Parts manuelles (A4) : persistées dans allocation_config (colonne auditée) avant ventilation
    const declaredShares = normalizeManualShares(payload && payload.parcel_shares);
    if (declaredShares && (ship.allocation_method || 'by_cif_value') !== 'manual') {
      throw httpError(400, 'parcel_shares exige allocation_method = manual', 'CUSTOMS_SHARES_REQUIRE_MANUAL');
    }
    const effectiveConfig = declaredShares ? withManualShares(ship.allocation_config, declaredShares) : ship.allocation_config;

    // 3. Mettre à jour le montant + statut
    const updates = {
      customs_paid_kmf,
      status: 'declared',
      declared_at: new Date(),
      declared_by: userId,
    };
    if (freight_kmf !== undefined) updates.freight_kmf = freight_kmf;
    if (notes != null) updates.notes = notes;
    if (declaredShares) updates.allocation_config = JSON.stringify(effectiveConfig);

    const fields = Object.keys(updates);
    const vals   = Object.values(updates);
    const setParts = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

    await client.query(
      `UPDATE customs_shipments SET ${setParts} WHERE id = $1`,
      [shipmentId, ...vals]
    );

    // 4. Ventilation complète dans la transaction : colis → commandes → articles
    const { itemResult } = await _reallocateDeclared(
      client,
      shipmentId,
      {
        customs_paid_kmf,
        allocation_method: ship.allocation_method || 'by_cif_value',
        allocation_config: effectiveConfig,
      },
      parcelIds
    );

    // 5. Poser customs_cleared_at sur les colis
    await markCustomsCleared(client, {
      parcelIds,
      notes,
    });

    await client.query('COMMIT');

    // 6. Émettre la facture classifiée par colis (Lot B — DOUANE_DECLARATION_PIVOT)
    // Document régénérable via l'endpoint admin : son échec est retourné, pas tu.
    let invoiceIssued = true;
    let invoiceError;
    try {
      const customsInvoice = require('./documents/customs-invoice');
      await customsInvoice.issueForShipment(parcelIds, shipmentId, userId);
    } catch (invErr) {
      invoiceIssued = false;
      invoiceError = invErr.message;
      console.warn('[customs-shipment] customs-invoice partiel:', invErr.message);
    }

    return {
      shipment_id: shipmentId,
      status: 'declared',
      customs_paid_kmf,
      parcels_updated: parcelIds.length,
      allocations_count: Number(itemResult.allocations_count) || 0,
      invoice_issued: invoiceIssued,
      ...(invoiceIssued ? {} : { invoice_error: invoiceError }),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Groupage : ajout / retrait direct de colis (avant clôture) ───────────────

function _membershipInput(parcelIds, reason) {
  const ids = [...new Set((Array.isArray(parcelIds) ? parcelIds : []).map(String))];
  if (!ids.length) throw httpError(400, 'parcel_ids requis', 'CUSTOMS_PARCEL_IDS_REQUIRED');
  const why = reason == null ? '' : String(reason).trim();
  if (!why) throw httpError(400, 'reason obligatoire pour modifier la composition d\u2019un groupage', 'CUSTOMS_MEMBERSHIP_REASON_REQUIRED');
  return { ids, why };
}

async function _lockOpenShipment(client, shipmentId) {
  const { rows: [ship] } = await client.query(
    'SELECT * FROM customs_shipments WHERE id = $1 FOR UPDATE', [shipmentId]);
  if (!ship) throw httpError(404, 'Expédition introuvable', 'CUSTOMS_SHIPMENT_NOT_FOUND');
  if (ship.is_active === false) throw httpError(409, 'Expédition désactivée — la réactiver avant de modifier sa composition', 'CUSTOMS_SHIPMENT_INACTIVE');
  if (ship.status === 'confirmed') throw httpError(409, 'Expédition clôturée — composition verrouillée', 'CUSTOMS_SHIPMENT_CLOSED');
  return ship;
}

/** Persiste les parts manuelles (A4) dans allocation_config (audité) ; retourne l'expédition à jour. */
async function _applyManualSharesInTx(client, ship, rawShares) {
  const shares = normalizeManualShares(rawShares);
  if (!shares) return ship;
  if ((ship.allocation_method || 'by_cif_value') !== 'manual') {
    throw httpError(400, 'parcel_shares exige allocation_method = manual', 'CUSTOMS_SHARES_REQUIRE_MANUAL');
  }
  const { rows: [updated] } = await client.query(
    'UPDATE customs_shipments SET allocation_config = $2 WHERE id = $1 RETURNING *',
    [ship.id, JSON.stringify(withManualShares(ship.allocation_config, shares))]
  );
  return updated;
}

async function _recordMembershipEvents(client, shipmentId, parcelIds, event, actorId, reason) {
  for (const parcelId of parcelIds) {
    await client.query(
      `INSERT INTO customs_shipment_parcel_events (shipment_id, parcel_id, event, actor_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [shipmentId, parcelId, event, actorId == null ? null : String(actorId), reason]
    );
  }
}

/**
 * Ajoute des colis à une expédition ouverte (pending ou déclarée). Atomique : verrou expédition +
 * colis, contrôles marché / unicité / éligibilité, journal immuable, puis reventilation complète
 * (colis → commandes → articles) si le montant douane est connu.
 *
 * @param {{ id?: string, reason?: string }} actor
 * ✗ throws 400 | 404 | 409 | 422
 */
async function addParcelsToShipment(db, shipmentId, parcelIds, actor = {}) {
  const { ids, why } = _membershipInput(parcelIds, actor.reason);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalCustomsAuditContext(client, actor.id, why);
    let ship = await _lockOpenShipment(client, shipmentId);

    const linked = new Set((await _linkedParcelIds(client, shipmentId)).map(String));
    const fresh = ids.filter(id => !linked.has(id));
    if (!fresh.length) {
      await client.query('COMMIT');
      return { shipment_id: shipmentId, added: [], idempotent: true, parcels_total: linked.size };
    }
    await assertShipmentParcelMarket(client, shipmentId, fresh);
    await assertParcelsEligibleForGrouping(client, fresh, shipmentId);

    for (const pid of fresh) {
      await client.query(
        `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id) VALUES ($1, $2)`, [shipmentId, pid]);
    }
    await _recordMembershipEvents(client, shipmentId, fresh, 'attach', actor.id, why);
    ship = await _applyManualSharesInTx(client, ship, actor.parcel_shares);

    const all = await _linkedParcelIds(client, shipmentId);
    let reallocated = false;
    if (!isBlankAmount(ship.customs_paid_kmf) && ship.status === 'declared') {
      await _reallocateDeclared(client, shipmentId, ship, all);
      await markCustomsCleared(client, { parcelIds: fresh, notes: why });
      reallocated = true;
    } else {
      await propagateCostDouane(client, fresh);
    }
    await client.query('COMMIT');
    return { shipment_id: shipmentId, added: fresh, reallocated, parcels_total: all.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retire des colis d'une expédition ouverte. Mêmes garanties que l'ajout ; une expédition au
 * montant connu ne peut pas être vidée (la désactiver à la place).
 */
async function removeParcelsFromShipment(db, shipmentId, parcelIds, actor = {}) {
  const { ids, why } = _membershipInput(parcelIds, actor.reason);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalCustomsAuditContext(client, actor.id, why);
    let ship = await _lockOpenShipment(client, shipmentId);

    const linked = (await _linkedParcelIds(client, shipmentId)).map(String);
    if (ids.some(id => !linked.includes(id))) {
      throw httpError(409, 'Colis non rattaché à cette expédition', 'CUSTOMS_PARCEL_NOT_IN_SHIPMENT');
    }
    const remaining = linked.filter(id => !ids.includes(id));
    const amountKnown = !isBlankAmount(ship.customs_paid_kmf) && ship.status === 'declared';
    if (amountKnown && !remaining.length) {
      throw httpError(409, 'Retrait impossible : une expédition déclarée doit garder au moins un colis (la désactiver sinon)', 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS');
    }
    await client.query(
      `DELETE FROM customs_shipment_parcels WHERE shipment_id = $1 AND parcel_id = ANY($2::uuid[])`, [shipmentId, ids]);
    await _recordMembershipEvents(client, shipmentId, ids, 'detach', actor.id, why);
    ship = await _applyManualSharesInTx(client, ship, actor.parcel_shares);

    if (amountKnown) {
      await _reallocateDeclared(client, shipmentId, ship, remaining);
    }
    await propagateCostDouane(client, ids);
    await client.query('COMMIT');
    return { shipment_id: shipmentId, removed: ids, reallocated: amountKnown, parcels_total: remaining.length };
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
async function confirmCustomsShipmentsForOrder(q, orderId) {
  const { rows } = await q.query(
    `
    UPDATE customs_shipments cs
       SET status = 'confirmed',
           updated_at = NOW()
     WHERE cs.is_active = TRUE
       AND cs.status = 'declared'
       -- Clôture interdite sans affectation complète au centime : les lignes
       -- article de l'expédition couvrent exactement les montants déclarés.
       AND cs.customs_paid_kmf IS NOT NULL
       AND ROUND(cs.customs_paid_kmf * 100) = COALESCE((
         SELECT ROUND(SUM(a.amount_kmf) * 100)
           FROM order_item_real_cost_allocations a
          WHERE a.shipment_id = cs.id AND a.cost_type = 'customs'
       ), 0)
       AND (cs.freight_kmf IS NULL OR ROUND(cs.freight_kmf * 100) = COALESCE((
         SELECT ROUND(SUM(a.amount_kmf) * 100)
           FROM order_item_real_cost_allocations a
          WHERE a.shipment_id = cs.id AND a.cost_type = 'freight'
       ), 0))
       AND EXISTS (
         SELECT 1
           FROM customs_shipment_parcels csp
           JOIN parcels p ON p.id = csp.parcel_id
          WHERE csp.shipment_id = cs.id
            AND p.order_id = $1
       )
       AND NOT EXISTS (
         SELECT 1
           FROM customs_shipment_parcels csp
           JOIN parcels p ON p.id = csp.parcel_id
           JOIN orders o ON o.id = p.order_id
          WHERE csp.shipment_id = cs.id
            AND o.status NOT IN ('available', 'collected', 'cancelled', 'refunded')
       )
     RETURNING cs.id, cs.reference, cs.status
    `,
    [orderId]
  );

  return Object.freeze({
    confirmed: rows.length,
    shipments: Object.freeze(rows.map(row => Object.freeze({
      id: row.id,
      reference: row.reference,
      status: row.status,
    }))),
  });
}

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
