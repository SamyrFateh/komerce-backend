/**
 * @komerce-arch
 * @role          logistics-parcels
 * @domain        logistics
 * @layer         util
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

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
 *   computeOrderStatusDetail(parcels)
 *     → Calcule un détail UX client dérivé des colis.
 *       Ne modifie pas orders.status — lecture seule, calcul pur.
 *
 *   getOrderStatusDetailMessage(detail)
 *     → Retourne le message client français pour un status_detail donné.
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
const log = require('../utils/logger').child({ module: 'parcels' });

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
// 2. computeOrderStatus(parcels)  — FONCTION CANONIQUE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule le statut agrégé d'une commande à partir de ses colis.
 *
 * ─── CONTRAT ───────────────────────────────────────────────────────────────────
 *  • Entrée  : tableau de colis (tous statuts confondus, y compris cancelled)
 *  • Sortie  : statut order_status ENUM valide
 *              OU null si le tableau est vide (cas technique — skip sync)
 *
 *  ⚠️  Cette fonction ne doit PAS être appelée avec un tableau vide si l'on
 *      veut un vrai statut métier. L'appelant est responsable de ce garde
 *      (ex: parcelSync retourne { skipped: true } si aucun colis).
 *      Un tableau vide ici = absence de contexte logistique → null = skip.
 *
 * ─── RÈGLES MÉTIER (par ordre de priorité) ─────────────────────────────────────
 *  A. Aucun colis            → null  (cas technique, traité par l'appelant)
 *  B. Tous cancelled         → 'cancelled'
 *  C. Tous collected         → 'collected'
 *  F. Tous draft             → 'preparation'  (jamais 'pending')
 *     └─ 'pending' = commande créée/non payée, avant toute logistique.
 *        Si des colis existent, la mécanique logistique a démarré
 *        → 'preparation' est le seul statut métier correct.
 *  E. Partiellement collected (≥1 collected, pas tous)
 *                            → 'available'   (jamais null)
 *     └─ Au moins une partie a été retirée ou est disponible.
 *        Un vrai statut exploitable > silence ambigu.
 *  D. Au moins un available et aucun colis en mouvement
 *     (shipped / in_transit / arrived)
 *                            → 'available'
 *  G. Sinon → "pire cas visible client" parmi les colis actifs :
 *        draft / preparation → 'preparation'
 *        shipped             → 'shipped'
 *        in_transit / arrived→ 'in_transit'
 *        available           → 'available'
 *        collected           → 'collected'
 *
 * ─── SÉMANTIQUE DES STATUTS COMMANDE ──────────────────────────────────────────
 *  pending     = commande créée, en attente de paiement          (avant colis)
 *  confirmed   = paiement reçu, pas encore de matérialisation     (avant colis)
 *  preparation = colis existants, encore en draft / préparation
 *  shipped     = en cours d'expédition
 *  in_transit  = en transit / arrivé au port, pas encore dispo relais
 *  available   = disponible au retrait (partiellement ou totalement)
 *  collected   = tout récupéré
 *  cancelled   = tout annulé
 *
 * @param {Array<{status: string, type?: string}>} parcels  Colis de la commande
 * @returns {string|null}  Statut order_status ENUM, ou null si aucun colis
 */
function computeOrderStatus(parcels) {
  // ── A. Cas technique : aucun colis ──────────────────────────────────────────
  // null = "aucun contexte logistique" → l'appelant gère ce cas (skip sync).
  // La commande conserve son statut actuel (ex: confirmed, pending).
  if (!parcels || parcels.length === 0) return null;

  // Colis actifs = tous sauf annulés
  const active = parcels.filter(p => p.status !== PARCEL_STATUSES.CANCELLED);

  // ── B. Tous annulés → cancelled ─────────────────────────────────────────────
  if (active.length === 0) return 'cancelled';

  // ── C. Tous collectés → collected ───────────────────────────────────────────
  if (active.every(p => p.status === PARCEL_STATUSES.COLLECTED)) return 'collected';

  // ── F. Tous en draft → preparation (jamais pending) ────────────────────────
  // Si des colis existent, la logistique a démarré même si rien n'est encore packed.
  // 'pending' est réservé aux commandes sans colis (en attente de paiement).
  if (active.every(p => p.status === PARCEL_STATUSES.DRAFT)) return 'preparation';

  // ── E. Partiellement collecté → available (jamais null) ─────────────────────
  // Au moins un colis récupéré = au moins une partie est disponible/retirée.
  // On préfère un vrai statut exploitable à une absence de décision.
  const someCollected = active.some(p => p.status === PARCEL_STATUSES.COLLECTED);
  if (someCollected) return 'available';

  // ── D. Au moins un dispo, aucun en mouvement → available ────────────────────
  const inMovement = active.some(p =>
    [PARCEL_STATUSES.SHIPPED, PARCEL_STATUSES.IN_TRANSIT, PARCEL_STATUSES.ARRIVED].includes(p.status)
  );
  const someAvailable = active.some(p => p.status === PARCEL_STATUSES.AVAILABLE);
  if (someAvailable && !inMovement) return 'available';

  // ── G. Pire cas visible client ───────────────────────────────────────────────
  // Parmi tous les colis actifs, on prend le statut le moins avancé.
  // Garantit que le client voit l'état le plus défavorable de sa commande.
  const lowestStatus = active.reduce((lowest, p) => {
    const w  = STATUS_WEIGHT[p.status] ?? 0;
    const lw = STATUS_WEIGHT[lowest]   ?? 0;
    return w < lw ? p.status : lowest;
  }, active[0].status);

  // Mapping parcel_status → order_status (ENUM valides uniquement)
  const PARCEL_TO_ORDER = {
    [PARCEL_STATUSES.DRAFT]:       'preparation',
    [PARCEL_STATUSES.PREPARATION]: 'preparation',
    [PARCEL_STATUSES.SHIPPED]:     'shipped',
    [PARCEL_STATUSES.IN_TRANSIT]:  'in_transit',
    [PARCEL_STATUSES.ARRIVED]:     'in_transit',  // arrived port ≠ available relais
    [PARCEL_STATUSES.AVAILABLE]:   'available',
    [PARCEL_STATUSES.COLLECTED]:   'collected',
  };

  return PARCEL_TO_ORDER[lowestStatus] ?? 'preparation';
}

/*
 * ─── MINI TESTS UNITAIRES (cas commentés) ──────────────────────────────────────
 *
 * Pour exécuter manuellement : copier-coller dans un REPL Node.js avec
 * les constantes PARCEL_STATUSES / STATUS_WEIGHT disponibles.
 *
 * computeOrderStatus([])\
 *   → null  (cas technique, aucun colis)
 *
 * computeOrderStatus([{ status: 'cancelled' }, { status: 'cancelled' }])
 *   → 'cancelled'  (B: tous annulés)
 *
 * computeOrderStatus([{ status: 'collected' }, { status: 'collected' }])
 *   → 'collected'  (C: tous collectés)
 *
 * computeOrderStatus([{ status: 'collected' }, { status: 'available' }])
 *   → 'available'  (E: partiellement collecté → jamais null)
 *
 * computeOrderStatus([{ status: 'collected' }, { status: 'shipped' }])
 *   → 'available'  (E: someCollected = true → prioritaire)
 *
 * computeOrderStatus([{ status: 'draft' }, { status: 'draft' }])
 *   → 'preparation'  (F: tous draft → preparation, jamais pending)
 *
 * computeOrderStatus([{ status: 'draft' }, { status: 'cancelled' }])
 *   → 'preparation'  (F: seul actif est draft)
 *
 * computeOrderStatus([{ status: 'shipped' }, { status: 'available' }])
 *   → 'shipped'  (G: inMovement=true, someCollected=false → pire cas = shipped)
 *
 * computeOrderStatus([{ status: 'available' }])
 *   → 'available'  (D: someAvailable=true, inMovement=false)
 *
 * computeOrderStatus([{ status: 'arrived' }, { status: 'preparation' }])
 *   → 'preparation'  (G: pire cas = preparation, poids 1 < arrived poids 4)
 *
 * computeOrderStatus([{ status: 'in_transit' }, { status: 'available' }])
 *   → 'in_transit'  (G: inMovement=true, pire cas = in_transit)
 * ─────────────────────────────────────────────────────────────────────────────
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 2b. computeOrderStatusDetail(parcels)  — SECOND NIVEAU UX CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule un détail UX client dérivé des colis pour affiner l'information
 * au-delà du statut global orders.status.
 *
 * ─── CONTRAT ───────────────────────────────────────────────────────────────────
 *  • Entrée  : tableau de colis (tous statuts confondus, y compris cancelled)
 *  • Sortie  : string parmi les valeurs STATUS_DETAIL — jamais null
 *  • Ne modifie RIEN — fonction pure, sans effet de bord
 *  • Ne remplace PAS orders.status — information complémentaire seulement
 *
 * ─── VALEURS POSSIBLES ─────────────────────────────────────────────────────────
 *  full_available       Toute la commande est disponible au relais
 *  partial_available    Une partie dispo, le reste en mouvement
 *  partial_collected    Une partie retirée, le reste suit son cours
 *  remaining_in_transit Une partie traitée/retirée, le reste en transit
 *  awaiting_stock       Tout en attente de prépa / stock
 *  fully_collected      Toute la commande récupérée
 *  fully_cancelled      Toute la commande annulée
 *  none                 Aucun détail utile supplémentaire
 *
 * ─── RÈGLES MÉTIER (par ordre de priorité) ─────────────────────────────────────
 *  1. Aucun colis                                        → 'none'
 *  2. Tous cancelled                                     → 'fully_cancelled'
 *  3. Tous collected                                     → 'fully_collected'
 *  4. ≥1 collected + ≥1 en mouvement (shipped/in_transit/arrived)
 *                                                        → 'remaining_in_transit'
 *  5. ≥1 collected + ≥1 available                       → 'partial_collected'
 *  6. ≥1 collected (sans tous collected)                 → 'partial_collected'
 *  7. ≥1 available + ≥1 en mouvement                    → 'partial_available'
 *  8. Tous les actifs sont available                     → 'full_available'
 *  9. Tous les actifs en draft/preparation/backorder/awaiting_stock
 *                                                        → 'awaiting_stock'
 * 10. Sinon                                              → 'none'
 *
 * @param {Array<{status: string}>} parcels  Colis de la commande
 * @returns {string}  Valeur de détail UX — jamais null
 */
function computeOrderStatusDetail(parcels) {
  // ── 1. Aucun colis ──────────────────────────────────────────────────────────
  if (!parcels || parcels.length === 0) return 'none';

  // Colis actifs = tous sauf annulés
  const active = parcels.filter(p => p.status !== PARCEL_STATUSES.CANCELLED);

  // ── 2. Tous annulés ─────────────────────────────────────────────────────────
  if (active.length === 0) return 'fully_cancelled';

  // ── 3. Tous collectés ───────────────────────────────────────────────────────
  if (active.every(p => p.status === PARCEL_STATUSES.COLLECTED)) return 'fully_collected';

  const someCollected = active.some(p => p.status === PARCEL_STATUSES.COLLECTED);
  const someAvailable = active.some(p => p.status === PARCEL_STATUSES.AVAILABLE);
  const inMovement    = active.some(p =>
    [PARCEL_STATUSES.SHIPPED, PARCEL_STATUSES.IN_TRANSIT, PARCEL_STATUSES.ARRIVED].includes(p.status)
  );

  // ── 4. Au moins un collecté + en mouvement ──────────────────────────────────
  if (someCollected && inMovement) return 'remaining_in_transit';

  // ── 5+6. Au moins un collecté (pas tous) ────────────────────────────────────
  // Qu'il reste du available ou non, c'est une collecte partielle.
  if (someCollected) return 'partial_collected';

  // ── 7. Au moins un dispo + encore en mouvement ──────────────────────────────
  if (someAvailable && inMovement) return 'partial_available';

  // ── 8. Tous les actifs sont available ───────────────────────────────────────
  if (active.every(p => p.status === PARCEL_STATUSES.AVAILABLE)) return 'full_available';

  // ── 9. Tout en attente de stock / prépa ─────────────────────────────────────
  const AWAITING = [
    PARCEL_STATUSES.DRAFT,
    PARCEL_STATUSES.PREPARATION,
    'backorder',
    'awaiting_stock',
  ];
  if (active.every(p => AWAITING.includes(p.status))) return 'awaiting_stock';

  // ── 10. Pas de détail significatif ──────────────────────────────────────────
  return 'none';
}

/*
 * ─── MINI TESTS — computeOrderStatusDetail ─────────────────────────────────────
 *
 * computeOrderStatusDetail([])
 *   → 'none'
 *
 * computeOrderStatusDetail([{status:'cancelled'},{status:'cancelled'}])
 *   → 'fully_cancelled'
 *
 * computeOrderStatusDetail([{status:'collected'},{status:'collected'}])
 *   → 'fully_collected'
 *
 * computeOrderStatusDetail([{status:'available'},{status:'shipped'}])
 *   → 'partial_available'
 *
 * computeOrderStatusDetail([{status:'collected'},{status:'in_transit'}])
 *   → 'remaining_in_transit'
 *
 * computeOrderStatusDetail([{status:'collected'},{status:'available'}])
 *   → 'partial_collected'
 *
 * computeOrderStatusDetail([{status:'draft'},{status:'preparation'}])
 *   → 'awaiting_stock'
 *
 * computeOrderStatusDetail([{status:'available'},{status:'available'}])
 *   → 'full_available'
 *
 * computeOrderStatusDetail([{status:'collected'},{status:'shipped'}])
 *   → 'remaining_in_transit'  (collected + mouvement → remaining)
 * ─────────────────────────────────────────────────────────────────────────────
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 2c. getOrderStatusDetailMessage(detail)  — MESSAGES CLIENT FRANÇAIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mapping status_detail → message client en français.
 * Retourne null pour 'none' (pas de message à afficher côté UI).
 */
const STATUS_DETAIL_MESSAGES = Object.freeze({
  full_available:       'Votre commande est disponible au relais.',
  partial_available:    'Une partie de votre commande est disponible. Le reste arrive bientôt.',
  partial_collected:    'Vous avez déjà récupéré une partie de votre commande. Le reste suit son cours.',
  remaining_in_transit: 'Une partie de votre commande est déjà traitée. Le reste est encore en transit.',
  awaiting_stock:       'Une partie de votre commande est encore en attente de préparation ou de stock.',
  fully_collected:      'Votre commande a été entièrement récupérée.',
  fully_cancelled:      'Votre commande a été annulée.',
  none:                 null,
});

/**
 * Retourne le message client pour un status_detail donné.
 *
 * @param {string} detail  Valeur retournée par computeOrderStatusDetail()
 * @returns {string|null}  Message FR, ou null si aucun message utile
 */
function getOrderStatusDetailMessage(detail) {
  return STATUS_DETAIL_MESSAGES[detail] ?? null;
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
    log.warn(`[PARCELS] Stratégie "${strategyName}" introuvable, fallback → default`);
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

  // Calcul statut agrégé (FONCTION CANONIQUE — source de vérité unique)
  computeOrderStatus,

  // Second niveau UX client (détail dérivé des colis — lecture seule)
  computeOrderStatusDetail,
  getOrderStatusDetailMessage,
  STATUS_DETAIL_MESSAGES,

  // Split commande → colis
  splitOrderIntoParcels,

  // Extensibilité
  registerStrategy,
  listStrategies,
  STRATEGIES,
};
