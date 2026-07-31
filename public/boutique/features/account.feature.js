/**
 * @feature       account
 * @type          feature
 * @domain        account
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Lot 4 (2026-07-31) — Manifeste niveau 0 pour "Mon Komerce" : l'espace
 * personnel du client (compte, droits, avantages), distinct de "Suivi"
 * (feature orders-client, achats). Ce manifeste ne possède aucune vérité
 * métier propre : il assemble et présente des données déjà possédées par
 * wallet (solde/mouvements) et auth-identity (profil, WhatsApp vérifié).
 *
 * canonicalFeature: null — il n'existe pas de "compte" backend unique à
 * pointer ; Mon Komerce est une composition frontend de deux features
 * backend distinctes (wallet, auth-identity), au même titre que le
 * manifeste transversal "boutique". Documenté explicitement plutôt que
 * tranché silencieusement (cf. governance/business-graph-ontology-gaps.json).
 */
'use strict';

module.exports = {

  name:     'account',
  type:     'feature',
  domain:   'account',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  canonicalFeature: null,
  sliceKind: 'frontend-slice',

  service: "Espace personnel du client — Mon Komerce : vue d'ensemble, wallet, " +
           "sécurité du retrait (informatif), informations et préférences.",

  perimeter: {
    in: [
      "shell et sous-navigation de l'espace Mon Komerce",
      "vue d'ensemble (identité masquée, solde, expiration, statut sécurité)",
      "rubrique Mes informations (lecture + édition des champs profil déjà " +
        "légitimes : nom, currency_pref — jamais le WhatsApp vérifié)",
      "rubrique Mes préférences (uniquement les préférences réellement " +
        "persistées : devise d'affichage)",
      "rubrique Retrait & sécurité (informative uniquement, aucune mutation)",
    ],
    out: [
      'solde et mouvements wallet eux-mêmes (feature wallet, boutique et backend)',
      'authentification, OTP, session (feature auth-identity)',
      "personne de secours, OTP tiers, retrait sans code — hors périmètre Lot 4",
      'suivi de commandes (feature orders-client, reste un espace autonome)',
    ],
  },

  files: {
    js: [
      '../js/b-komerce.js',
    ],
    css: [
      '../css/komerce.css',
    ],
    tests: [
      '../tests/unit/b-komerce.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    internalApi: [
      'b-komerce.js / renderKomerceView(subtab)',
    ],
    consumes: [
      'auth — b-komerce.js importe b-identity.js (getCurrentIdentity, requireIdentity)',
      'wallet — b-komerce.js monte b-wallet.js (renderWalletView) dans son propre panneau',
      'boutique — b-komerce.js importe b-utils.js, b-bus.js',
    ],
  },

  authority: 'boutique — tout changement de périmètre de ce domaine doit être reflété ici.',

  invariants: [
    "aucune rubrique de Mon Komerce n'affiche de bouton ou d'action non fonctionnelle",
    "Retrait & sécurité ne déclenche jamais de mutation (personne de secours, OTP tiers, retrait sans code)",
    "le WhatsApp vérifié n'est jamais affiché comme champ texte éditable",
  ],

};
