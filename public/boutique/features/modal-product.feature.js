/**
 * @feature       modal-product (boutique)
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 *
 * Couche frontend de la fiche produit (la feature backend `catalog`/`orders` la
 * nourrit en données ; ce manifeste possède son RENDU). C'est la feature qui a
 * cassé : la normalisation a supprimé le `display:grid` du product-zone, et aucun
 * gate ne l'a vu parce qu'aucun n'AFFIRMAIT le contrat de rendu. Il est ici.
 */
'use strict';

module.exports = {
  name:     'modal-product',
  type:     'feature',
  domain:   'catalog',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // Lot O4 (cross-repo feature coverage) : ce manifeste possede son propre
  // domain déclaré ('catalog') et son propre service rendu est une couche de
  // RENDU (layout/grille/cascade CSS de la fiche produit), pas un service
  // metier autonome — les donnees produit restent la propriete de catalog, et
  // l'ajout panier reste la propriete de orders/shared-cart (perimeter.out
  // ci-dessous). Ne devient donc pas une business feature independante.
  canonicalFeature: 'catalog',
  sliceKind: 'frontend-slice',

  service: 'Afficher la fiche produit en modal : image plein cadre + colonne détails/achat, en grille 2 colonnes sur desktop.',

  perimeter: {
    in:  ['layout et cascade de #k-modal et .k-modal-product-zone', 'placement grille image/détails/actions desktop'],
    out: ['données produit (feature catalog)', 'ajout panier (feature orders/shared-cart)'],
  },

  // Périmètre fichiers (relatif à ce manifeste). La carte gen-ownership.js dit :
  // modal-shell.css (14), modal-product.css (4), interactions.css (2), boutique-desktop.css (1).
  files: {
    boutique: [
      '../css/modal-shell.css',
      '../css/modal-product.css',
      '../css/modal-product-lot4-hybrid.css',
    ],
    dist: [
      '../css/dist/components.css',
    ],
  },

  docs: [
    'CORRECTIONS_APPLIQUEES_MODAL_2026-06-27.md',
    'docs/AUDIT_BOUTIQUE_ARCHI_2026-05-30.md',
    'docs/BOUTIQUE_MODAL_ARCHITECTURE.md',
    'docs/MODAL_DESKTOP_ARCHITECTURE.docx',
    'docs/MODAL_DESKTOP_ARCHITECTURE.md',
    'docs/MODAL_MOBILE_ARCHITECTURE.docx',
    'docs/MODAL_MOBILE_ARCHITECTURE.md',
    'docs/PDP_DESKTOP_APPROCHE_C_HYBRIDE.md',
    'docs/ROADMAP_MODAL_TEMU.md',
  ],

  contract: {
    exposes: [],
    // Migré depuis exposes (audit 2026-07-06, lot UNPARSEABLE) : exports JS
    // internes, pas des routes HTTP.
    internalApi: [
      'b-modal-suggestions.js / suggestions produit dans la modal',
      'b-pdp-curation-suggestions.js / suggestions curatées PDP',
    ],
    consumes: [
      'boutique — b-modal-suggestions.js importe b-bus.js, b-cart.js, b-scroll-owner.js, b-store.js, b-utils.js',
      'boutique — b-pdp-curation-suggestions.js importe b-bus.js, b-scroll-owner.js, b-store.js',
    ],
  },

  // ── Autorité / invariants (niveau 0) ────────────────────────────────────
  authority: 'boutique — tout changement de layout de la modal produit doit préserver les contrats render-static ci-dessous.',

  invariants: [
    'le product-zone desktop reste en display:grid avec grid-template-columns',
  ],

  // ── Contrats positifs exécutables ────────────────────────────────────────
  contracts: {

    // LE contrat qui manquait. Affirme que le layout grid est présent dans le
    // bundle livré. Une suppression de la règle = FAIL au commit (étage statique).
    'render-static': [
      {
        artifact: '../css/dist/components.css',
        label:    'product-zone desktop = grid',
        mustContain: [
          // Le conteneur produit DOIT établir une grille (≠ display:contents seul).
          /#k-modal\s+\.k-modal-product-zone\s*\{[^}]*display:\s*grid/m,
          // Et au moins une répartition de colonnes desktop.
          /#k-modal\s+\.k-modal-product-zone[^{]*\{[^}]*grid-template-columns/m,
        ],
      },
      {
        artifact: '../css/modal-media.css',
        label:    'mobile image overlays anchored to image wrap',
        mustContain: [
          // Le bouton "Voir en grand" est injecté dans .k-modal-img-wrap.
          // Sans position:relative sur le wrap, son absolute tombe sur le CTA Acheter.
          /\.k-modal-img-wrap\s*\{[^}]*position:\s*relative[^}]*\}/m,
          /\.k-modal-view-full\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*12px[^}]*left:\s*10px/m,
        ],
      },
      {
        artifact: '../css/modal-media.css',
        label:    'mobile product image cannot collapse in modal flex scroll',
        mustContain: [
          // .k-modal-img-wrap est enfant flex de .k-modal-scroll sur mobile.
          // Sans flex:0 0 auto, Android peut compresser l'image derrière les détails.
          /\.k-modal-img-wrap\s*\{[^}]*flex:\s*0\s+0\s+auto[^}]*\}/m,
          /\.k-modal-img-wrap\s*\{[^}]*min-height:\s*260px[^}]*\}/m,
        ],
      },
      {
        artifact: '../js/b-modal-suggestions.js',
        label:    'suggestions lifecycle emits curation-ready event',
        mustContain: [
          /bus\.emit\('modal:suggestions-rendered'/m,
          /delete\s+sugSection\.dataset\.curationProductId/m,
        ],
      },
      {
        artifact: '../js/b-modal-suggestions.js',
        label:    'modal suggestions keep discovery level when API is narrow',
        mustContain: [
          /function\s+_ensureTwoSuggestionLevels\(sameCat,\s*otherCat\)/m,
          /p\.category\s*!==\s*product\.category/m,
        ],
      },
      {
        artifact: '../js/b-pdp-curation-suggestions.js',
        label:    'PDP curation waits for rendered suggestions',
        mustContain: [
          /bus\.on\('modal:suggestions-rendered',\s*scheduleEnhanceCuration\)/m,
          /k-pdp-curation-section--complements/m,
        ],
      },
    ],

    // Dette de doctrine token scopée à la modal — RÉSORBÉE (session 6) : les 21
    // rgba(...) ont été retokenisés (20 vers des tokens tokens.css existants,
    // 1 nouveau — --overlay-black-15). Cliquet redescendu à 0 : toute
    // réintroduction de rgba(...) brut dans ces fichiers bloque désormais.
    doctrine: { scope: 'boutique', max: 0 },
  },
};
