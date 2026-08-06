'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

// §4 — mock isDesktop pour le routing viewport (remplace window.matchMedia)
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false), // défaut : mobile
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');

function installDom() {
  document.body.innerHTML =
    '<div id="k-modal">' +
      '<div id="k-modal-variants"></div>' +
      '<span class="k-modal-sku" id="k-modal-sku"></span>' +
      '<span id="k-modal-cat"></span>' +
      '<div class="k-modal-price-row">' +
        '<span id="k-modal-price"></span>' +
        '<span id="k-modal-old-price"></span>' +
      '</div>' +
      '<button id="k-add-cart-btn"></button>' +
      '<button id="k-buy-now-btn"></button>' +
      '<button id="k-qty-minus"></button>' +
      '<button id="k-qty-plus"></button>' +
    '</div>';
  // isDesktop() mocké à false (mobile) via jest.mock de b-scroll-owner.js ci-dessus
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalPrice = document.getElementById('k-modal-price');
  dom.modalOldPrice = document.getElementById('k-modal-old-price');
  dom.modalSku = document.getElementById('k-modal-sku');
  dom.modalCat = document.getElementById('k-modal-cat');
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

describe('b-modal-mobile-product — renderStockPill (M1, spec §5.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  function unit(overrides) {
    return Object.assign({
      sku_id: 'sku-1',
      sku: 'GOLD-BLU-42',
      option_values: {},
      stock_status: 'AVAILABLE',
      available_quantity: 8,
      price_kmf: 5000,
      media_ids: [],
    }, overrides);
  }

  function pill() {
    return document.querySelector('#k-modal-stock-pill');
  }

  test('stock > 5 : pill "En stock", variant ok', () => {
    const detail = baseDetail({ inventory_model: 'SKU', sellable_units: [unit({ available_quantity: 8 })] });
    const selection = baseSelection({ selection_supported: true, selected_sku_id: 'sku-1' });

    renderMobileProductDetail(detail, selection);

    expect(pill().hidden).toBe(false);
    expect(pill().className).toBe('k-mdm-stock-pill k-mdm-stock-pill--ok');
    expect(pill().querySelector('.k-mdm-stock-pill-label').textContent).toBe('En stock');
  });

  test('1 ≤ stock ≤ 5 : pill "Plus que N", variant low', () => {
    const detail = baseDetail({ inventory_model: 'SKU', sellable_units: [unit({ available_quantity: 3 })] });
    const selection = baseSelection({ selection_supported: true, selected_sku_id: 'sku-1' });

    renderMobileProductDetail(detail, selection);

    expect(pill().className).toBe('k-mdm-stock-pill k-mdm-stock-pill--low');
    expect(pill().querySelector('.k-mdm-stock-pill-label').textContent).toBe('Plus que 3');
  });

  test('stock = 0 : pill "Épuisé", variant out', () => {
    const detail = baseDetail({ inventory_model: 'SKU', sellable_units: [unit({ available_quantity: 0, stock_status: 'OUT_OF_STOCK' })] });
    const selection = baseSelection({ selection_supported: true, selected_sku_id: 'sku-1' });

    renderMobileProductDetail(detail, selection);

    expect(pill().className).toBe('k-mdm-stock-pill k-mdm-stock-pill--out');
    expect(pill().querySelector('.k-mdm-stock-pill-label').textContent).toBe('Épuisé');
  });

  test('aucune unité résolue (sélection incomplète) : pill absent/masqué, aucune donnée inventée', () => {
    const detail = baseDetail({ inventory_model: 'SKU', sellable_units: [unit({ available_quantity: 8 })] });
    const selection = baseSelection({ selection_supported: true, selected_sku_id: null });

    renderMobileProductDetail(detail, selection);

    expect(pill()).toBeNull();
  });

  test('changement de sélection : le pill se met à jour sans dupliquer le noeud', () => {
    const detail = baseDetail({
      inventory_model: 'SKU',
      sellable_units: [unit({ sku_id: 'sku-1', available_quantity: 8 }), unit({ sku_id: 'sku-2', available_quantity: 2 })],
    });

    renderMobileProductDetail(detail, baseSelection({ selection_supported: true, selected_sku_id: 'sku-1' }));
    expect(pill().querySelector('.k-mdm-stock-pill-label').textContent).toBe('En stock');

    renderMobileProductDetail(detail, baseSelection({ selection_supported: true, selected_sku_id: 'sku-2' }));
    expect(document.querySelectorAll('#k-modal-stock-pill').length).toBe(1);
    expect(pill().querySelector('.k-mdm-stock-pill-label').textContent).toBe('Plus que 2');
  });
});

describe('b-modal-mobile-product — sélecteur Couleur (M2, spec §5.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  function colorAxis(overrides) {
    return Object.assign({
      key: 'couleur',
      display_name: 'Couleur',
      values: [
        { value: 'Bleu', thumbnail_url: 'https://cdn/bleu.png' },
        { value: 'Rouge', thumbnail_url: 'https://cdn/rouge.png' },
      ],
    }, overrides);
  }

  function skuUnit(overrides) {
    return Object.assign({
      sku_id: 'sku-1',
      sku: 'GOLD-BLU-42',
      option_values: { couleur: 'Bleu' },
      stock_status: 'AVAILABLE',
      available_quantity: 8,
      price_kmf: 5000,
      media_ids: [],
    }, overrides);
  }

  test('SKU avec axe Couleur : la rangée de vignettes est rendue avec une seule source de sélection', () => {
    const detail = baseDetail({
      inventory_model: 'SKU',
      option_axes: [colorAxis()],
      sellable_units: [skuUnit()],
    });
    const selection = baseSelection({
      selection_supported: true,
      selected_options: { couleur: 'Bleu' },
      selected_sku_id: 'sku-1',
      option_states: {
        couleur: [
          { value: 'Bleu', state: 'AVAILABLE' },
          { value: 'Rouge', state: 'AVAILABLE' },
        ],
      },
    });

    renderMobileProductDetail(detail, selection);

    const group = document.querySelector('.k-vg[data-axis-key="couleur"]');
    expect(group).not.toBeNull();

    const skus = group.querySelectorAll('.k-vg-skus .k-sku');
    expect(skus.length).toBe(2);
    // Une seule vignette active à la fois — une seule source de sélection.
    const active = group.querySelectorAll('.k-sku.k-sku--active');
    expect(active.length).toBe(1);
    expect(active[0].querySelector('.k-sku-name').textContent).toBe('Bleu');
    expect(group.querySelector('.k-vg-label-val').textContent).toBe('Bleu');
  });

  test('LEGACY (selection_supported=false) : aucun sélecteur Couleur, même si option_axes est fourni', () => {
    const detail = baseDetail({
      inventory_model: 'LEGACY_VARIANTS',
      option_axes: [colorAxis()],
      sellable_units: [],
    });
    const selection = baseSelection({ selection_supported: false });

    renderMobileProductDetail(detail, selection);

    expect(document.querySelector('.k-vg')).toBeNull();
    expect(document.querySelector('.k-vg-skus')).toBeNull();
  });
});

describe('b-modal-mobile-product — sélecteur Taille (M3, spec §5.6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  function sizeAxis(overrides) {
    return Object.assign({
      key: 'taille',
      display_name: 'Taille',
      values: [
        { value: 'S' },
        { value: 'M' },
        { value: 'L' },
        { value: 'XL' },
      ],
    }, overrides);
  }

  function skuUnit(overrides) {
    return Object.assign({
      sku_id: 'sku-m',
      sku: 'GOLD-M',
      option_values: { taille: 'M' },
      stock_status: 'AVAILABLE',
      available_quantity: 8,
      price_kmf: 5000,
      media_ids: [],
    }, overrides);
  }

  test('SKU avec axe Taille : au moins quatre chips rendus, une seule source de sélection', () => {
    const detail = baseDetail({
      inventory_model: 'SKU',
      option_axes: [sizeAxis()],
      sellable_units: [skuUnit()],
    });
    const selection = baseSelection({
      selection_supported: true,
      selected_options: { taille: 'M' },
      selected_sku_id: 'sku-m',
      option_states: {
        taille: [
          { value: 'S', state: 'AVAILABLE' },
          { value: 'M', state: 'AVAILABLE' },
          { value: 'L', state: 'OUT_OF_STOCK' },
          { value: 'XL', state: 'AVAILABLE' },
        ],
      },
    });

    renderMobileProductDetail(detail, selection);

    const group = document.querySelector('.k-vg[data-axis-key="taille"]');
    expect(group).not.toBeNull();

    const chips = group.querySelectorAll('.k-vg-sizes .k-vp');
    expect(chips.length).toBeGreaterThanOrEqual(4);

    // État sélectionné et indisponible distincts, une seule vignette active.
    const active = group.querySelectorAll('.k-vp.k-vp--active');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toBe('M');

    const unavailable = group.querySelectorAll('.k-vp--out');
    expect(unavailable.length).toBe(1);
    expect(unavailable[0].textContent).toBe('L');
    expect(unavailable[0].className).not.toContain('k-vp--active');

    expect(group.querySelector('.k-vg-label-val').textContent).toBe('M');
  });

  test('LEGACY (selection_supported=false) : aucun sélecteur Taille, même si option_axes est fourni', () => {
    const detail = baseDetail({
      inventory_model: 'LEGACY_VARIANTS',
      option_axes: [sizeAxis()],
      sellable_units: [],
    });
    const selection = baseSelection({ selection_supported: false });

    renderMobileProductDetail(detail, selection);

    expect(document.querySelector('.k-vg')).toBeNull();
    expect(document.querySelector('.k-vg-sizes')).toBeNull();
  });
});

describe('b-modal-mobile-product — carrousel suggestions mobile (M4, spec §5.7)', () => {
  // M4 est un override CSS-only dans modal-mobile-canonical.css :
  // b-modal-suggestions.js produit les nœuds .k-sug-grid / .k-sug-card
  // sans modification, l'event modal:suggestions-rendered est conservé.
  // Ces tests vérifient (1) que b-modal-mobile-product.js ne produit PAS
  // de .k-sug-grid lui-même (ownership clair → b-modal-suggestions.js) et
  // (2) que le conteneur #k-modal-suggestions est bien présent dans le DOM
  // après renderMobileProductDetail pour que b-modal-suggestions.js
  // puisse l'alimenter (non-régression de la composition).

  beforeEach(() => {
    installDom();
    // Ajouter le conteneur suggestions que le shell fournit
    const sugContainer = document.createElement('div');
    sugContainer.className = 'k-modal-suggestions';
    sugContainer.id = 'k-modal-suggestions';
    document.getElementById('k-modal').appendChild(sugContainer);
    state.detail = null;
  });

  test('renderMobileProductDetail ne produit aucun .k-sug-grid (ownership b-modal-suggestions.js)', () => {
    const detail = baseDetail({ inventory_model: 'SKU', sellable_units: [] });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    // b-modal-mobile-product.js ne doit pas injecter de grille de suggestions
    expect(document.querySelector('.k-sug-grid')).toBeNull();
  });

  test('le conteneur #k-modal-suggestions reste intact après renderMobileProductDetail', () => {
    const detail = baseDetail({ inventory_model: 'SKU', sellable_units: [] });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    // b-modal-suggestions.js a besoin de ce nœud pour injecter le rail
    const sugContainer = document.getElementById('k-modal-suggestions');
    expect(sugContainer).not.toBeNull();
    expect(sugContainer.id).toBe('k-modal-suggestions');
  });
});

describe('b-modal-mobile-product — référence produit sous le titre (M5, spec §5.3)', () => {
  // La référence est rendue dans dom.modalSku (#k-modal-sku) par renderIdentity.
  // Spec §5.3 : 11px / 400 / muted, fallback silencieux si propriété absente.
  // CSS vérifié dans modal-mobile-canonical.css (override mobile-only).

  beforeEach(() => {
    installDom();
    state.detail = null;
  });

  test('référence présente dans le contrat : affichée avec préfixe Réf.', () => {
    const detail = baseDetail({
      product: { id: 'p1', name: 'Chaussure Elite Pro', description: '', category: '', reference: 'GOLD-BLU-44' },
      inventory_model: 'SKU',
      sellable_units: [],
    });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    const sku = document.getElementById('k-modal-sku');
    expect(sku.textContent).toBe('Réf. GOLD-BLU-44');
    expect(sku.hidden).toBe(false);
  });

  test('référence absente du contrat : nœud masqué, aucun placeholder vide', () => {
    const detail = baseDetail({
      product: { id: 'p1', name: 'Chaussure Elite Pro', description: '', category: '' },
      inventory_model: 'SKU',
      sellable_units: [],
    });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    const sku = document.getElementById('k-modal-sku');
    expect(sku.hidden).toBe(true);
    expect(sku.textContent.trim()).toBe('');
  });
});

describe('b-modal-mobile-product — série produit meta hero (M6, spec §5.2, contrat v1 product.series)', () => {
  // product.series est un nouveau champ nullable du contrat Product Detail v1
  // (migration 112, Option D). Sur mobile, il remplace la catégorie brute dans
  // dom.modalCat. Fallback silencieux : nœud masqué si series absent.

  beforeEach(() => {
    installDom();
    state.detail = null;
  });

  test('product.series présent : affiché dans dom.modalCat, nœud visible', () => {
    const detail = baseDetail({
      product: {
        id: 'p1', name: 'Chaussure Elite Pro', description: '',
        category: 'sport', series: 'Golden Performance Series',
      },
    });
    renderMobileProductDetail(detail, baseSelection());

    const cat = document.getElementById('k-modal-cat');
    expect(cat.textContent).toBe('Golden Performance Series');
    expect(cat.hidden).toBe(false);
  });

  test('product.series absent (null) : nœud masqué, catégorie brute non affichée', () => {
    const detail = baseDetail({
      product: {
        id: 'p1', name: 'Chaussure Elite Pro', description: '',
        category: 'sport', series: null,
      },
    });
    renderMobileProductDetail(detail, baseSelection());

    const cat = document.getElementById('k-modal-cat');
    expect(cat.hidden).toBe(true);
    expect(cat.textContent.trim()).toBe('');
  });

  test('product.series absent (champ manquant) : même comportement que null', () => {
    const detail = baseDetail({
      product: { id: 'p1', name: 'Robe', description: '', category: 'mode' },
    });
    renderMobileProductDetail(detail, baseSelection());

    const cat = document.getElementById('k-modal-cat');
    expect(cat.hidden).toBe(true);
  });
});
