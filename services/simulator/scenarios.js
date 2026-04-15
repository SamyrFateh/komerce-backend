/**
 * Simulator Scenarios — définitions des parcours métier
 *
 * Chaque scénario = séquence d'actions à exécuter dans l'ordre.
 * Le moteur avance d'un cran par tick.
 */
'use strict';

const SCENARIOS = {
  nominal: {
    name: 'nominal',
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
    description: 'Commande jamais payée — reste pending',
    steps: [
      { action: 'wait', description: 'Attente paiement...', ticks: 5 },
      { action: 'log_only', description: '⏳ Commande restée pending (abandonnée)' },
    ]
  },
  cancelled: {
    name: 'cancelled',
    description: 'Annulation avant paiement',
    steps: [
      { action: 'wait', description: 'Attente...', ticks: 1 },
      { action: 'cancel', description: 'Annuler commande', targetStatus: 'cancelled' },
    ]
  },
  late_cash: {
    name: 'late_cash',
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
};

const CHAOS_ACTIONS = [
  { description: 'Délai réseau — tick sauté' },
  { description: 'Opérateur absent — action reportée' },
  { description: 'Système lent — transition retardée' },
];

function assign(order, config) {
  const enabledNames = config.scenarios || ['nominal'];
  const enabled = enabledNames.map(n => SCENARIOS[n]).filter(Boolean);
  if (!enabled.length) return SCENARIOS.nominal;

  // Smart assignment based on order properties
  if (order.status === 'pending' && order.payment_mode === 'cash_relais') {
    // Cash orders get late_cash scenario if enabled
    const lateCash = enabled.find(s => s.name === 'late_cash');
    if (lateCash && Math.random() < 0.3) return lateCash;
  }

  // Random selection from enabled
  return enabled[Math.floor(Math.random() * enabled.length)];
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
    // Return next action after wait
    return getNextAction(tracked);
  }

  return step;
}

function getChaosAction(tracked) {
  if (tracked.completed) return null;
  return CHAOS_ACTIONS[Math.floor(Math.random() * CHAOS_ACTIONS.length)];
}

module.exports = { SCENARIOS, assign, getNextAction, getChaosAction };
