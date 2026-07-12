/**
 * @feature       wallet-loyalty
 * @type          feature
 * @domain        wallet-loyalty
 * @status        deprecated
 * @owner         backend-core
 * @since         2025-10
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

// ── DÉPRÉCIÉ — Lot O1.2 (Business Feature Ontology Refactor), 2026-07-12 ───
// Ce manifest est conservé comme trace historique, vide de tout fichier,
// pour ne jamais redevenir une source de vérité concurrente. Il ne possède
// plus aucun fichier, aucune table, aucune route : tout a été scindé et migré
// vers deux manifests distincts, chacun couvrant exactement son périmètre
// réel (vérifié empiriquement par lecture directe du code — grep .query(),
// headers @komerce-arch, schema_railway.sql — gates à l'appui, voir
// docs/chantier/LOT_O1_2_LIVRABLE.md) :
//
//   - features/wallet.feature.js   → solde client, credit/debit, store credits (module mort)
//   - features/loyalty.feature.js  → statut de fidélité, paliers, récompenses
//
// Raison de la scission : wallet et loyalty ne partageaient ni tables (hors
// `users`, sur des colonnes disjointes), ni cycle de vie, ni invariant commun.
// Ils avaient été assemblés uniquement parce que la fidélité est financée par
// le même client que le solde wallet — un rapport d'usage, pas un rapport de
// service.
//
// Ne pas ajouter de fichier ici. Ne pas réutiliser ce nom pour une nouvelle
// feature sans repasser par une décision explicite de gouvernance.

module.exports = {
  name:     'wallet-loyalty',
  type:     'feature',
  domain:   'wallet-loyalty',
  status:   'deprecated',
  owner:    'backend-core',
  since:    '2025-10',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'DÉPRÉCIÉ — scindé au Lot O1.2 (2026-07-12) en features/wallet.feature.js et features/loyalty.feature.js. Ne rend plus aucun service propre.',

  perimeter: {
    in:  [],
    out: [
      'tout — voir features/wallet.feature.js et features/loyalty.feature.js',
    ],
  },

  files: {},

  // Preuve de non-régression (ratchet tests|verification|contracts,
  // feature-schema-check.js) : ce manifest ne porte plus aucun fichier de
  // test propre — toute la couverture a été redistribuée, sans perte, entre
  // features/wallet.feature.js (files.tests) et features/loyalty.feature.js
  // (files.tests). Ce champ documente ce transfert plutôt que de fabriquer
  // une preuve de test locale qui n'existerait plus.
  verification: 'Couverture intégralement redistribuée — voir files.tests dans features/wallet.feature.js et features/loyalty.feature.js.',

  db: { tables: [] },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'backend-core — manifest déprécié, aucune autorité propre ; voir wallet.feature.js et loyalty.feature.js',

  invariants: [],

  classification: {
    kind:     'deprecated',
    decision: 'deprecated',
    signals: {
      ownsTables:          false,
      ownsLifecycle:       false,
      activeService:       false,
      multiConsumer:       false,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'api+boutique',
    },
    rationale: [
      'scindé au Lot O1.2 (2026-07-12) en wallet + loyalty — deux services sans table, cycle de vie ni invariant partagés (hors users, colonnes disjointes)',
      'conservé en deprecated plutôt que supprimé pour laisser une trace explicite et empêcher la réutilisation accidentelle du nom sans décision de gouvernance',
    ],
  },

};
