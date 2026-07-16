'use strict';

/**
 * tests/unit/b-modal-mobile-product.test.js
 *
 * Périmètre : renderActions() dans b-modal-mobile-product.js — gouvernance
 * PDC-6 des CTA (Ajouter/Acheter) ET du stepper modal (+/-) à partir du
 * contrat détail (inventory_model, selected_sku_id).
 *
 * Matrice couverte :
 *   - LEGACY_VARIANTS (non-SKU)              → CTA actif, stepper autorisé (historique)
 *   - SKU, selected_sku_id absent             → CTA verrouillé, stepper verrouillé
 *   - SKU, selected_sku_id résolu             → CTA actif, stepper TOUJOURS verrouillé
 *       (le stepper mute le panier "product-id first" — jamais valide en SKU)
 *
 * MDM-8 (2026-07) : sous-total (MDP-1) et sélecteur de paiement (MDP-2) ont
 * été retirés de la composition mobile — ils appartiennent au parcours
 * d'achat, pas à la fiche produit. Le prix courant reste calculé via
 * b-modal-buybox-shared.js (getCurrentPrice) et affiché dans l'identité
 * compacte ; il n'y a plus de sous-total ni de modes de paiement à tester
 * côté mobile (voir modal-mobile-desktop-parity.test.js pour la parité avec
 * le desktop, qui conserve ces deux blocs).
 */

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
}));

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
  optimizeImgUrl: jest.fn((url) => url),
}));

jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  OPTION_STATE: { AVAILABLE: 'AVAILABLE', OUT_OF_STOCK: 'OUT_OF_STOCK', INCOMPATIBLE: 'INCOMPATIBLE' },
  selectModalOption: jest.fn(),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

// b-modal-mobile-product.js délègue le calcul du prix courant à
// b-modal-buybox-shared.js, qui importe à son tour b-modal.js/b-cart.js/
// b-share-cart.js — mocks isolants, même convention que
// tests/unit/b-modal-desktop-product.test.js.
jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

const { state, dom } = require('../../js/b-store.js');
const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');

function installDom() {
  document.body.innerHTML =
    '<div id="k-modal">' +
      '<div id="k-modal-variants"></div>' +
      '<button id="k-add-cart-btn"></button>' +
      '<button id="k-buy-now-btn"></button>' +
      '<button id="k-qty-minus"></button>' +
      '<button id="k-qty-plus"></button>' +
    '</div>';
  window.matchMedia = jest.fn().mockReturnValue({ matches: true }); // mobile
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalStock = document.createElement('div');
}

function transactionalControls() {
  return [
    document.getElementById('k-add-cart-btn'),
    document.getElementById('k-buy-now-btn'),
  ];
}

function stepperControls() {
  return [document.getElementById('k-qty-minus'), document.getElementById('k-qty-plus')];
}

function baseDetail(overrides) {
  return Object.assign({
    contract_version: '1',
    product: { id: 'p1', name: 'Robe', description: '', category: '' },
    pricing: { price_kmf: 5000, promo_pct: 0, old_price_kmf: null },
    media: [],
    option_axes: [],
    sellable_units: [],
    delivery_options: [],
  }, overrides);
}

function baseSelection(overrides) {
  return Object.assign({
    selection_supported: false,
    selected_options: {},
    selected_sku_id: null,
    selected_media: [],
    option_states: {},
    selection_message: null,
  }, overrides);
}

describe('b-modal-mobile-product — renderActions (CTA + stepper, PDC-6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  test('LEGACY_VARIANTS (non-SKU) : CTA actif et stepper autorisé (comportement historique)', () => {
    const detail = baseDetail({ inventory_model: 'LEGACY_VARIANTS' });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    transactionalControls().forEach((btn) => expect(btn.disabled).toBe(false));
    stepperControls().forEach((btn) => expect(btn.disabled).toBe(false));
  });

  test('SKU sans selected_sku_id : CTA verrouillé ET stepper verrouillé', () => {
    const detail = baseDetail({ inventory_model: 'SKU' });
    const selection = baseSelection({ selected_sku_id: null });

    renderMobileProductDetail(detail, selection);

    transactionalControls().forEach((btn) => expect(btn.disabled).toBe(true));
    stepperControls().forEach((btn) => expect(btn.disabled).toBe(true));
  });

  test('SKU résolu (selected_sku_id présent) : CTA actif, mais stepper TOUJOURS verrouillé', () => {
    const detail = baseDetail({ inventory_model: 'SKU' });
    const selection = baseSelection({ selected_sku_id: 'sku-42' });

    renderMobileProductDetail(detail, selection);

    transactionalControls().forEach((btn) => expect(btn.disabled).toBe(false));
    // Preuve : aucune mutation panier "product-id first" possible même une
    // fois le SKU résolu — le stepper reste hors service en SKU.
    stepperControls().forEach((btn) => expect(btn.disabled).toBe(true));
  });
});

// MDP-1 (prix courant) : la composition mobile affiche toujours le prix
// courant dans l'identité compacte, dérivé de la même fonction pure que le
// desktop (getCurrentPrice, via b-modal-buybox-shared.js).
describe('b-modal-mobile-product — prix courant dans l’identité (MDP-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  test('affiche le prix produit quand aucune unité SKU n’est résolue', () => {
    const detail = baseDetail({ pricing: { price_kmf: 2000 } });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    expect(dom.modalPrice.textContent).toBe('2000 KMF');
  });

  test('utilise le prix de l’unité SKU résolue plutôt que le prix produit', () => {
    const detail = baseDetail({
      inventory_model: 'SKU',
      pricing: { price_kmf: 5000 },
      sellable_units: [{ sku_id: 'sku-1', price_kmf: 9000 }],
    });
    const selection = baseSelection({ selected_sku_id: 'sku-1' });

    renderMobileProductDetail(detail, selection);

    expect(dom.modalPrice.textContent).toBe('9000 KMF');
  });
});

// MDM-8 : sous-total et modes de paiement sont retirés de la composition
// mobile — ils n'appartiennent plus à la fiche produit. Ce test verrouille
// leur absence pour empêcher une régression qui les réintroduirait.
describe('b-modal-mobile-product — extinction du sous-total et du paiement (MDM-8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  test('ne rend ni sous-total ni sélecteur de paiement sur la fiche produit mobile', () => {
    const detail = baseDetail();
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    expect(document.querySelector('.k-modal-subtotal')).toBeNull();
    expect(document.querySelector('.k-modal-subtotal--mobile')).toBeNull();
    expect(document.querySelector('.k-buybox-payment-mobile')).toBeNull();
    expect(document.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(0);
  });
});

// Lot Content, commit 4 — below-fold consomme content.* via
// view-models/product-content-model.js. Ces tests couvrent la composition
// mobile réelle (DOM), pas le tri/filtrage (déjà couvert par
// product-content-model.test.js).
describe('b-modal-mobile-product — contenu enrichi below-fold (Lot Content)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  function belowFoldSections() {
    return [...document.querySelectorAll('.k-mdm-content-section, .k-mdm-desc-section')];
  }

  test('produit pauvre (content absent) : seule la description s’affiche, aucune coquille vide (MDM-9)', () => {
    const detail = baseDetail({ product: { id: 'p1', name: 'T-shirt', description: 'Un t-shirt simple.', category: '' } });
    renderMobileProductDetail(detail, baseSelection());

    const sections = belowFoldSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].querySelector('.k-mdm-section-heading').textContent).toBe('Description');
    expect(document.querySelector('.k-mdm-content-section--highlights')).toBeNull();
    expect(document.querySelector('.k-mdm-content-section--specs')).toBeNull();
  });

  test('produit pauvre sans description non plus : aucune section below-fold', () => {
    const detail = baseDetail({ product: { id: 'p1', name: 'T-shirt', description: '', category: '' } });
    renderMobileProductDetail(detail, baseSelection());
    expect(belowFoldSections()).toHaveLength(0);
  });

  test('produit enrichi : rend points forts, caractéristiques, composition, entretien, avertissements, dans cet ordre', () => {
    const detail = baseDetail({
      product: { id: 'p1', name: 'Chaussure', description: 'Une chaussure de sport.', category: '' },
      content: {
        brand: 'Elite Pro',
        short_description: null,
        highlights: [{ key: 'h1', label: 'Grip renforcé' }, { key: 'h2', label: 'Ultra léger' }],
        specifications: [
          { group: 'Semelle', key: 's1', label: 'Type', value: 'Crampons FG', unit: null, display_order: 0 },
        ],
        sections: [],
        materials: ['Cuir synthétique', 'Semelle TPU'],
        care: ['Nettoyer avec un chiffon humide'],
        warnings: ['Ne convient pas au terrain synthétique'],
        provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
      },
    });

    renderMobileProductDetail(detail, baseSelection());

    const headings = [...document.querySelectorAll('.k-mdm-section-heading')].map((el) => el.textContent);
    expect(headings).toEqual(['Description', 'Points forts', 'Caractéristiques', 'Composition', 'Entretien', 'À savoir']);

    const highlightItems = [...document.querySelectorAll('.k-mdm-content-section--highlights li')].map((li) => li.textContent);
    expect(highlightItems).toEqual(['Grip renforcé', 'Ultra léger']);

    expect(document.querySelector('.k-mdm-content-section--specs dt').textContent).toBe('Type');
    expect(document.querySelector('.k-mdm-content-section--specs dd').textContent).toBe('Crampons FG');
  });

  test('description courte : aucun bouton "Lire la suite" (contenu non masqué)', () => {
    const detail = baseDetail({ product: { id: 'p1', name: 'T-shirt', description: 'Court.', category: '' } });
    renderMobileProductDetail(detail, baseSelection());
    expect(document.querySelector('.k-mdm-read-more')).toBeNull();
  });

  test('description longue : bouton "Lire la suite" présent et fonctionnel', () => {
    const long = 'Un tissu technique. '.repeat(20);
    const detail = baseDetail({ product: { id: 'p1', name: 'T-shirt', description: long, category: '' } });
    renderMobileProductDetail(detail, baseSelection());

    const readMore = document.querySelector('.k-mdm-read-more');
    expect(readMore).not.toBeNull();
    expect(readMore.textContent).toBe('Lire la suite');

    readMore.click();
    expect(readMore.textContent).toBe('Réduire');
    expect(document.querySelector('.k-mdm-desc-text').classList.contains('k-mdm-desc-text--expanded')).toBe(true);
  });

  test('section éditoriale KEY_VALUE (ex. guide des tailles) : rendue en liste clé/valeur', () => {
    const detail = baseDetail({
      product: { id: 'p1', name: 'Chaussure', description: '', category: '' },
      content: {
        brand: null,
        short_description: null,
        highlights: [],
        specifications: [],
        sections: [
          {
            key: 'size-guide',
            title: 'Guide des tailles',
            type: 'KEY_VALUE',
            text: null,
            items: [],
            entries: [{ label: '40', value: 'EU 40 / UK 6.5' }],
            display_order: 0,
          },
        ],
        materials: [],
        care: [],
        warnings: [],
        provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
      },
    });

    renderMobileProductDetail(detail, baseSelection());

    expect(document.querySelector('.k-mdm-section-heading').textContent).toBe('Guide des tailles');
    expect(document.querySelector('.k-mdm-content-section--specs dt').textContent).toBe('40');
    expect(document.querySelector('.k-mdm-content-section--specs dd').textContent).toBe('EU 40 / UK 6.5');
  });
});
