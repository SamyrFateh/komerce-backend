/**
 * @komerce-arch
 * @role          decision-signals-capability-manifest
 * @domain        decision-signals
 * @layer         manifest
 * @criticality   medium
 * @doctrine      docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md
 * @registry      docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md
 */
'use strict';

module.exports = {
  name:       'decision-signals',
  governedBy: 'docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md',
  registry:   'docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md',
  status:     'staging',
  owner:      'backend-core',
  since:      '2026-02',

  capability: 'Detecter et qualifier des signaux operationnels et economiques '
            + 'a partir des donnees canoniques, puis porter leur cycle de vie '
            + 'global ou Market ID sans muter la verite metier source.',

  perimeter: {
    in: [
      'generation de signaux depuis des requetes radar cross-feature (cash, colis, incidents)',
      'cycle de vie du signal : acknowledge / resolve / snooze',
      'consultation admin des signaux (routes/signals.js)',
      'Action Center Canonical global : uniquement les signaux market_id NULL',
      'Action Center Canonical pays : projection et lifecycle bornes a un Market ID resolu serveur',
      'identite d’un fait actif : signal_type + market_id + entity_type + entity_id',
    ],
    out: [
      'aucune decision metier engageante : la capability detecte, elle ne tranche aucun statut de commande, colis ou wallet',
      'aucune UI ne devient propriétaire de la donnée source : Action Center reste une projection dashboard de cette capability',
      'aucun market_id brut fourni par le navigateur ne devient une autorite',
      'la regeneration des generateurs historiques reste globale tant qu’un generateur market-scoped owner n’est pas explicitement livre',
      'classement produit boutique (feature recommendations, qui reste seule proprietaire du ranking)',
    ],
  },

  files: {
    middleware: [
      'middleware/require-decision-signal-global-authority.js',
    ],
    services: [
      'services/radar-queries.js',
      'services/radar-alerts/cash-reconciliation-signals.js',
      'services/radar-alerts/commerce-signals.js',
      'services/radar-alerts/logistics-signals.js',
      'services/radar-alerts/payment-signals.js',
      'services/radar-alerts/treasury-signals.js',
      'services/signal-service.js',
      'services/signal-admin-service.js',
      'services/action-center-workspace.js',
    ],
    routes: [
      'routes/signals.js',
      'routes/admin-action-center.js',
    ],
    migrations: [
      'migrations/153_action_center_signal_authority.sql',
      'migrations/219_decision_signals_market_scope.sql',
    ],
    tests: [
      'tests/unit/radar-queries.test.js',
      'tests/unit/radar-alerts-cash-reconciliation-signals.test.js',
      'tests/unit/radar-alerts-logistics-signals.test.js',
      'tests/unit/radar-alerts-payment-signals.test.js',
      'tests/unit/radar-alerts-treasury-commerce-signals.test.js',
      'tests/unit/signals.test.js',
      'tests/unit/signal-service.test.js',
      'tests/unit/signal-admin-service.test.js',
      'tests/unit/action-center-workspace.test.js',
      'tests/unit/admin-action-center-route.test.js',
      'tests/unit/require-decision-signal-global-authority.test.js',
      'tests/unit/signals-error-propagation.test.js',
      'tests/unit/action-center-migration-contract.test.js',
      'tests/unit/decision-signals-market-scope-contract.test.js',
    ],
  },

  db: {
    tables: [
      'signals: RW',
    ],
  },

  consumedBy: [
    'dashboard (routes/admin-radar.js, projection en lecture des signaux)',
    'consultation admin directe (routes/signals.js)',
    'dashboard Canonical (Action Center global et Action Center pays)',
  ],

  invariants: [
    'un signal est un constat derive, jamais une mutation d\'une table possedee par une autre feature',
    'acknowledge/resolve/snooze changent uniquement l\'etat du signal, jamais l\'etat de la donnee source',
    'open, acknowledged et snoozed forment un seul lifecycle actif ; disparition de la condition => auto-resolution dans le meme scope',
    'market_id NULL signifie explicitement fait global ; market_id non NULL signifie fait borne a ce Market ID canonique',
    'le Centre d’actions global ne lit ni ne mute jamais les signaux pays',
    'le Centre d’actions pays ne lit ni ne mute jamais un autre Market ID et le navigateur ne fournit jamais le market_id autoritatif',
  ],

  contract: {
    exposes: [
      'GET /api/admin/action-center',
      'POST /api/admin/action-center/generate',
      'POST /api/admin/action-center/signals/:signalRef/acknowledge',
      'POST /api/admin/action-center/signals/:signalRef/snooze',
      'POST /api/admin/action-center/signals/:signalRef/resolve',
      'GET /api/admin/action-center/market/:marketCode',
      'POST /api/admin/action-center/market/:marketCode/signals/:signalRef/acknowledge',
      'POST /api/admin/action-center/market/:marketCode/signals/:signalRef/snooze',
      'POST /api/admin/action-center/market/:marketCode/signals/:signalRef/resolve',
    ],
    consumes: [
      "auth (garde de route et contexte d’identité)",
      "infrastructure (acces DB et logger techniques)",
      "logistics (lecture ou orchestration logistique)",
      "business-rules (lecture du referentiel de regles metier)",
      "market-delegation (resolution serveur du Market ID, capability dashboard.market.read / decision_signal.manage et audit des mutations pays)",
    ],
  },
};
