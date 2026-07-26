/**
 * @feature       shared-cart-modal
 * @type          feature
 * @domain        shared-cart-modal
 * @status        production
 * @owner         boutique
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 *
 * Manifeste niveau 0 (gouvernance fichiers) pour la surface modale du panier
 * partagÃ©. Extrait de boutique.feature.js (P3, 2026-07-27) : ces 7 fichiers
 * n'apparaissaient dans aucun manifeste `modal-product.feature.js` â€” preuve
 * qu'il s'agit d'un systÃ¨me distinct. ConfirmÃ© par un commentaire dans
 * index.html : "mountSideCartInModal() (b-modal-core.js)" â€” c'est le modal
 * du panier/groupe, pas celui de la fiche produit (qui a son propre
 * systÃ¨me : b-modal-product-detail-bootstrap.js + view-models/).
 *
 * Nom historique trompeur : b-modal-product.js ne fait PAS partie du systÃ¨me
 * de fiche produit (modal-product.feature.js) â€” il rend le contenu de CE
 * modal panier/groupe. Renommage non fait dans ce palier (P3 ne doit pas
 * dÃ©river en refactoring de fichiers) â€” voir dette consignÃ©e en fin de
 * fichier.
 */
'use strict';

module.exports = {

  name:     'shared-cart-modal',
  type:     'feature',
  domain:   'shared-cart-modal',
  status:   'production',
  owner:    'boutique',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // RattachÃ© Ã  la feature canonique shared-cart : ce manifeste n'est pas une
  // nouvelle identitÃ© mÃ©tier, seulement la surface frontend "modal" de la
  // capacitÃ© shared-cart dÃ©jÃ  propriÃ©taire de b-group-view.js / b-share-cart.js.
  canonicalFeature: 'shared-cart',
  sliceKind: 'frontend-slice',

  service: "Surface modale du panier partagÃ© (panier/groupe) â€” orchestration d'ouverture, navigation carousel, contenu produit dans le modal, preuve sociale, ajout panier depuis le modal.",

  perimeter: {
    in:  ['fichiers js/* annotÃ©s @domain shared-cart-modal'],
    out: [
      'logique backend Ã©quivalente (repo komerce-backend, feature shared-cart)',
      'modal de fiche produit (modal-product.feature.js) â€” systÃ¨me distinct',
    ],
  },

  files: {
    js: [
      '../js/b-modal-core.js',
      '../js/b-modal.js',
      '../js/b-modal-nav.js',
      '../js/b-modal-cart.js',
      '../js/b-modal-social-proof.js',
      '../js/b-modal-image-ux.js',
      '../js/b-modal-product.js',
    ],
    tests: [
      '../tests/unit/b-modal-core.test.js',
      '../tests/unit/b-modal-core-pdc6-baseline.test.js',
      '../tests/unit/b-modal-core-pdc6-coverage.test.js',
      '../tests/unit/b-modal-core-desktop-click.test.js',
      '../tests/unit/b-modal-core-active-flows.test.js',
      '../tests/unit/b-modal-social-proof.test.js',
      '../tests/unit/b-modal-product.test.js',
      '../tests/unit/b-modal-product-mdm9.test.js',
      '../tests/unit/b-modal-image-ux.test.js',
      '../tests/unit/b-modal-nav.test.js',
    ],
  },

  docs: [],

  contract: {
    exposes: [],
    internalApi: [
      'openModal / closeModal / setupModal (b-modal-core.js)',
      'updateModalNavArrows / navigateModal (b-modal-nav.js)',
      'goToSlide / buildCarouselSlides (b-modal-product.js)',
      'setupImageUX (b-modal-image-ux.js)',
      'setupSocialProof (b-modal-social-proof.js)',
    ],
    consumes: [
      'boutique â€” b-bus.js, b-store.js, b-scroll-owner.js',
      'shared-cart â€” b-cart.js (addToCart/quickAdd/quickRemove, via b-modal-cart.js)',
    ],
  },

  authority: 'boutique â€” tout changement de pÃ©rimÃ¨tre de ce domaine doit Ãªtre reflÃ©tÃ© ici.',

  invariants: [
    'tout fichier js/* portant @domain shared-cart-modal doit Ãªtre listÃ© dans files.js de ce manifeste',
    'tout test unitaire couvrant un fichier files.js de ce manifeste doit Ãªtre listÃ© dans files.tests',
  ],

  // Dette consignÃ©e (R7 â€” hors pÃ©rimÃ¨tre de ce palier) :
  // 1. b-modal-product.js est mal nommÃ© : son rÃ´le rÃ©el est
  //    "product-modal-content-renderer" DANS ce modal panier/groupe, pas
  //    dans modal-product.feature.js. Un renommage (ex. b-shared-cart-modal-
  //    content.js) clarifierait mais n'a pas Ã©tÃ© fait ici.
  // 2. tests/unit/b-modal-cart.test.js reste dÃ©clarÃ© dans shared-cart (pas
  //    ici) : son require() rÃ©el cible js/b-cart.js, pas b-modal-cart.js â€”
  //    nom de fichier trompeur, comportement vÃ©rifiÃ© avant de classer.
  // 3. tests/e2e/modal.spec.js n'a pas Ã©tÃ© dÃ©placÃ© : son header dÃ©clare
  //    @feature catalog, modal-product et son DOM cible (#k-modal-name,
  //    #k-modal-carousel) appartient au modal de fiche produit, pas Ã  ce
  //    cluster â€” vÃ©rifiÃ© avant d'exclure, pas supposÃ©.
};
