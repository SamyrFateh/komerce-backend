/**
 * @feature       modal-product (boutique)
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 *
 * Couche frontend de la fiche produit. Le backend `catalog` fournit le Product
 * Detail Contract ; cette feature possède l'état d'interaction et le rendu.
 * Mobile et desktop partagent une seule vérité de sélection SKU.
 */
'use strict';

module.exports = {
  name:     'modal-product',
  type:     'feature',
  domain:   'catalog',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Sélectionner une unité vendable SKU dans un état unique puis afficher la fiche produit en deux compositions responsive.',

  perimeter: {
    in: [
      'état de sélection unique dérivé du Product Detail Contract v1',
      'dépendance ordonnée des axes : changer un axe efface les choix aval',
      'états AVAILABLE / OUT_OF_STOCK / INCOMPATIBLE dérivés des sellable_units',
      'sélection transactionnelle par sku_id',
      'médias courants dérivés des associations option_values / media_ids explicites',
      'layout et cascade de #k-modal et .k-modal-product-zone',
      'placement grille image/détails/actions desktop',
    ],
    out: [
      'données produit et vérité stock (feature catalog)',
      'routing et choix de rail (feature logistics)',
      'ajout panier et checkout (features orders/shared-cart)',
      'fiche snapshot lecture seule du panier partagé',
    ],
  },

  files: {
    // Le registre Boutique ne reconnaît que le groupe `js` pour le rattachement
    // fichier↔feature. Le reducer appartient donc explicitement à ce slice.
    js: [
      '../js/view-models/modal-selection-model.js',
    ],
    boutique: [
      '../css/modal-shell.css',
      '../css/modal-product.css',
      '../css/modal-product-lot4-hybrid.css',
    ],
    dist: [
      '../css/dist/components.css',
    ],
    tests: [
      '../tests/unit/modal-selection-model.test.js',
      '../tests/unit/modal-selection-model-axis-order.test.js',
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
    internalApi: [
      'modal-selection-model.js / createModalSelection(productDetail)',
      'modal-selection-model.js / selectModalOption(productDetail, state, axisKey, value)',
      'b-modal-suggestions.js / suggestions produit dans la modal',
      'b-pdp-curation-suggestions.js / suggestions curatées PDP',
    ],
    consumes: [
      'catalog — Product Detail Contract v1 / GET /api/products/:id/detail',
      'boutique — b-modal-suggestions.js importe b-bus.js, b-cart.js, b-scroll-owner.js, b-store.js, b-utils.js',
      'boutique — b-pdp-curation-suggestions.js importe b-bus.js, b-scroll-owner.js, b-store.js',
    ],
  },

  authority: 'boutique — modal-selection-model.js est l unique owner de l état de sélection SKU ; tout changement de layout doit préserver les contrats render-static.',

  invariants: [
    'un seul état de sélection produit est partagé par mobile et desktop',
    'une option est AVAILABLE, OUT_OF_STOCK ou INCOMPATIBLE uniquement depuis les sellable_units du contrat détail',
    'aucun stock couleur ou taille indépendant n est recalculé dans le reducer cible',
    'changer un axe efface les sélections des axes suivants dans l ordre du contrat',
    'selected_sku_id n est posé que pour une unité vendable AVAILABLE résolue',
    'un produit LEGACY_VARIANTS est explicitement selection_supported=false : aucun faux SKU n est fabriqué',
    'le product-zone desktop reste en display:grid avec grid-template-columns',
  ],

  contracts: {
    'render-static': [
      {
        artifact: '../css/dist/components.css',
        label:    'product-zone desktop = grid',
        mustContain: [
          /#k-modal\s+\.k-modal-product-zone\s*\{[^}]*display:\s*grid/m,
          /#k-modal\s+\.k-modal-product-zone[^{]*\{[^}]*grid-template-columns/m,
        ],
      },
      {
        artifact: '../css/modal-media.css',
        label:    'mobile image overlays anchored to image wrap',
        mustContain: [
          /\.k-modal-img-wrap\s*\{[^}]*position:\s*relative[^}]*\}/m,
          /\.k-modal-view-full\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*12px[^}]*left:\s*10px/m,
        ],
      },
      {
        artifact: '../css/modal-media.css',
        label:    'mobile product image cannot collapse in modal flex scroll',
        mustContain: [
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

    doctrine: { scope: 'boutique', max: 0 },
  },
};
