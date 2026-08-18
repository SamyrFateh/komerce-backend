/**
 * @komerce-arch
 * @role          logistics-parcel-optimization-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/parcelSync.js, utils/parcels.js, utils/reference.js
 * @used-by       none
 * @db-read       order_items, parcel_items, parcels, products
 * @db-write      orders, parcel_items, parcels
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Parcel Optimization Service
 * services/parcelOptimizationService.js
 *
 * Moteur d'optimisation pour la constitution automatique de colis.
 * Principe : "Le système remplit intelligemment des colis avec ce qu'il a."
 *
 * ── PURE FUNCTIONS (aucune requête DB) ──
 *   scoreParcelFit(item, parcel, config)
 *   suggestParcelForItem(item, openParcels, config)
 *   buildParcelsFromAvailableItems(params)
 *
 * ── FONCTION DB (accès PostgreSQL) ──
 *   bootstrapOrderParcels(orderId, pool)
 *
 * ── COLD START ──
 *   - Pénalité newParcelBaseCost = 0 si aucun colis ouvert (pas de comparaison possible)
 *   - Stratégie "anchor first" : le 1er item crée un colis ancre sans scoring
 *   - Guard-fous : items vides → retour vide, oversized → colis solo + warning
 *
 * Date : 2026-04-08
 */

'use strict';

const {
  setComputedStatus,
} = require('./order-mutation-service');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION PAR DÉFAUT
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG = Object.freeze({
  maxParcelWeightKg:    25,
  maxParcelVolumeCm3:   100_000,  // ~100L en cm3
  targetParcelValueKmf: 300_000,  // valeur cible par colis (KMF)
  minFillRateVolume:    0.6,
  minFillRateWeight:    0.4,
  allowMixedCategories: true,
  fragileBulkyPenalty:  20,
  overweightPenalty:    1000,
  overvolumePenalty:    1000,
  valueOverflowPenalty: 50,
  newParcelBaseCost:    10,
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES (exposés pour les tests)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trie les items par priorité de traitement :
 * bulky → poids élevé → volume élevé → fragile → petits items
 */
function _sortItemsByPriority(items) {
  return [...items].sort((a, b) => {
    // 1. bulky en premier
    if (a.is_bulky && !b.is_bulky) return -1;
    if (!a.is_bulky && b.is_bulky) return 1;
    // 2. poids total décroissant
    const wa = _itemTotalWeight(a);
    const wb = _itemTotalWeight(b);
    if (wb !== wa) return wb - wa;
    // 3. volume total décroissant
    const va = _itemTotalVolume(a);
    const vb = _itemTotalVolume(b);
    if (vb !== va) return vb - va;
    // 4. fragile avant non-fragile
    if (a.is_fragile && !b.is_fragile) return -1;
    if (!a.is_fragile && b.is_fragile) return 1;
    return 0;
  });
}

/** Poids total de l'item (unit_weight × quantity_available) */
function _itemTotalWeight(item) {
  return (parseFloat(item.unit_weight) || 0) * (parseInt(item.quantity_available) || 0);
}

/** Volume total de l'item (unit_volume × quantity_available) */
function _itemTotalVolume(item) {
  return (parseFloat(item.unit_volume) || 0) * (parseInt(item.quantity_available) || 0);
}

/** Valeur totale de l'item (unit_value × quantity_available) */
function _itemTotalValue(item) {
  return (parseFloat(item.unit_value) || 0) * (parseInt(item.quantity_available) || 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// scoreParcelFit(item, parcel, config)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule le score de compatibilité entre un item et un colis existant.
 *
 * @param {object} item    — { unit_weight, unit_volume, unit_value, quantity_available, is_fragile, is_bulky, category, compatibility_group }
 * @param {object} parcel  — { id|_id, current_weight, current_volume, current_value, max_weight, max_volume, status }
 * @param {object} config  — Configuration (DEFAULT_CONFIG par défaut)
 *
 * @returns {{ parcelId, score, valid, reasons, projected }}
 */
function scoreParcelFit(item, parcel, config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons = [];
  const parcelId = parcel.id ?? parcel._id ?? null;

  const itemWeight = _itemTotalWeight(item);
  const itemVolume = _itemTotalVolume(item);
  const itemValue  = _itemTotalValue(item);

  const maxWeight = parcel.max_weight ?? cfg.maxParcelWeightKg;
  const maxVolume = parcel.max_volume ?? cfg.maxParcelVolumeCm3;

  const projectedWeight = (parseFloat(parcel.current_weight) || 0) + itemWeight;
  const projectedVolume = (parseFloat(parcel.current_volume) || 0) + itemVolume;
  const projectedValue  = (parseFloat(parcel.current_value)  || 0) + itemValue;

  let score = 0;
  let valid = true;

  // ── Contraintes fortes (invalide si dépassé) ─────────────────────────────
  if (projectedWeight > maxWeight) {
    score -= cfg.overweightPenalty;
    valid = false;
    reasons.push(`overweight: ${projectedWeight.toFixed(2)}kg > ${maxWeight}kg`);
  }

  if (projectedVolume > maxVolume) {
    score -= cfg.overvolumePenalty;
    valid = false;
    reasons.push(`overvolume: ${projectedVolume.toFixed(0)}cm3 > ${maxVolume}cm3`);
  }

  if (!valid) {
    return {
      parcelId,
      score,
      valid: false,
      reasons,
      projected: { weight: projectedWeight, volume: projectedVolume, value: projectedValue },
    };
  }

  // ── Score de remplissage (0 → 100 chacun) ────────────────────────────────
  const fillWeight = maxWeight > 0 ? (projectedWeight / maxWeight) * 100 : 0;
  const fillVolume = maxVolume > 0 ? (projectedVolume / maxVolume) * 100 : 0;

  score += fillWeight;
  score += fillVolume;
  reasons.push(`fill_weight: ${fillWeight.toFixed(1)}%, fill_volume: ${fillVolume.toFixed(1)}%`);

  // ── Pénalité valeur excessive ─────────────────────────────────────────────
  if (cfg.targetParcelValueKmf > 0 && projectedValue > cfg.targetParcelValueKmf) {
    const overflow = projectedValue - cfg.targetParcelValueKmf;
    const penalty  = Math.min((overflow / cfg.targetParcelValueKmf) * cfg.valueOverflowPenalty, cfg.valueOverflowPenalty);
    score -= penalty;
    reasons.push(`value_overflow: ${projectedValue.toFixed(0)} KMF (penalty: -${penalty.toFixed(1)})`);
  }

  // ── Pénalité fragile + bulky ──────────────────────────────────────────────
  if (item.is_fragile || item.is_bulky) {
    score -= cfg.fragileBulkyPenalty;
    reasons.push(`fragile_bulky_penalty: -${cfg.fragileBulkyPenalty}`);
  }

  // ── Pénalité incompatibilité de catégorie ─────────────────────────────────
  if (!cfg.allowMixedCategories && parcel.category && item.category && parcel.category !== item.category) {
    score -= 20;
    reasons.push(`category_mismatch: ${parcel.category} vs ${item.category}`);
  }

  return {
    parcelId,
    score,
    valid: true,
    reasons,
    projected: { weight: projectedWeight, volume: projectedVolume, value: projectedValue },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// suggestParcelForItem(item, openParcels, config)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Détermine le meilleur colis pour un item parmi les colis ouverts.
 * Gère le cold start : si aucun colis ouvert, pas de pénalité newParcelBaseCost.
 *
 * @param {object}   item        — Item à placer
 * @param {object[]} openParcels — Colis ouverts (draft ou preparation, même order_id)
 * @param {object}   config      — Configuration
 *
 * @returns {{ action: 'assign_existing'|'create_new', parcelId: string|null, score: number, reasons: string[] }}
 */
function suggestParcelForItem(item, openParcels, config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── Cold start : aucun colis ouvert ──────────────────────────────────────
  if (!openParcels || openParcels.length === 0) {
    return {
      action: 'create_new',
      parcelId: null,
      score: 0,
      reasons: ['cold_start: no open parcels, creating anchor parcel (no penalty)'],
    };
  }

  // ── Scorer chaque colis ouvert ────────────────────────────────────────────
  const scores = openParcels.map(parcel => scoreParcelFit(item, parcel, cfg));
  const validScores = scores.filter(s => s.valid);

  // ── newParcelBaseCost adaptatif ────────────────────────────────────────────
  // Si des colis existent mais aucun n'est valide, on pénalise la création
  // pour signifier que c'est une vraie contrainte (pas juste un cold start)
  const newParcelCost = cfg.newParcelBaseCost;
  const createNewScore = -newParcelCost; // score "créer un nouveau colis"

  if (!validScores.length) {
    return {
      action: 'create_new',
      parcelId: null,
      score: createNewScore,
      reasons: ['no_valid_parcel: all existing parcels are over capacity'],
    };
  }

  // ── Meilleur colis valide ─────────────────────────────────────────────────
  const best = validScores.reduce((a, b) => (a.score > b.score ? a : b));

  if (best.score > createNewScore) {
    return {
      action: 'assign_existing',
      parcelId: best.parcelId,
      score: best.score,
      reasons: best.reasons,
    };
  }

  return {
    action: 'create_new',
    parcelId: null,
    score: createNewScore,
    reasons: [`create_new preferred (best score ${best.score.toFixed(1)} < new parcel cost ${newParcelCost})`],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildParcelsFromAvailableItems(params)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Orchestrateur principal : répartit les items dans des colis.
 * Stratégie "anchor first" : le 1er item crée un colis ancre sans scoring.
 * Fonctionne en cold start (existingParcels = []) ET en enrichissement.
 *
 * @param {object} params
 * @param {object[]} params.items           — Items disponibles à emballer
 * @param {object[]} params.existingParcels — Colis déjà ouverts (peut être [])
 * @param {object}   params.config          — Configuration (DEFAULT_CONFIG par défaut)
 *
 * @returns {{ createdParcels, updatedParcels, unassignedItems }}
 *
 * Chaque "created/updated parcel" est un objet { items: [...], total_weight, total_volume, total_value, warnings: [] }
 * Chaque "unassigned item" est { item, reason }
 */
function buildParcelsFromAvailableItems({ items = [], existingParcels = [], config = {} } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── Guard-fous ────────────────────────────────────────────────────────────
  if (!items.length) {
    return { createdParcels: [], updatedParcels: [], unassignedItems: [] };
  }

  // ── Filtrer items avec stock disponible ───────────────────────────────────
  const availableItems = [];
  const unassignedItems = [];

  for (const item of items) {
    if (!item.quantity_available || parseInt(item.quantity_available) <= 0) {
      unassignedItems.push({ item, reason: 'no_stock' });
    } else {
      availableItems.push(item);
    }
  }

  if (!availableItems.length) {
    return { createdParcels: [], updatedParcels: [], unassignedItems };
  }

  // ── Trier par priorité (bulky → lourd → volumineux → fragile → petits) ────
  const sortedItems = _sortItemsByPriority(availableItems);

  // ── Initialiser les colis de travail (existants + nouveaux à créer) ───────
  // Format interne : { _id, items, current_weight, current_volume, current_value, max_weight, max_volume, isNew, warnings }
  const workParcels = existingParcels.map(p => ({
    _id: p.id,
    items: [],
    current_weight: parseFloat(p.current_weight) || 0,
    current_volume: parseFloat(p.current_volume) || 0,
    current_value:  parseFloat(p.current_value)  || 0,
    max_weight: p.max_weight ?? cfg.maxParcelWeightKg,
    max_volume: p.max_volume ?? cfg.maxParcelVolumeCm3,
    isNew: false,
    warnings: [],
    category: p.category || null,
  }));

  let newParcelCounter = 0;

  function createNewWorkParcel() {
    newParcelCounter++;
    return {
      _id: `new_${newParcelCounter}`,
      items: [],
      current_weight: 0,
      current_volume: 0,
      current_value:  0,
      max_weight: cfg.maxParcelWeightKg,
      max_volume: cfg.maxParcelVolumeCm3,
      isNew: true,
      warnings: [],
      category: null,
    };
  }

  function assignItemToParcel(workParcel, item) {
    workParcel.items.push(item);
    workParcel.current_weight += _itemTotalWeight(item);
    workParcel.current_volume += _itemTotalVolume(item);
    workParcel.current_value  += _itemTotalValue(item);
    // Propager la catégorie du premier item si le colis n'en a pas
    if (!workParcel.category && item.category) {
      workParcel.category = item.category;
    }
  }

  // ── Traitement des items ──────────────────────────────────────────────────
  for (const item of sortedItems) {
    const itemWeight = _itemTotalWeight(item);

    // ── Cas oversized : item dépasse seul la limite de poids ────────────────
    if (itemWeight > cfg.maxParcelWeightKg) {
      const soloParcel = createNewWorkParcel();
      soloParcel.max_weight = itemWeight; // capacité étendue pour cet item
      assignItemToParcel(soloParcel, item);
      soloParcel.warnings.push(`oversized_item: ${itemWeight.toFixed(2)}kg > ${cfg.maxParcelWeightKg}kg (colis solo)`);
      workParcels.push(soloParcel);
      continue;
    }

    // ── Cold start / premier item → colis ancre (stratégie anchor first) ────
    const openParcels = workParcels.filter(p =>
      p.current_weight + _itemTotalWeight(item) <= p.max_weight &&
      p.current_volume + _itemTotalVolume(item) <= p.max_volume
    );

    if (openParcels.length === 0 && workParcels.length === 0) {
      // Aucun colis du tout → créer colis ancre sans scoring
      const anchor = createNewWorkParcel();
      assignItemToParcel(anchor, item);
      workParcels.push(anchor);
      continue;
    }

    // ── Suggestion moteur de scoring ─────────────────────────────────────────
    const suggestion = suggestParcelForItem(item, openParcels, cfg);

    if (suggestion.action === 'assign_existing' && suggestion.parcelId) {
      const target = workParcels.find(p => p._id === suggestion.parcelId);
      if (target) {
        assignItemToParcel(target, item);
        continue;
      }
    }

    // ── Créer un nouveau colis ────────────────────────────────────────────────
    const newParcel = createNewWorkParcel();
    assignItemToParcel(newParcel, item);
    workParcels.push(newParcel);
  }

  // ── Formater les résultats ────────────────────────────────────────────────
  const createdParcels = workParcels
    .filter(p => p.isNew)
    .map(p => ({
      _tempId: p._id,
      items: p.items,
      total_weight: parseFloat(p.current_weight.toFixed(3)),
      total_volume: parseFloat(p.current_volume.toFixed(3)),
      total_value:  parseFloat(p.current_value.toFixed(2)),
      warnings: p.warnings,
    }));

  const updatedParcels = workParcels
    .filter(p => !p.isNew && p.items.length > 0)
    .map(p => ({
      parcelId: p._id,
      addedItems: p.items,
      total_weight: parseFloat(p.current_weight.toFixed(3)),
      total_volume: parseFloat(p.current_volume.toFixed(3)),
      total_value:  parseFloat(p.current_value.toFixed(2)),
      warnings: p.warnings,
    }));

  return { createdParcels, updatedParcels, unassignedItems };
}

// ═══════════════════════════════════════════════════════════════════════════════
// bootstrapOrderParcels(orderId, pool)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Migre une commande legacy (sans parcels) vers le modèle parcel-centric.
 * C'est la SEULE fonction avec accès DB dans ce module.
 *
 * @param {string} orderId  — UUID de la commande à migrer
 * @param {object} pool     — Pool pg (require('../db'))
 * @param {object} config   — Configuration optionnelle
 *
 * @returns {{ createdParcels: object[], assignedItems: number, unassignedItems: object[] }}
 */
async function bootstrapOrderParcels(orderId, pool, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 1. Récupérer les order_items NON assignés à un parcel
  const { rows: rawItems } = await pool.query(`
    SELECT
      oi.id                AS order_item_id,
      oi.product_id,
      oi.quantity          AS quantity_available,
      oi.price_kmf         AS unit_value,
      p.weight_kg          AS unit_weight,
      p.volume_cm3         AS unit_volume,
      p.category,
      COALESCE(p.is_fragile, false) AS is_fragile,
      COALESCE(p.is_bulky, false)   AS is_bulky,
      p.compatibility_group
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id
    WHERE oi.order_id = $1
      AND pi.id IS NULL
  `, [orderId]);

  if (!rawItems.length) {
    return { createdParcels: [], assignedItems: 0, unassignedItems: [] };
  }

  // 2. Optimiser la répartition (cold start : existingParcels = [])
  const { createdParcels, unassignedItems } = buildParcelsFromAvailableItems({
    items: rawItems,
    existingParcels: [],
    config: cfg,
  });

  if (!createdParcels.length) {
    return { createdParcels: [], assignedItems: 0, unassignedItems };
  }

  // 3. Générer les références (séquentiellement pour éviter les collisions)
  const { generateParcelRef } = require('../utils/reference');

  const persistedParcels = [];
  let totalAssigned = 0;

  for (const cp of createdParcels) {
    const reference = await generateParcelRef(pool);

    // Déterminer le type de colis selon les items
    const hasBackorder = cp.items.every(i => !i.quantity_available || parseInt(i.quantity_available) <= 0);
    const type = hasBackorder ? 'backorder' : (createdParcels.length > 1 ? 'partial' : 'standard');

    // 4. Insérer le parcel
    const { rows: [parcel] } = await pool.query(`
      INSERT INTO parcels (reference, order_id, type, status, weight_kg, notes)
      VALUES ($1, $2, $3, 'draft', $4, $5)
      RETURNING *
    `, [
      reference,
      orderId,
      type,
      cp.total_weight || null,
      cp.warnings.length ? cp.warnings.join('; ') : null,
    ]);

    // 5. Insérer les parcel_items
    for (const item of cp.items) {
      await pool.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [parcel.id, item.order_item_id, item.product_id, item.quantity_available]);
      totalAssigned++;
    }

    persistedParcels.push({ ...parcel, items: cp.items, warnings: cp.warnings });
  }

  // 6. Recalculer orders.computed_status via parcelSync
  const { safeSyncScanToParcels } = require('../utils/parcelSync');
  // On passe step=null pour juste recalculer sans scan (le mapping STEP_TO_PARCEL retourne null → early return)
  // On utilise plutôt une query directe pour refresher computed_status
  const { computeOrderStatus } = require('../utils/parcels');
  const { rows: allParcels } = await pool.query(
    'SELECT status, type FROM parcels WHERE order_id = $1',
    [orderId]
  );
  const newStatus = computeOrderStatus(allParcels);
  await setComputedStatus(pool, {
    orderId,
    computedStatus: newStatus,
  });

  return {
    createdParcels: persistedParcels,
    assignedItems: totalAssigned,
    unassignedItems,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  DEFAULT_CONFIG,
  scoreParcelFit,
  suggestParcelForItem,
  buildParcelsFromAvailableItems,
  bootstrapOrderParcels,
  // Helpers exposés pour tests
  _sortItemsByPriority,
  _itemTotalWeight,
  _itemTotalVolume,
  _itemTotalValue,
};
