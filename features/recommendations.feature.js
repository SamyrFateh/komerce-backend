/**
 * @feature       recommendations
 * @type          feature
 * @domain        recommendations
 * @status        staging
 * @owner         backend-core
 * @since         2026-02
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'recommendations',
  type:     'feature',   // feature | transversal
  domain:   'recommendations',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-02',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Classer et suggerer des produits boutique selon un moteur de ranking dedie.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'moteur de classement boutique',
      'endpoint de suggestions',
    ],
    out: [
      'donnees produit source (feature catalog)',
      'prix affiche (feature economic-engine)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/boutique-ranking-engine.js',
    
      'services/radar-queries.js',
      'services/signal-service.js',],
    routes: [
      'routes/boutique-suggestions.js',
    
      'routes/signals.js',],
    tests: [
      'tests/unit/boutique-ranking-engine.test.js',
      'tests/unit/radar-queries.test.js',
      'tests/unit/signals.test.js',
      'tests/unit/signal-service.test.js',
      'tests/unit/boutique-suggestions.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md',
  ],

  // ── Tables DB (inféré, audit 2026-07-06, §axe2) ─────────────────────────
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  db: {
    tables: [
      'cash_collections: R',
      'cash_deposits: R',
      'finance_config: R',
      'incidents: R',
      'order_items: R',
      'orders: R',
      'parcels: R',
      'products: R',
      'signals: RW',
      'users: R',
      'wallets: R',
    ],
  },

  contract: {
    exposes: [
      'GET /api/boutique/suggestions',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/signals',
      'DELETE /api/admin/signals/:id',
      'POST /api/admin/signals/:id/acknowledge',
      'POST /api/admin/signals/:id/resolve',
      'POST /api/admin/signals/:id/snooze',
      'POST /api/admin/signals/generate',
      'GET /api/admin/signals/stats',
    ],
    consumes: ['catalog (lecture produit)',
      'auth',
      'logistics',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  // ── Sécurité (constat factuel, audit 2026-07-06, §axe3) ─────────────────
  // AUCUN middleware d'authentification détecté sur les 8 routes de cette
  // feature. Surface probablement moins sensible que customs/documents
  // (recommandations produit), mais à faire confirmer explicitement plutôt
  // que de le supposer.
  security: {
    status: 'CONFIRMED_MIXED_BY_DESIGN',
    authedRoutesDetected: 7,
    totalRoutes: 8,
    note: "Corrigé le 2026-07-06 (suite d'audit) : le constat initial (0/8) "
        + "était un faux négatif pour signals.js (`router.use(authenticate, "
        + "requireAdmin)` non reconnu par le premier détecteur). Reconfirmé "
        + "via scripts/gen-security-360.js : 7/8 routes PROTECTED "
        + "(routes/signals.js, admin). La 8e, GET /api/boutique/suggestions, "
        + "est classée PUBLIC et volontairement sans garde — ranking produit "
        + "pour visiteurs anonymes non connectés (routes/boutique-suggestions.js).",
  },

  authority: 'backend-core — tout changement de formule de classement doit etre valide par le proprietaire de boutique-ranking-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le ranking ne modifie jamais les donnees produit, lecture seule sur catalog',
  ],

};
