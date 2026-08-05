/**
 * @feature       recommendations
 * @type          feature
 * @domain        recommendations
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour le domaine frontend
 * "recommendations". Genere pour rattacher les modules JS existants (deja annotes
 * @domain recommendations dans leur header) a un manifest reel, afin que
 * scripts/feature-registry-check.js cesse de les compter en orphelins.
 */
'use strict';

module.exports = {

  name:     'recommendations',
  type:     'feature',
  domain:   'recommendations',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // Lot O4 (cross-repo feature coverage) : meme identite metier que
  // backend:recommendations (rendu du classement produit calcule cote
  // backend par services/boutique-ranking-engine.js). Ecart mineur constate,
  // non corrige ici (hors perimetre O4) : backend:recommendations.files.boutique
  // ne revendique pas encore b-modal-suggestions.js / b-pdp-curation-suggestions.js —
  // dette a traiter separement, symetrique au fix deja fait sur catalog.
  canonicalFeature: 'recommendations',
  sliceKind: 'frontend-slice',

  service: "Suggestions et curation produit : rail modal, contrôle d’ajout stable et curation éditoriale PDP.",

  perimeter: {
    in:  ['fichiers js/* annotes @domain recommendations', 'présentation des cartes de suggestion dans la modale produit'],
    out: ['logique backend equivalente (repo komerce-backend, feature recommendations)'],
  },

  files: {
    js: [
      '../js/b-modal-suggestions.js',
      '../js/b-pdp-curation-suggestions.js',
    ],
    css: [
      '../css/modal-product-polish.css',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : exports JS
    // internes, pas des routes HTTP.
    internalApi: [
      'b-modal-suggestions.js (partagé avec modal-product)',
      'b-pdp-curation-suggestions.js',
      'modal-product-polish.css (géométrie stable + / stepper et rythme du rail modal)',
    ],
    consumes: [
      'boutique — b-modal-suggestions.js, b-pdp-curation-suggestions.js importent b-bus.js, b-cart.js, b-scroll-owner.js, b-store.js, b-utils.js',
    ],
  },

  authority: 'boutique — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier js/* portant @domain recommendations doit etre liste dans files.js de ce manifeste',
    'le bouton + et le stepper des suggestions partagent une emprise stable et ne déplacent jamais la carte',
    'le scroll des suggestions ne change jamais automatiquement de filtre ni de position',
  ],

};
