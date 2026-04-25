/**
 * KOMERCE — Cost Allocation Service (Lot C — Vérité terrain)
 * ═══════════════════════════════════════════════════════════
 *
 * Doctrine économique §6 et §11 :
 *   "On estime au produit avant vente.
 *    On constate au shipment ou au colis après terrain.
 *    On ventile intelligemment vers colis, lignes de commande et commandes."
 *
 * ⚠️  ÉTAT : STUBS — la vérité terrain n'est pas encore consommée
 * ────────────────────────────────────────────────────────────────────
 * Les fonctions ci-dessous ne sont PAS appelées par le runtime actuel.
 * Elles existent pour :
 *   1. Documenter les algorithmes de ventilation prévus par la doctrine
 *   2. Définir les signatures et formats d'entrée/sortie
 *   3. Fournir un fallback dégradé tant que les tables réelles ne sont
 *      pas remplies (chaque fonction renvoie un résultat avec
 *      `is_stub: true` et une raison explicite)
 *
 * Quand le terrain produira de la donnée réelle (customs_shipments
 * remplis, freight_real saisi), il suffira de remplacer les TODO
 * par la vraie logique. Les signatures ne changeront pas.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UNITÉS ÉCONOMIQUES (rappel doctrine §4) :
 *   - Produit          → unité de prix avant vente
 *   - Ligne de commande → snapshot commercial figé
 *   - Colis (parcel)    → unité de coût logistique réel
 *   - Shipment / customs_shipments → unité de facture terrain globale
 *   - Commande collectée → unité de rentabilité business
 *
 * TABLES DISPONIBLES :
 *   - customs_shipments         : 1 ligne par cargaison dédouanée (cif_value, customs_paid, freight)
 *   - customs_shipment_parcels  : ventilation calculée (shipment × parcel)
 *   - customs_history           : historique douane par parcel (customs_estimated_kmf, customs_real_kmf)
 *   - parcels                   : colis logistiques
 *   - parcel_items              : lignes de colis (parcel_id, order_item_id, quantity)
 *   - orders + order_items      : commandes et lignes commerciales
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');

// ═══════════════════════════════════════════════════════════════════════
// 1. ALLOCATE CUSTOMS COST
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ventile la douane RÉELLE d'un shipment vers ses colis et lignes d'articles.
 *
 * Doctrine §6.B :
 *   Méthode MVP : ventilation par valeur achat (proportion CIF).
 *     item_share = item_purchase_value / total_purchase_value
 *     customs_allocated_to_item = customs_real_total_kmf * item_share
 *
 *   Méthode cible : ventilation par valeur achat × coefficient risque catégorie.
 *     customs_weight_item = item_purchase_value * customs_risk_coeff
 *     customs_allocated_to_item = customs_real_total_kmf * customs_weight_item / total_customs_weight
 *
 * @param {string} shipmentId  — UUID du customs_shipment
 * @param {object} options     — { method: 'by_cif_value' (défaut) | 'by_weight' | 'mixed' }
 *
 * @returns {Promise<{
 *   shipment_id: string,
 *   total_customs_kmf: number,
 *   allocations: Array<{
 *     parcel_id: string,
 *     customs_share_kmf: number,
 *     allocation_basis: string,
 *     items: Array<{ order_item_id, share_kmf }>
 *   }>,
 *   is_stub: boolean,
 *   reason?: string
 * }>}
 */
async function allocateCustomsCost(shipmentId, options = {}) {
  // Charger le shipment et vérifier qu'il existe et est actif
  let shipment;
  try {
    const r = await db.query(
      'SELECT * FROM customs_shipments WHERE id = $1 AND is_active = TRUE',
      [shipmentId]
    );
    shipment = r.rows[0];
  } catch (err) {
    return {
      shipment_id: shipmentId,
      total_customs_kmf: 0,
      allocations: [],
      is_stub: true,
      reason: 'Table customs_shipments inaccessible : ' + err.message,
    };
  }

  if (!shipment) {
    return {
      shipment_id: shipmentId,
      total_customs_kmf: 0,
      allocations: [],
      is_stub: true,
      reason: 'Shipment introuvable ou inactif',
    };
  }

  const totalCustoms = Number(shipment.customs_paid_kmf) || 0;
  const method = options.method || shipment.allocation_method || 'by_cif_value';

  // TODO (vérité terrain) :
  // 1. Charger les parcels liés via customs_shipment_parcels
  // 2. Pour chaque parcel, calculer sa part selon `method` :
  //    - by_cif_value : parcel.parcel_cif_kmf / total_cif
  //    - by_weight    : parcel.parcel_weight_kg / total_weight
  //    - by_volume    : nécessite dimensions colis (à ajouter sur parcels)
  //    - mixed        : pondération via shipment.allocation_config (JSONB)
  //    - manual       : lire customs_share_kmf de customs_shipment_parcels
  // 3. Pour chaque parcel, ventiler sa part vers ses parcel_items
  //    (sous-ventilation interne par valeur achat des order_items liés).
  // 4. Persister les allocations dans customs_shipment_parcels.

  return {
    shipment_id: shipmentId,
    total_customs_kmf: totalCustoms,
    allocation_method: method,
    allocations: [],
    is_stub: true,
    reason: 'Stub Lot C — la ventilation réelle sera implémentée quand customs_shipments sera rempli en production',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. ALLOCATE FREIGHT COST
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ventile le fret RÉEL d'un shipment vers ses colis.
 *
 * Doctrine §6.C :
 *   Méthode simple : ventilation par poids.
 *     freight_allocated_to_item = freight_real_total_kmf * item_weight / total_weight
 *
 *   Méthode cible : par poids taxable (max entre poids réel et poids volumétrique).
 *     taxable_weight = max(real_weight, volumetric_weight)
 *     volumetric_weight = volume_m3 * 167  (norme aérienne) ou 1000 (mer)
 *     freight_allocated_to_item = freight_real_total * item_taxable / total_taxable
 *
 * @param {string} shipmentId
 * @param {object} options — { method: 'by_weight' (défaut) | 'by_volume' | 'taxable_weight', volumetric_factor: 167 }
 *
 * @returns {Promise<{
 *   shipment_id, total_freight_kmf, allocations: [{ parcel_id, freight_share_kmf }],
 *   is_stub: boolean, reason?: string
 * }>}
 */
async function allocateFreightCost(shipmentId, options = {}) {
  let shipment;
  try {
    const r = await db.query(
      'SELECT id, freight_kmf, total_weight_kg FROM customs_shipments WHERE id = $1 AND is_active = TRUE',
      [shipmentId]
    );
    shipment = r.rows[0];
  } catch (err) {
    return {
      shipment_id: shipmentId,
      total_freight_kmf: 0,
      allocations: [],
      is_stub: true,
      reason: 'Table customs_shipments inaccessible : ' + err.message,
    };
  }

  if (!shipment) {
    return {
      shipment_id: shipmentId,
      total_freight_kmf: 0,
      allocations: [],
      is_stub: true,
      reason: 'Shipment introuvable ou inactif',
    };
  }

  const totalFreight = Number(shipment.freight_kmf) || 0;
  const method = options.method || 'by_weight';

  // TODO (vérité terrain) :
  // 1. Charger parcels liés au shipment
  // 2. Pour chaque parcel, calculer son poids (parcel_weight_kg) ou poids taxable
  // 3. Ventiler proportionnellement
  // 4. Persister (table à créer : freight_allocations OU étendre customs_shipment_parcels avec freight_share_kmf)

  return {
    shipment_id: shipmentId,
    total_freight_kmf: totalFreight,
    allocation_method: method,
    allocations: [],
    is_stub: true,
    reason: 'Stub Lot C — la ventilation fret sera implémentée quand freight_kmf sera saisi sur les shipments',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. ALLOCATE SHIPMENT COSTS (orchestrateur)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Orchestre la ventilation complète d'un shipment :
 *   - Douane (allocateCustomsCost)
 *   - Fret (allocateFreightCost)
 *   - Port / transitaire / manutention (par colis ou par valeur)
 *
 * Doctrine §6.D :
 *   "Selon la donnée disponible : par colis, par commande, ou par valeur si lié au dossier douane.
 *    MVP : port/transitaire ventilé par colis puis par commande."
 *
 * @param {string} shipmentId
 *
 * @returns {Promise<{
 *   shipment_id, customs: {...}, freight: {...}, port_transitaire: {...},
 *   is_stub: boolean, reason?: string
 * }>}
 */
async function allocateShipmentCosts(shipmentId) {
  const customs = await allocateCustomsCost(shipmentId);
  const freight = await allocateFreightCost(shipmentId);

  // TODO (vérité terrain) :
  // - Port / transitaire / manutention : pas encore stockés explicitement
  //   sur customs_shipments. Ajouter colonnes : port_kmf, transitaire_kmf, manutention_kmf
  //   puis ventiler par colis (allocation simple uniforme ou pondérée comme la douane).

  return {
    shipment_id: shipmentId,
    customs,
    freight,
    port_transitaire: {
      total_kmf: 0,
      allocations: [],
      is_stub: true,
      reason: 'Stub Lot C — colonnes port/transitaire à ajouter sur customs_shipments',
    },
    is_stub: true,
    reason: 'Orchestrateur en mode stub — chaque sous-ventilation est un stub',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4. COMPUTE ORDER REAL CONTRIBUTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcule la contribution RÉELLE d'une commande collectée.
 *
 * Doctrine §5.G :
 *   real_contribution_kmf = paid_amount_kmf - variable_cost_real_kmf
 *
 * Le variable_cost_real_kmf agrège :
 *   - cost_kmf des produits (depuis order_items, snapshot vente)
 *   - sourcing réel (si tracé) ou estimation
 *   - douane réelle ventilée (via allocateCustomsCost)
 *   - fret réel ventilé (via allocateFreightCost)
 *   - port / transitaire ventilés
 *   - distribution réelle (commission relais, etc.)
 *   - frais paiement réels (Stripe, etc.)
 *
 * Si une partie est manquante, on dégrade vers l'estimé avec un warning.
 *
 * @param {string} orderId
 *
 * @returns {Promise<{
 *   order_id: string,
 *   paid_amount_kmf: number,
 *   variable_cost_real_kmf: number,
 *   real_contribution_kmf: number,
 *   breakdown: { product_cost, customs, freight, port_transitaire, distribution, payment, ... },
 *   warnings: string[],
 *   is_stub: boolean,
 *   reason?: string
 * }>}
 */
async function computeOrderRealContribution(orderId) {
  const warnings = [];

  // Charger order et order_items
  let order, items;
  try {
    const orderRes = await db.query(
      `SELECT id, paid_amount_kmf, total_kmf, status
         FROM orders WHERE id = $1`,
      [orderId]
    );
    order = orderRes.rows[0];
    if (!order) {
      return {
        order_id: orderId,
        paid_amount_kmf: 0,
        variable_cost_real_kmf: 0,
        real_contribution_kmf: 0,
        breakdown: {},
        warnings: ['Commande introuvable'],
        is_stub: true,
        reason: 'Order not found',
      };
    }

    const itemsRes = await db.query(
      `SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price_kmf, oi.unit_cost_kmf,
              p.name AS product_name, p.cost_kmf AS product_current_cost_kmf
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1`,
      [orderId]
    );
    items = itemsRes.rows;
  } catch (err) {
    return {
      order_id: orderId,
      paid_amount_kmf: 0,
      variable_cost_real_kmf: 0,
      real_contribution_kmf: 0,
      breakdown: {},
      warnings: ['Erreur chargement order/items : ' + err.message],
      is_stub: true,
      reason: 'DB error',
    };
  }

  const paidAmount = Number(order.paid_amount_kmf || order.total_kmf) || 0;

  // ── Coût produits (depuis order_items, fallback products.cost_kmf) ──
  let productCost = 0;
  for (const it of items) {
    const unitCost = Number(it.unit_cost_kmf || it.product_current_cost_kmf) || 0;
    if (!it.unit_cost_kmf) {
      warnings.push(`Item ${it.id} sans unit_cost_kmf snapshot — fallback sur product.cost_kmf`);
    }
    productCost += unitCost * Number(it.quantity || 1);
  }

  // TODO (vérité terrain) — agréger les coûts réels via les parcels de la commande :
  //   1. Trouver les parcels de cette order (SELECT id FROM parcels WHERE order_id = $1)
  //   2. Pour chaque parcel, lire customs_shipment_parcels.customs_share_kmf (douane réelle)
  //      et la part fret correspondante.
  //   3. Sommer les parts pour obtenir le coût réel logistique de cette commande.
  //   4. Ajouter distribution réelle (commission relais effectivement versée)
  //      et frais paiement réels (Stripe transaction fee, depuis payments).

  return {
    order_id: orderId,
    paid_amount_kmf: paidAmount,
    variable_cost_real_kmf: productCost,  // partiel : juste produits
    real_contribution_kmf: paidAmount - productCost,
    breakdown: {
      product_cost_kmf: productCost,
      customs_real_kmf: null,
      freight_real_kmf: null,
      port_transitaire_real_kmf: null,
      distribution_real_kmf: null,
      payment_real_kmf: null,
    },
    warnings: [
      ...warnings,
      'Stub Lot C — seuls les coûts produits sont agrégés. Douane/fret/distribution réels à câbler quand les ventilations seront faites.',
    ],
    is_stub: true,
    reason: 'Coûts logistiques réels pas encore ventilés',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. COMPUTE ORDER REAL MARGIN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcule la marge RÉELLE d'une commande collectée.
 *
 * Doctrine §5.E (forme générale, appliquée au prix payé et aux coûts réels) :
 *   real_margin_pct = (paid_amount_kmf - variable_cost_real_kmf) / paid_amount_kmf
 *
 * Note : différent du `estimated_margin_pct` calculé sur les coûts estimés.
 *
 * @param {string} orderId
 *
 * @returns {Promise<{
 *   order_id, paid_amount_kmf, variable_cost_real_kmf,
 *   real_margin_pct, real_contribution_kmf, breakdown, warnings,
 *   is_stub: boolean
 * }>}
 */
async function computeOrderRealMargin(orderId) {
  const contrib = await computeOrderRealContribution(orderId);
  const paid = contrib.paid_amount_kmf;
  const varCost = contrib.variable_cost_real_kmf;

  const realMarginPct = paid > 0 ? Number(((paid - varCost) / paid * 100).toFixed(1)) : null;

  return {
    order_id: orderId,
    paid_amount_kmf: paid,
    variable_cost_real_kmf: varCost,
    real_margin_pct: realMarginPct,
    real_contribution_kmf: contrib.real_contribution_kmf,
    breakdown: contrib.breakdown,
    warnings: contrib.warnings,
    is_stub: contrib.is_stub,
    reason: contrib.reason,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS DE VENTILATION (utilitaires purs, testables)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcule les parts proportionnelles d'un total selon un poids.
 * Pure function — facile à tester sans BDD.
 *
 * @param {number} total — montant à ventiler
 * @param {Array<{ id: string, weight: number }>} entries — entrées avec un poids (CIF, kg, m³, etc.)
 *
 * @returns {Array<{ id, share, share_pct }>}
 *
 * Exemple :
 *   shareByWeight(100000, [{id:'A', weight:60}, {id:'B', weight:40}])
 *   → [{ id:'A', share: 60000, share_pct: 60 }, { id:'B', share: 40000, share_pct: 40 }]
 */
function shareByWeight(total, entries) {
  const totalWeight = entries.reduce((s, e) => s + Number(e.weight || 0), 0);
  if (totalWeight === 0 || !entries.length) {
    return entries.map(e => ({ id: e.id, share: 0, share_pct: 0 }));
  }
  return entries.map(e => {
    const w = Number(e.weight || 0);
    const sharePct = (w / totalWeight) * 100;
    return {
      id: e.id,
      share: Math.round(total * w / totalWeight),
      share_pct: Math.round(sharePct * 100) / 100,
    };
  });
}

/**
 * Calcule le poids taxable selon norme transport.
 *
 * @param {number} weightKg — poids réel en kg
 * @param {number} volumeM3 — volume en m³
 * @param {string} mode — 'air' (facteur 167) ou 'sea' (facteur 1000)
 *
 * @returns {number} poids taxable (le max entre réel et volumétrique)
 */
function taxableWeight(weightKg, volumeM3, mode = 'sea') {
  const factor = mode === 'air' ? 167 : 1000;
  const volumetricKg = (Number(volumeM3) || 0) * factor;
  return Math.max(Number(weightKg) || 0, volumetricKg);
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Stubs principaux (signature stable, implémentation à compléter)
  allocateCustomsCost,
  allocateFreightCost,
  allocateShipmentCosts,
  computeOrderRealContribution,
  computeOrderRealMargin,

  // Helpers purs (déjà fonctionnels, testables)
  shareByWeight,
  taxableWeight,
};
