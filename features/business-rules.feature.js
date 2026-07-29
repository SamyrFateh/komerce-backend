/**
 * @komerce-arch
 * @role          business-rules-feature-manifest
 * @domain        business-rules
 * @layer         manifest
 * @criticality   high
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 *
 * @feature       business-rules
 * @nature        feature
 * @axis          business
 * @status        production
 * @owner         backend-core
 * @since         2026-07 (scindée d'infrastructure, arbitrage B du 2026-07-29)
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'business-rules',
  nature:   'feature',   // feature | capability | governance-unit
  type:     'transversal',
  domain:   'business-rules',
  status:   'production',
  owner:    'backend-core',
  since:    '2026-07',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Classification d'ontologie (arbitrage 2026-07-29) ────────────────────
  classification: {
    axis:     'business',   // business | support
    kind:     'business-transversal',
    rationale: [
      'Scindée d\'infrastructure (arbitrage B, 2026-07-29). Le recalcul des écritures ' +
        'runtime montre que business_rules et business_rules_history sont écrites par un ' +
        'seul fichier, utils/rules.js, jusqu\'ici classé infrastructure — soit une feature ' +
        'support propriétaire de vérité métier, ce que l\'ontologie interdit.',
      'Non rattachable à economic-engine : le référentiel porte des règles de quantité ' +
        '(MAX_QUANTITY_PER_ITEM), de délai d\'annulation, de seuil colis et de cadence de ' +
        'relance, consommées par orders, catalog, logistics, payments, dashboard et ' +
        'decision-signals. La preuve exigée par l\'arbitrage — « toutes les règles sont ' +
        'exclusivement économiques » — n\'est pas apportée : elle est réfutée.',
      'business-transversal et non business-feature : le référentiel ne porte aucun cycle ' +
        'de vie métier propre, il est consommé symétriquement par les features qui ' +
        'décident, exactement comme notifications.',
    ],
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Detenir le referentiel des regles metier parametrables, versionner chaque '
         + 'changement, et servir a toute feature la valeur en vigueur avec un repli '
         + 'garanti sur la valeur codee en dur.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'lecture d\'une regle en vigueur avec valeur de repli (getRule)',
      'mutation d\'une regle et historisation du changement (business_rules_history)',
      'restitution admin du referentiel et de son historique',
      'cache memoire TTL 60s et son invalidation',
    ],
    out: [
      'la decision prise a partir de la regle : elle appartient a la feature qui lit '
        + '(orders decide d\'annuler, catalog decide de publier) — business-rules ne '
        + 'tranche jamais a leur place',
      'les parametres economiques (marges, taux, composants de cout) : feature '
        + 'economic-engine, referentiel distinct',
      'la configuration technique d\'execution (variables d\'environnement, feature '
        + 'flags de deploiement) : feature infrastructure',
    ],
  },

  files: {
    utils: [
      'utils/rules.js',
    ],
    routes: [
      'routes/admin-rules.js',
    ],
    tests: [
      'tests/unit/rules-engine.test.js',
      'tests/unit/admin-rules.test.js',
    ],
  },

  // ── Tables DB ────────────────────────────────────────────────────────────
  // Rôles conformes au modèle arrêté le 2026-07-29 — voir
  // governance/data-ownership.json, source de vérité des rôles.
  db: {
    owns:  ['business_rules', 'business_rules_history'],
    reads: ['users'],
    tables: [
      'business_rules: RW',
      'business_rules_history: RW',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_AUTHED',
    note: 'routes/admin-rules.js entierement protegee (role admin). La lecture par '
        + 'getRule() est interne, jamais exposee directement.',
  },

  contract: {
    exposes: [
      'GET /api/admin/rules',
      'GET /api/admin/rules/:key',
      'PATCH /api/admin/rules/:key',

      // Rapatriés (D2, 2026-07-29) — routes réelles de routes/admin-rules.js,
      // jamais déclarées jusqu'ici (ni ici ni dans dashboard).
      'POST /api/admin/rules/:key/reset',
      'GET /api/admin/rules/audit',
    ],
    internalApi: [
      { fn: 'getRuleNumber', file: 'utils/rules.js' },
      { fn: 'getRule',     file: 'utils/rules.js' },
      { fn: 'getAllRules', file: 'utils/rules.js' },
      { fn: 'setRule',     file: 'utils/rules.js' },
    ],
    consumes: [
      'auth (garde de route admin)',
      'infrastructure (journalisation, acces base)',
    ],
  },

  authority: 'backend-core — toute regle nouvelle doit porter une valeur de repli codee '
           + 'en dur egale au comportement actuel : l\'ajout d\'une regle ne change jamais '
           + 'le comportement tant que la base est vide.',

  invariants: [
    'une regle absente ou une base injoignable retourne la valeur de repli, jamais une erreur',
    'toute mutation de regle ecrit une ligne d\'historique dans la meme transaction',
    'aucune feature ne lit business_rules directement : le seul chemin est getRule()',
  ],

};
