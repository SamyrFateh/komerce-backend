/**
 * @feature       account
 * @type          feature
 * @domain        account
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Lot 4B (2026-07-31) — Manifeste niveau 0 de Mon Komerce.
 *
 * Mon Komerce est une page personnelle protégée unique, distincte de Suivi.
 * Elle compose des vérités déjà détenues par wallet et auth-identity.
 *
 * Cette surface appartient canoniquement à auth-identity : elle porte le
 * profil et l'accès protégé au compte. Le wallet reste une feature consommée,
 * dont Mon Komerce compose seulement la présentation.
 */
'use strict';

module.exports = {

  name:     'account',
  type:     'feature',
  domain:   'account',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  canonicalFeature: 'auth-identity',
  sliceKind: 'frontend-slice',

  service: "Espace personnel protégé Mon Komerce : page unique réunissant wallet, documents privés téléchargeables, profil et sécurité de retrait.",

  perimeter: {
    in: [
      "point d'entrée protégé de Mon Komerce avec restauration de la vue après authentification",
      "page unique sans vue d'ensemble ni sous-navigation interne",
      "bloc wallet utilisant la vérité canonique de la feature wallet",
      "bloc Mes documents sous le wallet : factures, remboursements, wallet et retraits téléchargés sous session",
      "bloc profil limité aux champs réellement lisibles ou modifiables",
      "WhatsApp du compte affiché en lecture seule sans statut de vérification inventé",
      "devise d'affichage persistée avec le profil",
      "carte Retrait & sécurité — code de retrait (informatif) et autorisation nominative de retrait exceptionnel (interactive, états NONE/ACTIVE, Lot 5)",
      "focalisation optionnelle du bloc wallet depuis le checkout",
    ],
    out: [
      "solde et mouvements wallet eux-mêmes (feature wallet)",
      "authentification, OTP et session (feature auth-identity)",
      "personne de secours et OTP tiers (lots ultérieurs)",
      "suivi et historique de commandes (feature orders-client)",
      "envoi de documents ou de liens documentaires par WhatsApp",
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
      'b-komerce.js / openMonKomerce({ focus })',
      'b-komerce.js / bloc Retrait & sécurité — GET/PUT/DELETE /api/auth/me/pickup-authorization (Lot 5)',
      'b-komerce.js / bloc Mes documents — GET /api/auth/me/documents + téléchargement PDF authentifié',
    ],
    consumes: [
      'auth — b-komerce.js utilise b-identity.js pour la session et le gate OTP',
      'wallet — b-komerce.js monte la vue wallet canonique',
      'boutique — navigation et bus de la boutique',
      'auth-identity — autorisation nominative de retrait exceptionnel (user_pickup_authorizations, Lot 5)',
      'documents — liste et téléchargement des PDF privés appartenant au compte',
    ],
  },

  authority: 'boutique — tout changement de périmètre de Mon Komerce doit être reflété ici.',

  invariants: [
    "Mon Komerce est une page unique sans vue d'ensemble ni sous-navigation interne",
    "aucun champ présenté comme éditable ne peut être dépourvu de persistance réelle",
    "le WhatsApp du compte n'est jamais modifiable comme un champ texte ordinaire",
    "aucun statut WhatsApp vérifié n'est affiché sans preuve canonique",
    "le bloc autorisation de retrait exceptionnel n'affiche jamais un statut ACTIVE sans que l'utilisateur ait lui-même enregistré un nom",
    "le code de retrait est annoncé lorsque la commande est prête au relais",
    "Suivi reste un espace autonome consacré aux achats",
    "les documents sont affichés sous le wallet sans sous-onglet et ne sont jamais liés depuis WhatsApp",
    "avant une identification Mon Komerce, la navigation revient sur un fond Boutique neutre ; une erreur Suivi ou Mes Partages ne reste jamais exposée sous la modale",
  ],

};
