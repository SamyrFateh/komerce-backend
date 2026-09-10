/**
 * @feature       settlement
 * @type          feature
 * @domain        settlement
 * @status        staging
 * @owner         backend-core
 * @since         2026-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {
  name: 'settlement',
  type: 'feature',
  domain: 'settlement',
  status: 'staging',
  owner: 'backend-core',
  since: '2026-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    axis: 'business',
    kind: 'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables: true,
      ownsLifecycle: true,
      activeService: true,
      multiConsumer: true,
      ownsMigrations: true,
      externalSideEffect: 'none',
      surface: 'service+db+api',
    },
    rationale: [
      'Porte la vérité de règlement économique d’un Market Operating Assignment sans inventer de formule de commission ou revenue-share.',
      'Distingue strictement attestation monétaire centrale, demande opérateur, paiement central et accusé de réception opérateur.',
      'Le transfert d’argent réel reste hors de ce premier lot : PAID atteste un paiement central déjà exécuté, aucun payout rail n’est déclenché ici.',
    ],
  },

  service: 'Tracer de bout en bout le règlement dû à un opérateur pays : READY attesté centralement, REQUESTED par le pays, PAID centralement, RECEIVED par le pays.',

  perimeter: {
    in: [
      'market_settlements : snapshot monétaire amount + currency immuable, rattaché au Market Operating Assignment et jamais supprimé',
      'market_settlement_events : journal strictement append-only READY_ATTESTED / REQUESTED / PAID / RECEIVED',
      'création READY exclusivement par acteur central admin/finance, montant explicitement attesté et devise dérivée du marché côté serveur',
      'machine stricte READY -> REQUESTED -> PAID -> RECEIVED, également protégée par trigger DB',
      'boundary lifecycle interne consommée par market-delegation pour REQUESTED et RECEIVED',
    ],
    out: [
      'promotion des capabilities finance.act + settlement.receive : migration 209 possédée par market-delegation, pas par ce slice lifecycle',
      'route et service d’orchestration délégués : propriété market-delegation ; settlement ne revendique que la boundary lifecycle',
      'calcul automatique du montant dû : aucune règle commission/margin_share/revenue_share fiable n’existe encore dans le code',
      'payout bancaire ou Mobile Money : aucun transfert externe n’est initié par cette feature dans ce lot',
      'choix de devise par le navigateur : currency vient toujours de markets.currency',
      'modification d’un READY existant : amount/currency/assignment/source sont immuables ; une correction future crée une nouvelle attestation, jamais un UPDATE silencieux',
      'suppression destructive d’un settlement ou réécriture d’un événement financier : interdites au niveau DB',
      'refund client : feature refunds, totalement distincte du settlement opérateur',
      'réconciliation cash terrain -> Komerce : feature payments/dashboard, flux économique inverse et distinct',
      'configuration générale du marché : market_config.update reste hors périmètre',
    ],
  },

  files: {
    migrations: [
      'migrations/208_market_settlement_foundation.sql',
    ],
    services: [
      'services/market-settlement-service.js',
    ],
    routes: [
      'routes/admin-market-settlement.js',
    ],
    tests: [
      'tests/unit/market-settlement-service.test.js',
      'tests/unit/admin-market-settlement-routes.test.js',
      'tests/unit/market-settlement-migration.test.js',
    ],
  },

  db: {
    tables: [
      'market_settlements: RW!',
      'market_settlement_events: RW!',
      'markets: R',
      'market_operating_assignments: R',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 3,
    totalRoutes: 3,
    note: 'Les 3 routes centrales exigent authenticate + rôle admin/finance. Les routes pays et leur capability authorization appartiennent à market-delegation.',
  },

  contract: {
    exposes: [
      'GET /api/admin/market-settlements/markets/:marketCode/settlements — admin/finance central',
      'POST /api/admin/market-settlements/markets/:marketCode/settlements/ready — attestation centrale',
      'POST /api/admin/market-settlements/settlements/:settlementId/paid — attestation centrale de paiement',
    ],
    internalApi: [
      'createReadySettlement()',
      'listForAssignment()',
      'requestSettlement()',
      'markPaid()',
      'confirmReceived()',
    ],
    consumes: [
      'market (markets.currency comme devise native du snapshot)',
      'market-delegation (Market Operating Assignment comme principal payable et boundary consommatrice du lifecycle)',
      'auth (garde des routes centrales)',
      'auth-identity (users comme identité des acteurs attestant/demandant/payant/recevant)',
      'infrastructure (DB et bootstrap)',
    ],
  },

  authority: 'backend-core — toute modification de amount/currency, de la machine de statut ou du sens de PAID exige une décision financière explicite ; finance.act ne doit jamais devenir un payout implicite.',

  invariants: [
    'READY signifie montant attesté par l’autorité centrale, jamais montant calculé implicitement par Komerce',
    'amount, currency, market_id, assignment_id et provenance de l’attestation sont immuables après création',
    'currency est dérivée de markets.currency côté serveur et vérifiée en DB ; aucun client ne choisit la devise',
    'la boundary lifecycle ne connaît aucun rôle pays : l’autorisation finance.act / settlement.receive reste dans market-delegation',
    'seul le central peut faire REQUESTED -> PAID et une payment_reference est obligatoire',
    'market_settlements ne peut jamais être supprimé ; une correction crée une nouvelle attestation',
    'market_settlement_events est append-only : UPDATE et DELETE bloqués par trigger DB',
    'la migration d’activation des capabilities ne crée ni ne modifie aucune vérité market_settlements',
  ],
};
