/**
 * @feature       modal-product (boutique)
 * @type          feature
 * @domain        catalog
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 *
 * Couche frontend de la fiche produit. Le backend catalog nourrit la fiche via
 * le Product Detail Contract ; cette feature possède son état de sélection et
 * ses deux compositions responsive. Mobile et desktop n'ont jamais deux vérités
 * produit ni deux moteurs de sélection.
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
    in: [
      'chargement unique du Product Detail Contract v1 pour la modal produit',
      'état de sélection produit unique dérivé du Product Detail Contract v1',
      'dépendance ordonnée des axes : changer un axe efface les choix aval',
      'états AVAILABLE / OUT_OF_STOCK / INCOMPATIBLE dérivés des sellable_units réelles',
      'sélection transactionnelle par sku_id',
      'snapshot panier de la sellable_unit sélectionnée : sku_id, référence, prix et média',
      'médias courants dérivés des associations option_values / media_ids explicites',
      'composition mobile PDC-4 : vignettes photo, tailles combo-aware, message contextuel, livraison contractuelle et galerie liée à la sélection',
      'composition desktop PDC-5 : galerie à gauche, Buy Box à droite, mêmes SKU, mêmes médias, mêmes disponibilités et mêmes options de livraison',
      'enrichissements desktop de navigation et éditoriaux sans recalcul produit',
      'layout et cascade de #k-modal et .k-modal-product-zone',
    ],
    out: [
      'données produit et vérité stock (feature catalog backend)',
      'routing et choix de rail (feature logistics)',
      'création de SKU depuis la modal',
      'checkout final (features orders/payments)',
      'fiche snapshot lecture seule du panier partagé',
    ],
  },

  files: {
    boutique: [
      '../js/view-models/modal-selection-model.js',
      '../js/view-models/modal-cart-product-model.js',
      '../js/view-models/product-content-model.js',
      '../js/view-models/delivery-mode-model.js',
      '../js/b-modal-product-detail-bootstrap.js',
      '../js/b-modal-mobile-product.js',
      '../js/b-modal-desktop-product.js',
      '../js/b-modal-buybox-shared.js',
      '../js/b-modal-product-fields.js',
      '../js/b-modal-desktop-enhancers.js',
      '../css/modal-shell.css',
      '../css/modal-product.css',
      '../css/modal-product-lot4-hybrid.css',
      '../css/modal-mobile-canonical.css',
      '../css/modal-mobile-suggestion-actions.css',
      '../css/modal-enriched-content.css',
      '../css/modal-cart-sku-guard.css',
      // P3b (2026-07-27) : déjà utilisé comme contract.artifact plus bas
      // (mobile image overlays / flex scroll) mais jamais déclaré ici.
      '../css/modal-media.css',
    ],
    dist: [
      '../css/dist/components.css',
    ],
    tests: [
      '../tests/unit/modal-selection-model.test.js',
      '../tests/unit/modal-cart-product-model.test.js',
      '../tests/unit/product-content-model.test.js',
      '../tests/unit/b-modal-mobile-product.test.js',
      '../tests/unit/b-modal-desktop-product.test.js',
      '../tests/unit/b-modal-buybox-shared.test.js',
      '../tests/unit/modal-mobile-desktop-parity.test.js',
      '../tests/unit/b-modal-product-detail-bootstrap.test.js',
      '../tests/unit/modal-mobile-suggestion-actions.test.js',
      '../tests/unit/modal-mobile-canonical.test.js',
      '../tests/unit/b-modal-desktop-enhancers.test.js',
      '../tests/unit/modal-product-price-normalization.test.js',
      '../tests/unit/modal-v3-convergence-invariants.test.js',
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
    '../../../docs/chantier/PDC4_MOBILE_MODAL.md',
    '../../../docs/chantier/PDC5_DESKTOP_MODAL.md',
  ],

  contract: {
    exposes: [],
    internalApi: [
      'modal-selection-model.js / createModalSelection(productDetail)',
      'modal-selection-model.js / selectModalOption(productDetail, state, axisKey, value)',
      'modal-cart-product-model.js / buildModalCartProduct(product, detail, selection)',
      'b-modal-product-detail-bootstrap.js / setupProductDetailModal()',
      'b-modal-mobile-product.js / renderMobileProductDetail(productDetail, selection)',
      'b-modal-desktop-product.js / renderDesktopProductDetail(productDetail, selection)',
      'b-modal-desktop-product.js / refreshDesktopProductSubtotal()',
      'b-modal-buybox-shared.js / getCurrentPrice(detail, selection), computeSubtotal(detail, selection, qty), renderSubtotalInto(el, detail, selection, qty)',
      'b-modal-buybox-shared.js / renderPaymentModes(el, opts), startGroupCartFlow(product, qty, sourceEl)',
      'b-modal-suggestions.js / suggestions produit dans la modal',
      'b-pdp-curation-suggestions.js / suggestions curatées PDP',
    ],
    consumes: [
      'catalog — Product Detail Contract v1 / GET /api/products/:id/detail',
      'boutique — b-modal-image-ux.js pour le compteur et fullscreen de la galerie reconstruite',
      'boutique — panier legacy transitoire reçoit le snapshot variant_combo dérivé de selected_options ; résolution SKU autoritaire reste backend',
      'boutique — b-modal-desktop-enhancers.js enrichit seulement navigation, partage, trust et récemment vus (réconcilié sur modal:opened ET modal:composition-synced)',
      'boutique — b-modal-mobile-product.js et b-modal-desktop-product.js appellent tous deux b-modal-buybox-shared.js pour le prix, le sous-total et les modes de paiement — logique unique, projections distinctes',
    ],
  },

  authority: 'boutique — modal-selection-model.js possède seul l état de sélection SKU ; b-modal-product-detail-bootstrap.js possède seul le fetch du contrat détail ; modal-cart-product-model.js possède la projection de la sellable_unit sélectionnée vers le snapshot panier ; les renderers responsive rendent cet état sans recalcul métier.',

  invariants: [
    'un seul Product Detail Contract est chargé par ouverture produit puis partagé par mobile et desktop',
    'un seul état de sélection produit est partagé par mobile et desktop',
    'une option est AVAILABLE, OUT_OF_STOCK ou INCOMPATIBLE uniquement depuis les sellable_units du contrat détail',
    'aucun stock couleur ou taille indépendant n est recalculé dans la modal cible',
    'changer un axe efface les sélections des axes suivants dans l ordre du contrat',
    'selected_sku_id n est posé que pour une unité vendable AVAILABLE résolue',
    'un produit LEGACY_VARIANTS est explicitement selection_supported=false : aucun faux SKU n est fabriqué',
    'sur mobile et desktop, Ajouter et Acheter restent désactivés pour un produit SKU tant que selected_sku_id est null',
    'un ajout SKU persiste le prix, la référence et le média de la sellable_unit sélectionnée, jamais seulement les champs catalogue du produit',
    'le stepper product-level reste interdit pour un inventaire SKU ; chaque clic CTA SKU porte une intention de 1 unité',
    'les vignettes photo viennent de option_axes.values.thumbnail_url ; aucune couleur ou image n est déduite par heuristique',
    'les carousels responsive suivent selected_media et le fullscreen relit les slides après chaque reconstruction',
    'mobile et desktop rendent delivery_options ; aucune liste Standard/Express ni délai universel n est codé dans un renderer',
    'mobile et desktop utilisent la même logique de sous-total (b-modal-buybox-shared.js / computeSubtotal) : prix de l unité SKU sélectionnée ou prix produit du contrat, multiplié par modalQty',
    'mobile et desktop exposent les mêmes modes de paiement (Carte / Cash / Panier partagé / Cagnotte) via b-modal-buybox-shared.js / renderPaymentModes — composition différente, logique unique',
    'b-modal-desktop-enhancers.js ne calcule ni prix, ni stock, ni livraison, ni sous-total',
    'toute transition de viewport (resize) sur une modal ouverte émet modal:composition-synced et réconcilie enhancers desktop + placement des actions sans refetch ni perte de sélection',
    'le snapshot modalVariantCombo de transition est une copie de selected_options, jamais une seconde intelligence de stock',
    'le guard de repaint legacy est transitoire jusqu à PDC-6 et ne dérive aucune vérité métier',
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
