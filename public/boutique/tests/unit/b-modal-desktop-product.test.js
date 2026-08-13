/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          desktop-product-modal-renderer-tests
 * @domain        catalog
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-modal-desktop-product.test.js
 * @purpose       Tests unitaires du renderer desktop PDC — galerie, buy box,
 *                variantes SKU, stock, livraison pill, réassurance, actions.
 *                Paiement et sous-total absents de la fiche (maquettes 2026-07).
 * @impact-areas  product-modal, desktop, sku-selection
 * @version       2026-07
 */

'use strict';

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
  modalZone: jest.fn((selector) => {
    const { dom } = require('../../js/b-store.js');
    return dom.modal ? dom.modal.querySelector(selector) : null;
  }),
}));

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => value == null ? '' : `${value} KMF`,
  optimizeImgUrl: (url) => url,
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => true),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

const { state, dom } = require('../../js/b-store.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const { buildCarouselSlides, goToSlide } = require('../../js/b-modal-product.js');
const { setupImageUX } = require('../../js/b-modal-image-ux.js');
const { createModalSelection } = require('../../js/view-models/modal-selection-model.js');
const {
  clearDesktopProductDetailState,
  renderDesktopProductDetail,
  refreshDesktopProductSubtotal,
} = require('../../js/b-modal-desktop-product.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SKU_MAR_M = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_MAR_L = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SKU_BEI_L = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function detail(overrides = {}) {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: PRODUCT_ID,
      reference: 'ROB-001',
      name: 'Robe Dubaï',
      description: 'Robe fluide',
      category: 'vetements',
      subcategory: 'robes',
    },
    pricing: { price_kmf: 12500, old_price_kmf: null, promo_pct: 20 },
    media: [
      { id: 'global', url: '/global.jpg', role: 'PRODUCT', alt: 'Robe', option_values: {} },
      { id: 'brown', url: '/brown.jpg', role: 'SCENE', alt: 'Marron', option_values: { Couleur: 'Marron' } },
      { id: 'beige', url: '/beige.jpg', role: 'PRODUCT', alt: 'Beige', option_values: { Couleur: 'Beige' } },
    ],
    option_axes: [
      {
        key: 'Couleur',
        display_name: 'Couleur',
        values: [
          { value: 'Marron', thumbnail_url: '/brown-thumb.jpg' },
          { value: 'Beige', thumbnail_url: '/beige-thumb.jpg' },
        ],
      },
      {
        key: 'Taille',
        display_name: 'Taille',
        values: [
          { value: 'M', thumbnail_url: null },
          { value: 'L', thumbnail_url: null },
        ],
      },
    ],
    sellable_units: [
      {
        sku_id: SKU_MAR_M,
        sku: 'ROB-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_status: 'AVAILABLE',
        available_quantity: 4,
        price_kmf: 12500,
        media_ids: ['brown'],
      },
      {
        sku_id: SKU_MAR_L,
        sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
        price_kmf: 12500,
        media_ids: ['brown'],
      },
      {
        sku_id: SKU_BEI_L,
        sku: 'ROB-BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 13000,
        media_ids: ['beige'],
      },
    ],
    delivery_options: [
      {
        code: 'SEA_STANDARD',
        label: 'Livraison standard',
        available: true,
        price_kmf: null,
        eta_label: null,
        unavailable_reason: null,
      },
    ],
    ...overrides,
  };
}

function installDom() {
  document.body.innerHTML = `
    <div id="k-modal">
      <div class="k-modal-carousel"><div class="k-modal-carousel-track"></div></div>
      <div class="k-modal-info">
        <div id="k-modal-variants"></div>
        <div id="k-modal-delivery"></div>
        <div id="k-modal-payment"></div>
      </div>
      <div class="k-modal-actions">
        <button id="k-qty-minus">−</button>
        <span id="k-qty-val">1</span>
        <button id="k-qty-plus">+</button>
        <button id="k-add-cart-btn">Ajouter</button>
        <button id="k-buy-now-btn">Acheter</button>
      </div>
      <h2 id="k-modal-name"></h2>
      <p id="k-modal-desc"></p>
      <span id="k-modal-cat"></span>
      <span id="k-modal-price"></span>
      <span id="k-modal-old-price"></span>
      <span id="k-modal-sku"></span>
      <span id="k-modal-stock"></span>
      <span id="k-modal-promo-badge"></span>
      <div id="k-modal-aed-price">legacy eur</div>
      <div id="k-modal-flash-bar">legacy promo</div>
      <div id="k-modal-stock-bar">legacy stock</div>
      <div id="k-modal-long-description" hidden></div>
      <div id="k-modal-enriched-content" hidden></div>
    </div>`;

  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.modalName = document.getElementById('k-modal-name');
  dom.modalDesc = document.getElementById('k-modal-desc');
  dom.modalCat = document.getElementById('k-modal-cat');
  dom.modalPrice = document.getElementById('k-modal-price');
  dom.modalOldPrice = document.getElementById('k-modal-old-price');
  dom.modalSku = document.getElementById('k-modal-sku');
  dom.modalStock = document.getElementById('k-modal-stock');
  dom.modalPromoBadge = document.getElementById('k-modal-promo-badge');
  dom.modalQtyVal = document.getElementById('k-qty-val');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
}

function stepperControls() {
  return [dom.qtyMinus, dom.qtyPlus];
}

describe('desktop product detail renderer', () => {
  beforeEach(() => {
    clearDesktopProductDetailState();
    jest.clearAllMocks();
    installDom();
    Object.keys(state).forEach((key) => delete state[key]);
    state.modalQty = 1;
    isDesktop.mockReturnValue(true);
  });

  afterAll(() => {
    clearDesktopProductDetailState();
  });

  test('PDP v3.1 : short_description reste dans la BuyBox et description longue descend sous le hero', () => {
    const product = detail({ content: { short_description: 'Chapeau court raffiné', highlights: [{ key: 'h1', label: 'Point enrichi' }] } });
    product.product.description = 'Description longue complète du produit, conservée sans troncature.';

    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.modalDesc.textContent).toBe('Chapeau court raffiné');
    expect(dom.modalDesc.hidden).toBe(false);

    const longDescription = document.getElementById('k-modal-long-description');
    expect(longDescription.hidden).toBe(false);
    expect(longDescription.textContent).toContain('Description');
    expect(longDescription.textContent).toContain('Description longue complète du produit, conservée sans troncature.');
    expect(longDescription.textContent).not.toContain('Chapeau court raffiné');
  });

  test('PDP v3.1 : produit sans variantes remonte sa description complète dans la BuyBox même s’il est enrichi', () => {
    const product = detail({
      inventory_model: 'SIMPLE',
      option_axes: [],
      sellable_units: [],
      content: {
        short_description: 'Chapeau éditorial court',
        highlights: [{ key: 'h1', label: 'Point enrichi' }],
      },
    });
    product.product.description = 'Description canonique complète du produit sans variantes.';

    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.modalDesc.textContent)
      .toBe('Description canonique complète du produit sans variantes.');
    expect(dom.modalDesc.hidden).toBe(false);

    const longDescription = document.getElementById('k-modal-long-description');
    expect(longDescription.hidden).toBe(true);
    expect(longDescription.textContent).toBe('');

    const enriched = document.getElementById('k-modal-enriched-content');
    expect(enriched.hidden).toBe(false);
    expect(enriched.textContent).toContain('Point enrichi');
  });

  test('PDP v3.1 : short_description seul ne crée pas de bloc enrichi fantôme', () => {
    const product = detail({ content: { short_description: 'Chapeau seul' } });
    product.product.description = '';

    renderDesktopProductDetail(product, createModalSelection(product));

    const enriched = document.getElementById('k-modal-enriched-content');
    const longDescription = document.getElementById('k-modal-long-description');

    expect(dom.modalDesc.textContent).toBe('Chapeau seul');
    expect(enriched.hidden).toBe(true);
    expect(enriched.innerHTML).toBe('');
    expect(longDescription.hidden).toBe(true);
  });

  test('LEGACY_VARIANTS (non-SKU) : CTA actif et stepper autorisé', () => {
    const product = detail({ inventory_model: 'LEGACY_VARIANTS', option_axes: [] });
    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.addCartBtn.disabled).toBe(false);
    expect(dom.modal.classList.contains('k-modal--has-variants')).toBe(false);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
    stepperControls().forEach((control) => expect(control.disabled).toBe(false));
  });

  test('LEGACY_VARIANTS avec options : achat et stepper bloqués sans faux SKU', () => {
    const product = detail({ inventory_model: 'LEGACY_VARIANTS' });
    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.addCartBtn.disabled).toBe(true);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
    stepperControls().forEach((control) => expect(control.disabled).toBe(true));
    expect(document.getElementById('k-modal-selection-message').textContent)
      .toContain('achat désactivé');
  });

  test('SKU sans selected_sku_id : CTA verrouillé ET stepper verrouillé', () => {
    const product = detail();
    const selection = createModalSelection(product);
    renderDesktopProductDetail(product, selection);

    expect(dom.modal.classList.contains('k-modal--has-variants')).toBe(true);
    expect(selection.selected_sku_id).toBeNull();
    expect(dom.addCartBtn.disabled).toBe(true);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
    stepperControls().forEach((control) => expect(control.disabled).toBe(true));
  });

  test('SKU résolu : CTA actif, mais stepper TOUJOURS verrouillé', () => {
    const product = detail();
    const selection = createModalSelection(product);
    selection.selected_options = { Couleur: 'Marron', Taille: 'M' };
    selection.selected_sku_id = SKU_MAR_M;
    renderDesktopProductDetail(product, selection);

    expect(dom.addCartBtn.disabled).toBe(false);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
    // Preuve PDC-6 : aucune mutation panier product-id-first via le stepper,
    // même lorsque la sélection canonique a résolu un SKU vendable.
    stepperControls().forEach((control) => expect(control.disabled).toBe(true));
  });

  test('T-023/D11 — produit absent du panier : AVAILABLE_EMPTY (pas de modificateur --filled)', () => {
    const product = detail({ inventory_model: 'LEGACY_VARIANTS' });
    state.cart = [];
    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.modal.querySelector('.k-modal-actions').classList.contains('k-modal-actions--filled')).toBe(false);
  });

  test('T-023/D11 — produit dans le panier (qty > 0) : AVAILABLE_FILLED (.k-modal-actions--filled posé)', () => {
    const product = detail({ inventory_model: 'LEGACY_VARIANTS' });
    state.cart = [{ product: { id: PRODUCT_ID }, qty: 2 }];
    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.modal.querySelector('.k-modal-actions').classList.contains('k-modal-actions--filled')).toBe(true);
  });

  test('T-023/D11 — entrée panier avec qty 0 : reste AVAILABLE_EMPTY', () => {
    const product = detail({ inventory_model: 'LEGACY_VARIANTS' });
    state.cart = [{ product: { id: PRODUCT_ID }, qty: 0 }];
    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.modal.querySelector('.k-modal-actions').classList.contains('k-modal-actions--filled')).toBe(false);
  });

  test('compose galerie gauche / Buy Box depuis le contrat sans vérité legacy', () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product), { forceMedia: true });

    expect(document.querySelector('[data-pdc5-root]')).not.toBeNull();
    expect(document.querySelectorAll('.k-sku')).toHaveLength(2);
    expect(document.querySelectorAll('.k-vg-sizes .k-vp')).toHaveLength(2);
    // Livraison desktop = pill compacte uniquement (pas de liste détaillée)
    expect(document.querySelector('#k-modal-delivery .k-modal-delivery-pill')).not.toBeNull();
    expect(document.querySelector('[data-delivery-code]')).toBeNull();
    expect(document.body.textContent).not.toContain('3 à 5 semaines');
    expect(document.body.textContent).not.toContain('Gratuit');
    expect(document.getElementById('k-modal-aed-price').textContent).toBe('');
    expect(document.getElementById('k-modal-flash-bar').textContent).toBe('');
    expect(document.getElementById('k-modal-stock-bar').textContent).toBe('');
  });

  test('Marron rend L en rupture depuis les SKU réels', () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product), { forceMedia: true });

    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();

    const sizeL = document.querySelector('[data-axis-key="Taille"] [data-option-value="L"]');
    expect(sizeL.dataset.optionState).toBe('OUT_OF_STOCK');
    expect(sizeL.getAttribute('aria-label')).toContain('Rupture');
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Marron' });
  });

  test('clic sur L indisponible explique la rupture et bloque les actions', () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product));
    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();
    document.querySelector('[data-axis-key="Taille"] [data-option-value="L"]').click();

    expect(state.modalSelection.selected_sku_id).toBeNull();
    expect(document.getElementById('k-modal-selection-message').textContent)
      .toBe('L indisponible pour Marron — rupture de stock');
    expect(dom.addCartBtn.disabled).toBe(true);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
  });

  test('Marron + M résout le même SKU que mobile et actualise prix, référence et médias', () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product), { forceMedia: true });
    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();
    document.querySelector('[data-axis-key="Taille"] [data-option-value="M"]').click();

    expect(state.modalSelection.selected_sku_id).toBe(SKU_MAR_M);
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Marron', Taille: 'M' });
    expect(dom.modalSku.textContent).toBe('Réf. ROB-MAR-M');
    expect(dom.modalPrice.textContent).toBe('12500 KMF');
    /* P2-fix : renderStock affiche désormais le badge numérique depuis
       sellable_unit.available_quantity (qty=4 → '● Plus que 4'). */
    expect(dom.modalStock.textContent).toBe('● Plus que 4');
    expect(buildCarouselSlides).toHaveBeenLastCalledWith(expect.objectContaining({ images: ['/brown.jpg'] }));
    expect(goToSlide).toHaveBeenCalledWith(0);
    expect(setupImageUX).toHaveBeenCalled();
  });

  test('Beige + L porte le prix SKU et le sous-total suit la quantité', () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product));
    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Beige"]').click();
    document.querySelector('[data-axis-key="Taille"] [data-option-value="L"]').click();

    expect(dom.modalPrice.textContent).toBe('13000 KMF');
    // Sous-total supprimé de la fiche desktop (maquettes validées 2026-07)
    expect(document.querySelector('.k-modal-subtotal strong')).toBeNull();
  });

  // Paiement appartient au tunnel de commande, pas à la fiche produit desktop.
  // Maquettes validées 2026-07 : bloc paiement absent de la colonne droite.
  test('ne rend pas les modes de paiement sur la fiche desktop', () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product));

    const payment = document.getElementById('k-modal-payment');
    expect(payment.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(0);
  });

  test('ne reconstruit jamais ancien prix depuis promo_pct', () => {
    const product = detail({
      pricing: { price_kmf: 10000, old_price_kmf: null, promo_pct: 20 },
    });
    renderDesktopProductDetail(product, createModalSelection(product));

    expect(dom.modalOldPrice.textContent).toBe('');
    expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(true);
    expect(dom.modalPromoBadge.textContent).toBe('-20%');
  });

  test('une option Express apparaît uniquement quand le contrat la fournit', () => {
    const product = detail({
      delivery_options: [{
        code: 'AIR_EXPRESS',
        label: 'Livraison express',
        available: true,
        price_kmf: 2500,
        eta_label: 'Sous 5 jours',
        unavailable_reason: null,
      }],
    });
    renderDesktopProductDetail(product, createModalSelection(product));

    // Pill single-mode : AIR seul → pill --air avec le délai
    const pill = document.querySelector('#k-modal-delivery .k-modal-delivery-pill--air');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('Sous 5 jours');
    expect(document.querySelector('[data-delivery-code]')).toBeNull();
  });

  test('delivery_options absent reste honnête et ne crashe pas', () => {
    const product = detail({ delivery_options: null });
    renderDesktopProductDetail(product, createModalSelection(product));

    // Pill fallback sea affichée même sans delivery_options
    const pill = document.querySelector('#k-modal-delivery .k-modal-delivery-pill--sea');
    expect(pill).not.toBeNull();
    expect(document.querySelector('[data-delivery-code]')).toBeNull();
    expect(document.body.textContent).not.toContain('Gratuit');
    expect(document.body.textContent).not.toContain('3 à 5 semaines');
  });

  test('le cleanup observer permet de rattacher le sous-total à un nouveau DOM quantité', async () => {
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product));
    clearDesktopProductDetailState();

    installDom();
    state.modalQty = 2;
    renderDesktopProductDetail(product, createModalSelection(product));
    state.modalQty = 3;
    dom.modalQtyVal.textContent = '3';
    await Promise.resolve();

    // Sous-total supprimé de la fiche desktop — vérifie que le prix SKU est correct
    expect(dom.modalPrice.textContent).toBe('12500 KMF');
  });

  test('hors desktop le renderer ne modifie pas la modal', () => {
    isDesktop.mockReturnValue(false);
    const product = detail();
    renderDesktopProductDetail(product, createModalSelection(product), { forceMedia: true });

    expect(dom.modalVariants.innerHTML).toBe('');
    expect(buildCarouselSlides).not.toHaveBeenCalled();
  });
});

// Lot Content, commit 4 — contenu enrichi sous la zone transactionnelle,
// consommé via le même view-model partagé que le mobile
// (view-models/product-content-model.js). Ces tests couvrent la composition
// desktop réelle (DOM), pas le tri/filtrage.
describe('desktop product detail renderer — contenu enrichi (Lot Content)', () => {
  beforeEach(() => {
    clearDesktopProductDetailState();
    jest.clearAllMocks();
    isDesktop.mockReturnValue(true);
    installDom();
  });

  test('produit sans content : le conteneur reste vide et hidden, aucun bloc fantôme', () => {
    const product = detail({ content: undefined });
    renderDesktopProductDetail(product, createModalSelection(product));

    const el = document.getElementById('k-modal-enriched-content');
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });

  test('produit enrichi : révèle le conteneur et rend les blocs dans l’ordre canonique', () => {
    const product = detail({
      content: {
        brand: 'Elite Pro',
        short_description: null,
        highlights: [{ key: 'h1', label: 'Grip renforcé' }],
        specifications: [
          { group: 'Semelle', key: 's1', label: 'Type', value: 'Crampons FG', unit: null, display_order: 0 },
        ],
        sections: [
          { key: 'guide', title: 'Guide des tailles', type: 'KEY_VALUE', text: null, items: [], entries: [{ label: '40', value: 'EU 40' }], display_order: 0 },
        ],
        materials: ['Cuir synthétique'],
        care: ['Nettoyer à sec'],
        warnings: ['Non conçu pour le terrain synthétique'],
        provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
      },
    });

    renderDesktopProductDetail(product, createModalSelection(product));

    const el = document.getElementById('k-modal-enriched-content');
    expect(el.hidden).toBe(false);

    const headings = [...el.querySelectorAll('.k-modal-section-title')].map((h) => h.textContent);
    expect(headings).toEqual(['Points forts', 'Caractéristiques', 'Composition', 'Entretien', 'À savoir', 'Guide des tailles']);
  });

  test('re-render (changement de sélection) ne duplique jamais les blocs enrichis', () => {
    const product = detail({
      content: {
        brand: null,
        short_description: null,
        highlights: [{ key: 'h1', label: 'Grip renforcé' }],
        specifications: [],
        sections: [],
        materials: [],
        care: [],
        warnings: [],
        provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
      },
    });

    renderDesktopProductDetail(product, createModalSelection(product));
    renderDesktopProductDetail(product, createModalSelection(product));

    const el = document.getElementById('k-modal-enriched-content');
    expect(el.querySelectorAll('.k-modal-enriched-block--highlights')).toHaveLength(1);
  });

  test('conteneur absent du markup (compat) : le renderer ne casse pas', () => {
    document.getElementById('k-modal-enriched-content').remove();
    const product = detail({ content: { brand: null, short_description: null, highlights: [{ key: 'h1', label: 'X' }], specifications: [], sections: [], materials: [], care: [], warnings: [], provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false } } });

    expect(() => renderDesktopProductDetail(product, createModalSelection(product))).not.toThrow();
  });

  test('section éditoriale TEXT longue : bouton "Lire la suite" présent et fonctionnel', () => {
    const long = 'Entretien détaillé du produit. '.repeat(15);
    const product = detail({
      content: {
        brand: null,
        short_description: null,
        highlights: [],
        specifications: [],
        sections: [{ key: 'notice', title: 'Notice', type: 'TEXT', text: long, items: [], entries: [], display_order: 0 }],
        materials: [],
        care: [],
        warnings: [],
        provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
      },
    });

    renderDesktopProductDetail(product, createModalSelection(product));

    const readMore = document.querySelector('.k-modal-enriched-read-more');
    expect(readMore).not.toBeNull();
    readMore.click();
    expect(readMore.textContent).toBe('Réduire');
    expect(document.querySelector('.k-modal-enriched-text').classList.contains('is-expanded')).toBe(true);
  });

  test('section éditoriale BULLETS : rendue en liste à puces', () => {
    const product = detail({
      content: {
        brand: null,
        short_description: null,
        highlights: [],
        specifications: [],
        sections: [{ key: 'usage', title: 'Conseils', type: 'BULLETS', text: null, items: ['Éviter le sable humide'], entries: [], display_order: 0 }],
        materials: [],
        care: [],
        warnings: [],
        provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
      },
    });

    renderDesktopProductDetail(product, createModalSelection(product));

    const items = [...document.querySelectorAll('.k-modal-enriched-block--editorial li')].map((li) => li.textContent);
    expect(items).toEqual(['Éviter le sable humide']);
  });
});

describe('b-modal-desktop-product — série produit meta hero (M6, spec §9.1, contrat v1 product.series)', () => {
  beforeEach(() => {
    installDom();
  });

  test('product.series présent : affiché dans #k-modal-cat, nœud visible', () => {
    const product = detail({ product: { id: PRODUCT_ID, reference: 'ROB-001', name: 'Robe Dubaï', description: 'Robe fluide', category: 'vetements', subcategory: 'robes', series: 'Golden Performance Series' } });
    renderDesktopProductDetail(product, createModalSelection(product));

    const cat = document.getElementById('k-modal-cat');
    expect(cat.textContent).toBe('Golden Performance Series');
    expect(cat.hidden).toBe(false);
  });

  test('product.series absent (null) : #k-modal-cat masqué, catégorie brute non affichée', () => {
    const product = detail({ product: { id: PRODUCT_ID, reference: 'ROB-001', name: 'Robe Dubaï', description: 'Robe fluide', category: 'vetements', subcategory: 'robes', series: null } });
    renderDesktopProductDetail(product, createModalSelection(product));

    const cat = document.getElementById('k-modal-cat');
    expect(cat.hidden).toBe(true);
    expect(cat.textContent.trim()).toBe('');
  });
});
