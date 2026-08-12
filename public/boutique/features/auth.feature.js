/**
 * @feature       auth
 * @type          feature
 * @domain        auth
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "auth". Genere pour rattacher les modules JS existants (deja annotes
 * @domain auth dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'auth',
  type:     'feature',
  domain:   'auth',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // Lot O4 (cross-repo feature coverage) : identite metier verifiee par le
  // service rendu (login/OTP/identite), pas par le nom. backend:auth designe
  // les gardes transverses (middlewares JWT/session/roles) — feature DIFFERENTE.
  // backend:auth-identity designe l'authentification/gestion d'identite active
  // (OTP, login/register, magic-link, guest-checkout, profil) — c'est la meme
  // identite metier que ce manifeste boutique. Voir docs/BUSINESS_FEATURE_GRAPH.md
  // §O4 pour la preuve complete.
  canonicalFeature: 'auth-identity',
  sliceKind: 'frontend-slice',

  service: "Authentification et identite utilisateur cote boutique (login telephone, gestion identite).",

  perimeter: {
    in:  ['fichiers js/* annotes @domain auth'],
    out: ['logique backend equivalente (repo komerce-backend, feature auth-identity)'],
  },

  files: {
    js: [
      '../js/b-identity.js',
      '../js/b-phone.js',
    ],
    css: [
      // P3b (2026-07-27) : ownership CSS jamais rapatrié lors du split P3 —
      // deja declare cote features/auth-identity.feature.js (racine).
      '../css/identity.css',
    ],
    tests: [
      '../tests/unit/b-identity.test.js',
      '../tests/unit/b-phone.test.js',
      // testent b-identity.js et b-phone.js directement (require réel) ;
      // mockent b-store.js/b-utils.js/b-cart-core.js en tant que
      // collaborateurs (normal), ne testent donc pas ces fichiers en direct.
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : exports JS
    // internes consommés côté client, pas des routes HTTP.
    internalApi: [
      'identity / requireIdentity / getCurrentIdentity / restoreIdentity / bindChangeIdentity (b-identity.js)',
      'phone (b-phone.js)',
    ],
    consumes: [
      'boutique — b-identity.js importe b-store.js, b-utils.js, b-cart-core.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain auth doit etre liste dans files.js de ce manifeste',
    'la modale identité confine le focus, rend le fond inerte, ferme avec Échap et restitue le focus au déclencheur',
    'toute erreur de validation identité est annoncée et reliée au champ invalide via aria-invalid et aria-describedby',
    'l indicatif par défaut de l identité client est +269 ; un autre défaut exige une règle de contexte explicite',
    'la création de profil demande prénom, nom et WhatsApp ; une simple recherche d historique peut rester limitée au WhatsApp',
    'le CTA identité distingue visuellement et sémantiquement l état incomplet ; le handle de bottom sheet reste réservé au mobile',
    'le CTA identité disponible utilise l action de confirmation ; incomplet reste secondaire et une erreur reste exclusivement rouge danger',
  ],

};
