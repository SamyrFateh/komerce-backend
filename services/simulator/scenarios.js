/**
 * @komerce-arch
 * @role          scenarios
 * @domain        operations
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @used-by       services/simulator/engine.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * Simulator Scenarios v2 — définitions des parcours métier enrichis
 *
 * Chaque scénario = séquence d'actions à exécuter dans l'ordre.
 * Le moteur avance d'un cran par tick.
 *
 * ── 14 scénarios (6 originaux + 8 nouveaux) ──
 * ── 12 chaos actions (3 originaux + 9 nouveaux) ──
 */
'use strict';

const SCENARIOS = {
  // ═══════════════════════════════════════════════════════════
  // SCÉNARIOS ORIGINAUX (6)
  // ═══════════════════════════════════════════════════════════

  nominal: {
    name: 'nominal',
    icon: '✅',
    category: 'happy',
    description: 'Flux complet — pending → collected',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'wait', description: 'Attente traitement', ticks: 1 },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'collect', description: 'Remis au client', targetStatus: 'collected' },
    ]
  },
  abandoned: {
    name: 'abandoned',
    icon: '⏳',
    category: 'fail',
    description: 'Commande jamais payée — reste pending',
    steps: [
      { action: 'wait', description: 'Attente paiement...', ticks: 5 },
      { action: 'log_only', description: '⏳ Commande restée pending (abandonnée)' },
    ]
  },
  cancelled: {
    name: 'cancelled',
    icon: '❌',
    category: 'fail',
    description: 'Annulation avant paiement',
    steps: [
      { action: 'wait', description: 'Attente...', ticks: 1 },
      { action: 'cancel', description: 'Annuler commande', targetStatus: 'cancelled' },
    ]
  },
  late_cash: {
    name: 'late_cash',
    icon: '💰',
    category: 'delay',
    description: 'Cash confirmé tardivement',
    steps: [
      { action: 'wait', description: 'Client n\'a pas encore payé...', ticks: 3 },
      { action: 'confirm_payment', description: 'Paiement cash tardif', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'collect', description: 'Remis au client', targetStatus: 'collected' },
    ]
  },
  stuck: {
    name: 'stuck',
    icon: '🔒',
    category: 'fail',
    description: 'Commande bloquée en préparation',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'wait', description: 'Bloquée en préparation...', ticks: 8 },
      { action: 'log_only', description: '🔒 Commande restée bloquée en preparation' },
    ]
  },
  uncollected: {
    name: 'uncollected',
    icon: '📦',
    category: 'fail',
    description: 'Disponible mais jamais collectée',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'wait', description: 'Client ne vient pas...', ticks: 6 },
      { action: 'log_only', description: '📦 Colis jamais collecté — alerte relais' },
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // NOUVEAUX SCÉNARIOS (8) — réalistes Komerce
  // ═══════════════════════════════════════════════════════════

  express: {
    name: 'express',
    icon: '⚡',
    category: 'happy',
    description: 'Commande express — tout en accéléré',
    steps: [
      { action: 'confirm_payment', description: 'Paiement instantané', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Préparation express', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédition immédiate', targetStatus: 'shipped' },
      { action: 'transit', description: 'Transit rapide', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'collect', description: 'Collecte immédiate', targetStatus: 'collected' },
    ]
  },

  customs_delay: {
    name: 'customs_delay',
    icon: '🛃',
    category: 'delay',
    description: 'Bloqué en douane Comores — retard transit',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier (France → Comores)', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit international', targetStatus: 'in_transit' },
      { action: 'wait', description: '🛃 Bloqué en douane Moroni...', ticks: 4 },
      { action: 'log_only', description: '🛃 Dédouanement en cours — taxe estimée' },
      { action: 'wait', description: '🛃 Attente clearance douane...', ticks: 2 },
      { action: 'arrive', description: 'Arrivée relais après douane', targetStatus: 'available' },
      { action: 'collect', description: 'Remis au client', targetStatus: 'collected' },
    ]
  },

  damaged: {
    name: 'damaged',
    icon: '💔',
    category: 'fail',
    description: 'Colis endommagé en transit — annulation',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'wait', description: '💔 Colis endommagé signalé...', ticks: 1 },
      { action: 'log_only', description: '💔 INCIDENT: Colis endommagé en transit — photos prises' },
      { action: 'cancel', description: 'Annulation + remboursement prévu', targetStatus: 'cancelled' },
    ]
  },

  partial_delivery: {
    name: 'partial_delivery',
    icon: '📦½',
    category: 'delay',
    description: 'Multi-articles — un colis arrive, l\'autre en retard',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis principal', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier colis 1/2', targetStatus: 'shipped' },
      { action: 'transit', description: 'Transit colis 1', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Colis 1 arrivé au relais', targetStatus: 'available' },
      { action: 'wait', description: '⏳ Attente colis 2...', ticks: 3 },
      { action: 'log_only', description: '📦½ Livraison partielle — client prévenu du retard colis 2' },
      { action: 'collect', description: 'Client récupère colis 1', targetStatus: 'collected' },
    ]
  },

  return_refund: {
    name: 'return_refund',
    icon: '🔄',
    category: 'fail',
    description: 'Livré puis retourné — remboursement wallet',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'collect', description: 'Remis au client', targetStatus: 'collected' },
      { action: 'wait', description: '🔄 Client demande retour...', ticks: 2 },
      { action: 'refund', description: 'Remboursement wallet crédité', targetStatus: 'refunded' },
    ]
  },

  wrong_relais: {
    name: 'wrong_relais',
    icon: '📍',
    category: 'delay',
    description: 'Livré au mauvais relais — redirection',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivé au mauvais relais ❌', targetStatus: 'available' },
      { action: 'log_only', description: '📍 ERREUR: Mauvais relais — redirection nécessaire' },
      { action: 'wait', description: '📍 Redirection en cours...', ticks: 2 },
      { action: 'log_only', description: '📍 Colis redirigé vers le bon relais' },
      { action: 'wait', description: 'Attente au bon relais...', ticks: 1 },
      { action: 'collect', description: 'Client collecte au bon relais', targetStatus: 'collected' },
    ]
  },

  payment_dispute: {
    name: 'payment_dispute',
    icon: '⚖️',
    category: 'fail',
    description: 'Litige paiement — client conteste après livraison',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'create_parcel', description: 'Créer colis', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'collect', description: 'Remis au client', targetStatus: 'collected' },
      { action: 'wait', description: '⚖️ Client conteste le paiement...', ticks: 3 },
      { action: 'log_only', description: '⚖️ LITIGE: Paiement contesté — enquête ouverte' },
      { action: 'wait', description: '⚖️ Médiation en cours...', ticks: 2 },
      { action: 'log_only', description: '⚖️ RÉSOLU: Litige tranché — remboursement partiel 30%' },
    ]
  },

  backorder: {
    name: 'backorder',
    icon: '🕐',
    category: 'delay',
    description: 'Produit en rupture — réappro puis livraison',
    steps: [
      { action: 'confirm_payment', description: 'Confirmer paiement', targetStatus: 'confirmed' },
      { action: 'log_only', description: '🕐 Produit en rupture de stock — en attente réappro' },
      { action: 'wait', description: '🕐 Fournisseur contacté...', ticks: 3 },
      { action: 'log_only', description: '🕐 Stock reçu — préparation relancée' },
      { action: 'create_parcel', description: 'Créer colis (stock reçu)', targetStatus: 'preparation' },
      { action: 'ship', description: 'Expédier', targetStatus: 'shipped' },
      { action: 'transit', description: 'En transit', targetStatus: 'in_transit' },
      { action: 'arrive', description: 'Arrivée relais', targetStatus: 'available' },
      { action: 'collect', description: 'Remis au client', targetStatus: 'collected' },
    ]
  },
};

// ═══════════════════════════════════════════════════════════
// CHAOS ACTIONS ENRICHIES (12) — impactent réellement le flux
// ═══════════════════════════════════════════════════════════

const CHAOS_ACTIONS = [
  // ── Originaux (log only) ──
  { id: 'network_delay', description: 'Délai réseau — tick sauté', impact: 'skip', severity: 'low' },
  { id: 'operator_absent', description: 'Opérateur absent — action reportée', impact: 'skip', severity: 'low' },
  { id: 'slow_system', description: 'Système lent — transition retardée', impact: 'skip', severity: 'low' },

  // ── Nouveaux (impactants) ──
  { id: 'duplicate_scan', description: 'Double scan — même colis scanné 2x',
    impact: 'duplicate_scan', severity: 'medium' },

  { id: 'relais_offline', description: 'Relais offline — colis en attente livraison',
    impact: 'add_wait', waitTicks: 2, severity: 'medium' },

  { id: 'power_outage', description: 'Coupure électrique relais — scan impossible',
    impact: 'add_wait', waitTicks: 1, severity: 'medium' },

  { id: 'customs_random_check', description: '🛃 Contrôle douanier aléatoire — retard 24h',
    impact: 'add_wait', waitTicks: 3, severity: 'high' },

  { id: 'payment_glitch', description: 'Bug paiement — statut payment_status désynchronisé',
    impact: 'desync_payment', severity: 'high' },

  { id: 'sms_failure', description: 'Notification SMS échouée — client pas prévenu',
    impact: 'log_incident', severity: 'low' },

  { id: 'wrong_weight', description: 'Poids colis incorrect — recalcul tarif requis',
    impact: 'log_incident', severity: 'medium' },

  { id: 'label_error', description: 'Erreur étiquette — impression ratée, re-label',
    impact: 'add_wait', waitTicks: 1, severity: 'low' },

  { id: 'concurrent_update', description: '⚠️ Mise à jour concurrente — conflit status',
    impact: 'log_incident', severity: 'high' },
];


// ── Scenario category labels (for UI grouping) ──
const CATEGORIES = {
  happy: { label: 'Flux normal', color: '#22c55e' },
  delay: { label: 'Retards', color: '#f59e0b' },
  fail: { label: 'Échecs', color: '#ef4444' },
};


function assign(order, config) {
  const enabledNames = config.scenarios || ['nominal'];
  const enabled = enabledNames.map(n => SCENARIOS[n]).filter(Boolean);
  if (!enabled.length) return SCENARIOS.nominal;

  // Smart assignment based on order properties
  if (order.status === 'pending' && order.payment_mode === 'cash_relais') {
    const lateCash = enabled.find(s => s.name === 'late_cash');
    if (lateCash && Math.random() < 0.3) return lateCash;
  }

  // Weighted random: happy path more likely
  const weights = enabled.map(s => {
    if (s.category === 'happy') return 3;
    if (s.category === 'delay') return 2;
    return 1; // fail
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < enabled.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return enabled[i];
  }
  return enabled[0];
}

function getNextAction(tracked) {
  const scenario = SCENARIOS[tracked.scenario];
  if (!scenario) return null;

  const steps = scenario.steps;
  if (tracked.currentStep >= steps.length) return null;

  const step = steps[tracked.currentStep];

  // Handle wait steps
  if (step.action === 'wait') {
    if (!tracked._waitCounter) tracked._waitCounter = 0;
    tracked._waitCounter++;
    if (tracked._waitCounter < (step.ticks || 1)) {
      return { action: 'wait', description: step.description + ' (' + tracked._waitCounter + '/' + step.ticks + ')' };
    }
    tracked._waitCounter = 0;
    tracked.currentStep++;
    return getNextAction(tracked);
  }

  return step;
}

function getChaosAction(tracked, chaosLevel) {
  if (tracked.completed) return null;

  // Higher chaos = more severe actions possible
  let pool;
  if (chaosLevel >= 0.7) {
    pool = CHAOS_ACTIONS; // all
  } else if (chaosLevel >= 0.4) {
    pool = CHAOS_ACTIONS.filter(a => a.severity !== 'high');
  } else {
    pool = CHAOS_ACTIONS.filter(a => a.severity === 'low');
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { SCENARIOS, CATEGORIES, assign, getNextAction, getChaosAction };
