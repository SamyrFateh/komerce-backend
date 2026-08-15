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
 * partagé. Extrait de boutique.feature.js (P3, 2026-07-27) : ces 7 fichiers
 * n'apparaissaient dans aucun manifeste `modal-product.feature.js` — preuve
 * qu'il s'agit d'un système distinct. Confirmé par un commentaire dans
 * index.html : "mountSideCartInModal() (b-modal-core.js)" — c'est le modal
 * du panier/groupe, pas celui de la fiche produit (qui a son propre
 * système : b-modal-product-detail-bootstrap.js + view-models/).
 *
 * Nom historique trompeur : b-modal-product.js ne fait PAS partie du système
 * de fiche produit (modal-product.feature.js) — il rend le contenu de CE
 * modal panier/groupe. Renommage non fait dans ce palier (P3 ne doit pas
 * dériver en refactoring de fichiers) — voir dette consignée en fin de
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

  // Rattaché à la feature canonique shared-cart : ce manifeste n'est pas une
  // nouvelle identité métier, seulement la surface frontend "modal" de la
  // capacité shared-cart déjà propriétaire de b-group-view.js / b-share-cart.js.
  canonicalFeature: 'shared-cart',
  sliceKind: 'frontend-slice',

  service: "Surface modale du panier partagé (panier/groupe) — orchestration d'ouverture, navigation carousel, contenu produit dans le modal, preuve sociale, ajout panier depuis le modal.",

  perimeter: {
    in:  ['fichiers js/* annotés @domain shared-cart-modal'],
    out: [
      'logique backend équivalente (repo komerce-backend, feature shared-cart)',
      'modal de fiche produit (modal-product.feature.js) — système distinct',
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
      '../tests/unit/modal-cart-stepper-cycle.test.js',
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
      'boutique — b-bus.js, b-store.js, b-scroll-owner.js',
      'shared-cart — b-cart.js (addToCart/quickAdd/quickRemove/setQty, via b-modal-cart.js)',
    ],
  },

  authority: 'boutique — tout changement de périmètre de ce domaine doit être reflété ici.',

  invariants: [
    'tout fichier js/* portant @domain shared-cart-modal doit être listé dans files.js de ce manifeste',
    'tout test unitaire couvrant un fichier files.js de ce manifeste doit être listé dans files.tests',
    'le bouton favori de la fiche produit garde aria-pressed et son libellé Ajouter ou Retirer synchronisés avec l état réel',
    'le stepper de la fiche produit mute une ligne panier exacte ; pour un SKU, b-modal-cart.js résout sku_id puis variant_combo avant tout setQty',
    'sur desktop le bouton panier centre ouvre le recapitulatif canonique du checkout sans cibler le side-cart ; sur mobile il ouvre le drawer de relecture',
  ],

  // Dette consignée (R7 — hors périmètre de ce palier) :
  // 1. b-modal-product.js est mal nommé : son rôle réel est
  //    "product-modal-content-renderer" DANS ce modal panier/groupe, pas
  //    dans modal-product.feature.js. Un renommage (ex. b-shared-cart-modal-
  //    content.js) clarifierait mais n'a pas été fait ici.
  // 2. tests/unit/b-modal-cart.test.js reste déclaré dans shared-cart (pas
  //    ici) : son require() réel cible js/b-cart.js, pas b-modal-cart.js —
  //    nom de fichier trompeur, comportement vérifié avant de classer.
  // 3. tests/e2e/modal.spec.js n'a pas été déplacé : son header déclare
  //    @feature catalog, modal-product et son DOM cible (#k-modal-name,
  //    #k-modal-carousel) appartient au modal de fiche produit, pas à ce
  //    cluster — vérifié avant d'exclure, pas supposé.
};
