/**
 * @feature       modal-product (boutique)
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 *
 * Couche frontend de COMPOSITION de la fiche produit.
 * La feature backend `catalog` nourrit la modal via le contrat detail produit et
 * possede l'etat derive de selection dans les modules JS catalog declares par sa
 * carte. Cette carte Boutique affirme le contrat de rendu responsive et ses
 * invariants statiques : elle ne devient pas un second moteur produit.
 */
'use strict';

module.exports = {
  name:     'modal-product',
  type:     'feature',
  domain:   'catalog',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Composer la fiche produit en modal : plein ecran tactile sur mobile, galerie + Buy Box sur desktop, depuis une meme intelligence produit.',

  perimeter: {
    in: [
      'layout et cascade de #k-modal et .k-modal-product-zone',
      'composition responsive de la zone media, details, selection et actions',
      'placement grille image/details/actions desktop',
      'visibilite et stabilite des actions sticky mobile',
    ],
    out: [
      'contrat detail produit et projection publique (feature catalog)',
      'etat derive de selection SKU et disponibilite combo-aware (feature catalog, owner ViewModel/reducer unique)',
      'decision de rail et delai de livraison (feature logistics)',
      'valorisation transport et prix commercial (feature economic-engine)',
      'ajout panier et checkout (features orders/shared-cart)',
      'fiche snapshot lecture seule du panier partage',
    ],
  },

  // Cette carte possede les artefacts de composition CSS. Les modules JS modal
  // restent declares par features/catalog.feature.js tant que le chantier PDC
  // n'a pas change explicitement leur ownership feature-first.
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
    internalApi: [
      'b-modal-suggestions.js / suggestions produit dans la modal',
      'b-pdp-curation-suggestions.js / suggestions curatees PDP',
    ],
    consumes: [
      'catalog — contrat detail produit public et etat de selection SKU unique',
      'boutique — b-modal-suggestions.js importe b-bus.js, b-cart.js, b-scroll-owner.js, b-store.js, b-utils.js',
      'boutique — b-pdp-curation-suggestions.js importe b-bus.js, b-scroll-owner.js, b-store.js',
    ],
  },

  authority: 'boutique — tout changement de composition responsive de la modal doit preserver les contrats render-static et la frontiere DOCTRINE_PRODUCT_DETAIL_CONTRACT.md.',

  invariants: [
    'le product-zone desktop reste en display:grid avec grid-template-columns',
    'mobile et desktop composent le meme contrat detail et le meme etat de selection ; le CSS ne porte aucune verite stock/prix/livraison',
    'les actions produit mobile restent visibles et le media ne peut pas etre compresse par le flex scroll',
    'la fiche snapshot shared-cart reste hors de la modal catalogue',
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
