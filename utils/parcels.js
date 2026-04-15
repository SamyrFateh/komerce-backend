/**
 * KOMERCE — Moteur Parcel-Centric (utils/parcels.js)
 *
 * Phase 1 : Fondations — Ce module pose la logique métier des colis
 * sans toucher au flux existant. Il sera câblé aux endpoints en Phase 2.
 *
 * ── Architecture ────────────────────────────────────────────────────────
 *   computeOrderStatus(parcels)
 *     → Calcule le statut agrégé d'une commande à partir de ses colis.
 *       Remplacera le trigger trg_scan_sync_status en Phase 3.
 *
 *   splitOrderIntoParcels(orderItems, availabilityMap, options)
 *     → Découpe les articles d'une commande en colis selon la stratégie
 *       par défaut. Extensible via le registre STRATEGIES.
 *
 *   STRATEGIES (registre)
 *     → Map de fonctions nommées. La stratégie active est lue depuis
 *       business_rules (PARCEL_DEFAULT_SPLIT_STRATEGY).
 *       Pour ajouter une règle métier future (seuil, regroupement
 *       fournisseur, attente courte…) : ajouter une entrée ici +
 *       une ligne dans business_rules. Zéro migration nécessaire.
 *
 * ── Dépendances ─────────────────────────────────────────────────────────
 *   utils/rules.js  → getRule(), getRuleNumber()
 *   utils/reference.js → generateParcelRef()
 * ════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getRule, getRuleNumber } = require('./rules');
const { generateParcelRef } = require('./reference');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

/** Types de colis — miroir de la contrainte CHECK en DB */
const PARCEL_TYPES = Object.freeze({
  STANDARD:       'standard',
  PARTIAL:        'partial',
  BACKORDER:      'backorder',
  AWAITING_STOCK: 'awaiting_stock',
});

/** Pipeline logistique — miroir de l'ENUM parcel_status en DB */
const PARCEL_STATUSES = Object.freeze({
  DRAFT:       'draft',
  PREPARATION: 'preparation',
  SHIPPED:     'shipped',
  IN_TRANSIT:  'in_transit',
  ARRIVED:     'arrived',
  AVAILABLE:   'available',
  COLLECTED:   'collected',
  CANCELLED:   'cancelled',
});

/**
 * Poids de chaque statut logistique pour le calcul agrégé.
 * Plus le poids est élevé, plus le colis est avancé.
 */
const STATUS_WEIGHT = Object.freeze({
  [PARCEL_STATUSES.CANCELLED]:   -1,
  [PARCEL_STATUSES.DRAFT]:        0,
  [PARCEL_STATUSES.PREPARATION]:  1,
  [PARCEL_STATUSES.SHIPPED]:      2,
  [PARCEL_STATUSES.IN_TRANSIT]:   3,
  [PARCEL_STATUSES.ARRIVED]:      4,
  [PARCEL_STATUSES.AVAILABLE]:    5,
  [PARCEL_STATUSES.COLLECTED]:    6,
});


// ═══════════════════════════════════════════════════════════════════════════════
// 2. computeOrderStatus(parcels)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule le statut agrégé d'une commande à partir de ses colis.
 *
 * ⚠️  FIX-001 (7 avril 2026) — Toutes les valeurs retournées sont maintenant
 *     des valeurs valides de l'ENUM order_status :
 *     confirmed, ordered, preparation, shipped, in_transit, available,
 *     collected, cancelled, refunded.
 *
 * Règles :
 *   1. Si aucun colis actif → 'confirmed' (commande pas encore traitée)
 *   2. Si TOUS collected    → 'collected'
 *   3. Si TOUS cancelled    → 'cancelled'
 *   4. Si AU MOINS UN available et aucun en mouvement → 'available'
 *   5. Sinon → statut du colis LE MOINS AVANCÉ (hors cancelled)
 *      → Garantit que le client voit le "pire cas" de sa commande
 *
 * @param {Array<{status: string, type: string}>} parcels - Les colis de la commande
 * @returns {string} Statut agrégé compatible avec orders.status (ENUM order_status)
 */
function computeOrderStatus(parcels) {
  // Aucun colis → commande pas encore traitée logistiquement
  if (!parcels || parcels.length === 0) return 'confirmed';

  const active = parcels.filter(p => p.status !== PARCEL_STATUSES.CANCELLED);

  // Tous annulés → commande annulée
  if (active.length === 0) return 'cancelled';

  // Tous collectés → commande terminée
  if (active.every(p => p.status === PARCEL_STATUSES.COLLECTED)) return 'collected';

  // ── FIX S2: Partiellement collecté → ambiguïté, on ne touche pas ──
  // Certains colis récupérés mais pas tous → la state machine décidera
  const someCollected = active.some(p => p.status === PARCEL_STATUSES.COLLECTED);
  if (someCollected) return null;

  // Au moins un disponible, aucun en mouvement → commande dispo
  const inMovement = active.some(p =>
    [PARCEL_STATUSES.SHIPPED, PARCEL_STATUSES.IN_TRANSIT, PARCEL_STATUSES.ARRIVED].includes(p.status)
  );
  const someAvailable = active.some(p => p.status === PARCEL_STATUSES.AVAILABLE);
  if (someAvailable && !inMovement) return 'available';

  // ── FIX S2: Tous en draft → pending (pas preparation) ──
  if (active.every(p => p.status === PARCEL_STATUSES.DRAFT)) return 'pending';

  // Sinon : le statut du colis le moins avancé (pire cas)
  const lowestStatus = active.reduce((lowest, p) => {
    const w = STATUS_WEIGHT[p.status] ?? 0;
    const lw = STATUS_WEIGHT[lowest] ?? 0;
    return w < lw ? p.status : lowest;
  }, active[0].status);

  // Mapping parcel_status → order_status (ENUM valides uniquement)
  const PARCEL_TO_ORDER = {
    [PARCEL_STATUSES.DRAFT]:       'preparation',
    [PARCEL_STATUSES.PREPARATION]: 'preparation',
    [PARCEL_STATUSES.SHIPPED]:     'shipped',
    [PARCEL_STATUSES.IN_TRANSIT]:  'in_transit',
    [PARCEL_STATUSES.ARRIVED]:     'in_transit',   // arrived au port ≠ available au relais
    [PARCEL_STATUSES.AVAILABLE]:   'available',
    [PARCEL_STATUSES.COLLECTED]:   'collected',
  };

  return PARCEL_TO_ORDER[lowestStatus] || 'preparation';
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. REGISTRE DE STRATÉGIES DE SPLIT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Registre des stratégies de split.
 *
 * Pour ajouter une stratégie future :
 *   1. Écrire la fonction ici (même signature que defaultStrategy)
 *   2. L'enregistrer dans STRATEGIES
 *   3. Changer la valeur de PARCEL_DEFAULT_SPLIT_STRATEGY en DB
 *   → Zéro migration, zéro redéploiement si la stratégie existe déjà
 *
 * Exemples de stratégies futures :
 *   - 'wait_short'        : si stock arrive sous 3 jours, ne pas splitter
 *   - 'group_by_supplier' : 1 colis par fournisseur
 *   - 'min_threshold'     : ne splitter que si ≥ N articles dispo
 *   - 'vip_priority'      : tout en standard pour les clients VIP
 */
const STRATEGIES = {};

/**
 * Stratégie par défaut :
 *   - Si tout est disponible → 1 colis standard
 *   - Sinon → 1 colis partial (ce qui est dispo) + 1 colis backorder (le reste)
 *   - Si rien n'est disponible → 1 colis awaiting_stock
 *
 * @param {Array<{order_item_id, product_id, quantity, available_qty}>} items
 * @param {object} options - { minItemsForPartial }
 * @returns {Array<{type: string, label: string, items: Array}>} Plan de colis
 */
function defaultStrategy(items, options = {}) {
  const { minItemsForPartial = 1 } = options;

  const available = [];
  const backordered = [];

  for (const item of items) {
    const avail = item.available_qty ?? 0;
    const needed = item.quantity;

    if (avail >= needed) {
      // Tout est dispo pour cet article
      available.push({ ...item, parcel_qty: needed });
    } else if (avail > 0) {
      // Partiellement dispo
      available.push({ ...item, parcel_qty: avail });
      backordered.push({ ...item, parcel_qty: needed - avail });
    } else {
      // Rien de dispo
      backordered.push({ ...item, parcel_qty: needed });
    }
  }

  const parcels = [];

  // Tout dispo → 1 colis standard
  if (backordered.length === 0 && available.length > 0) {
    parcels.push({
      type: PARCEL_TYPES.STANDARD,
      label: 'Colis complet',
      items: available,
    });
    return parcels;
  }

  // Rien de dispo → 1 colis awaiting_stock
  if (available.length === 0) {
    parcels.push({
      type: PARCEL_TYPES.AWAITING_STOCK,
      label: 'En attente de stock',
      items: backordered,
    });
    return parcels;
  }

  // Mix : partial + backorder (si assez d'articles pour le partial)
  if (available.length >= minItemsForPartial) {
    parcels.push({
      type: PARCEL_TYPES.PARTIAL,
      label: `Envoi partiel (${available.length} article${available.length > 1 ? 's' : ''})`,
      items: available,
    });
  } else {
    // Pas assez pour justifier un envoi partiel → tout en backorder
    backordered.push(...available.map(a => ({ ...a, parcel_qty: a.parcel_qty })));
  }

  if (backordered.length > 0) {
    parcels.push({
      type: PARCEL_TYPES.BACKORDER,
      label: 'Reliquat en attente',
      items: backordered,
    });
  }

  return parcels;
}

STRATEGIES['default'] = defaultStrategy;

// Exemple placeholder pour futures stratégies :
// STRATEGIES['wait_short'] = function(items, options) { ... };
// STRATEGIES['group_by_supplier'] = function(items, options) { ... };


// ═══════════════════════════════════════════════════════════════════════════════
// 4. splitOrderIntoParcels(orderItems, availabilityMap, db)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Orchestre le split d'une commande en colis.
 *
 * @param {Array} orderItems - Articles de la commande avec {order_item_id, product_id, quantity}
 * @param {Map|Object} availabilityMap - product_id → quantité disponible
 * @param {object} db - Instance pg pool/client (pour generateParcelRef + lire les règles)
 * @returns {Promise<Array<{type, label, reference, items}>>} Plan de colis avec références
 */
async function splitOrderIntoParcels(orderItems, availabilityMap, db) {
  // Lire la stratégie active depuis business_rules
  const strategyName = await getRule('PARCEL_DEFAULT_SPLIT_STRATEGY', 'default');
  const minItems = await getRuleNumber('PARCEL_SPLIT_MIN_ITEMS_FOR_PARTIAL', 1);

  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    console.warn(`[PARCELS] Stratégie "${strategyName}" introuvable, fallback → default`);
  }
  const fn = strategy || STRATEGIES['default'];

  // Enrichir les items avec la dispo
  const enrichedItems = orderItems.map(item => ({
    ...item,
    available_qty: (availabilityMap instanceof Map
      ? availabilityMap.get(item.product_id)
      : availabilityMap[item.product_id]) ?? 0,
  }));

  // Exécuter la stratégie
  const plan = fn(enrichedItems, { minItemsForPartial: minItems });

  // Générer les références pour chaque colis
  for (const parcel of plan) {
    parcel.reference = await generateParcelRef(db);
  }

  return plan;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enregistre une nouvelle stratégie de split.
 * Utilisable par des plugins ou modules futurs.
 *
 * @param {string} name - Nom unique de la stratégie
 * @param {function} fn - Fonction (items, options) → Array<parcel plan>
 */
function registerStrategy(name, fn) {
  if (typeof fn !== 'function') throw new Error('La stratégie doit être une fonction');
  STRATEGIES[name] = fn;
}

/**
 * Liste les stratégies disponibles.
 * @returns {string[]}
 */
function listStrategies() {
  return Object.keys(STRATEGIES);
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Constantes
  PARCEL_TYPES,
  PARCEL_STATUSES,
  STATUS_WEIGHT,

  // Calcul statut agrégé
  computeOrderStatus,

  // Split commande → colis
  splitOrderIntoParcels,

  // Extensibilité
  registerStrategy,
  listStrategies,
  STRATEGIES,
};
