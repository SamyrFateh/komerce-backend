'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
  setQty: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { addToCart, quickAdd, quickRemove, setQty } = require('../../js/b-cart.js');
const {
  _syncModalQtyUI,
  setupModalCart,
  resetAddCartButtonState,
  _modalCartTestApi,
} = require('../../js/b-modal-cart.js');

const { currentModalCartItem, normalizedCombo } = _modalCartTestApi;

function resetDom() {
  document.body.innerHTML = '';
  const modal = document.createElement('div');
  modal.id = 'k-modal';
  const actions = document.createElement('div');
  actions.className = 'k-modal-actions';

  dom.modalQtyVal = document.createElement('span');
  dom.addCartBtn = document.createElement('button');
  dom.qtyMinus = document.createElement('button');
  dom.qtyPlus = document.createElement('button');

  actions.append(dom.qtyMinus, dom.modalQtyVal, dom.qtyPlus, dom.addCartBtn);
  modal.appendChild(actions);
  document.body.appendChild(modal);
  return { modal, actions };
}

function setSkuSelection(skuId = 'sku-red', options = { color: 'Rouge', size: 'L' }) {
  state.modalProduct = { id: 42 };
  state.modalProductDetail = {
    inventory_model: 'SKU',
    sellable_units: skuId
      ? [{ sku_id: skuId, stock_status: 'AVAILABLE' }]
      : [],
  };
  state.modalSelection = {
    selected_sku_id: skuId,
    selected_options: options,
  };
}

describe('b-modal-cart', () => {
  let modal;
  let actions;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ modal, actions } = resetDom());
    state.modalProduct = null;
    state.modalProductDetail = null;
    state.modalSelection = null;
    state.modalVariantCombo = {};
    state.modalQty = 0;
    state.cart = [];
  });

  describe('helpers de résolution ligne', () => {
    test('normalizedCombo est stable, trié et défensif', () => {
      expect(normalizedCombo(null)).toBe('');
      expect(normalizedCombo('Rouge')).toBe('');
      expect(normalizedCombo({})).toBe('');
      expect(normalizedCombo({ size: 'L', color: 'Rouge', qty: 2 })).toBe('color:Rouge|qty:2|size:L');
    });

    test('sans produit ou sans panier : aucune ligne courante', () => {
      expect(currentModalCartItem()).toBeNull();
      state.modalProduct = { id: 42 };
      state.cart = undefined;
      expect(currentModalCartItem()).toBeNull();
    });

    test('legacy résout product.id, puis item.id, et ignore les autres produits', () => {
      state.modalProduct = { id: 42 };
      state.cart = [
        {},
        { product: { id: 7 }, qty: 9 },
        { id: '42', qty: 2 },
        { product: { id: 42 }, qty: 3 },
      ];
      expect(currentModalCartItem()).toEqual({ id: '42', qty: 2 });

      state.cart = [{ product: { id: 7 }, qty: 9 }];
      expect(currentModalCartItem()).toBeNull();
    });

    test.each([
      ['sku_id top-level', { sku_id: 'sku-red', product: { id: 42 } }],
      ['product.sku_id', { product: { id: 42, sku_id: 'sku-red' } }],
      ['product.selected_sku_id', { product: { id: 42, selected_sku_id: 'sku-red' } }],
    ])('SKU résout %s', (_label, item) => {
      setSkuSelection();
      state.cart = [{ ...item, qty: 2 }];
      expect(currentModalCartItem().qty).toBe(2);
    });

    test('SKU sans selected_sku_id ou sans options exploitables : aucune ligne', () => {
      setSkuSelection(null, null);
      state.cart = [{ product: { id: 42, sku_id: 'sku-red' }, qty: 2 }];
      expect(currentModalCartItem()).toBeNull();

      setSkuSelection('sku-red', null);
      state.cart = [{ product: { id: 42, sku_id: 'other' }, qty: 2 }];
      expect(currentModalCartItem()).toBeNull();
    });

    test('SKU non trouvé par id : fallback variant_combo canonique', () => {
      setSkuSelection('sku-red', { size: 'L', color: 'Rouge' });
      state.cart = [
        { product: { id: 42 }, variant_combo: { color: 'Rouge', size: 'L' }, qty: 4 },
      ];
      expect(currentModalCartItem().qty).toBe(4);

      state.cart = [
        { product: { id: 42 }, variant_combo: { color: 'Bleu', size: 'L' }, qty: 4 },
        { product: { id: 42 }, variant_combo: null, qty: 5 },
      ];
      expect(currentModalCartItem()).toBeNull();
    });
  });

  describe('resetAddCartButtonState', () => {
    test('DOM absent : no-op', () => {
      dom.addCartBtn = null;
      expect(() => resetAddCartButtonState()).not.toThrow();
    });

    test('restaure le bouton et purge les états transitoires', () => {
      const customClick = jest.fn();
      dom.addCartBtn.disabled = true;
      dom.addCartBtn.onclick = customClick;
      dom.addCartBtn.className = 'added in-cart confirmed keep-me';

      resetAddCartButtonState();

      expect(dom.addCartBtn.disabled).toBe(false);
      expect(dom.addCartBtn.onclick).toBeNull();
      expect(dom.addCartBtn.classList.contains('added')).toBe(false);
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.classList.contains('confirmed')).toBe(false);
      expect(dom.addCartBtn.classList.contains('keep-me')).toBe(true);
    });
  });

  describe('_syncModalQtyUI', () => {
    test('aucun produit ouvert : no-op', () => {
      expect(() => _syncModalQtyUI()).not.toThrow();
      expect(dom.modalQtyVal.textContent).toBe('');
    });

    test('avant chargement du détail : bouton visible, jamais de stepper principal', () => {
      state.modalProduct = { id: 42 };
      state.cart = [{ product: { id: 42 }, qty: 3 }];

      _syncModalQtyUI();

      expect(state.modalQty).toBe(3);
      expect(actions.dataset.inventoryModel).toBe('UNKNOWN');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(false);
      expect(dom.addCartBtn.textContent).toContain('Dans le panier (3)');
      expect(dom.qtyMinus.disabled).toBe(true);
      expect(dom.qtyPlus.disabled).toBe(true);
    });

    test('legacy absent : qty 1, bouton Ajouter, stepper autorisé', () => {
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'LEGACY_VARIANTS' };
      dom.qtyMinus.disabled = true;
      dom.qtyPlus.disabled = true;
      _syncModalQtyUI();

      expect(state.modalQty).toBe(1);
      expect(dom.modalQtyVal.textContent).toBe('1');
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.textContent).toContain('Ajouter');
      expect(dom.addCartBtn.querySelector('img').src).toContain('/images/panier_tresse.png');
      expect(actions.dataset.inventoryModel).toBe('LEGACY_VARIANTS');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(false);
      expect(dom.qtyMinus.disabled).toBe(true);
      expect(dom.qtyPlus.disabled).toBe(true);
    });

    test('legacy présent : reflète qty et active le stepper filled', () => {
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'LEGACY_VARIANTS' };
      state.cart = [{ product: { id: 42 }, qty: 3 }];
      _syncModalQtyUI();

      expect(state.modalQty).toBe(3);
      expect(dom.addCartBtn.textContent).toContain('Dans le panier (3)');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(true);
    });

    test('SKU exact : quantité de ligne et stepper exact activés', () => {
      setSkuSelection();
      state.cart = [
        { product: { id: 42, sku_id: 'sku-blue' }, variant_combo: { color: 'Bleu', size: 'L' }, qty: 5 },
        { product: { id: 42, sku_id: 'sku-red' }, variant_combo: { color: 'Rouge', size: 'L' }, qty: 2 },
      ];

      _syncModalQtyUI();

      expect(state.modalQty).toBe(2);
      expect(dom.modalQtyVal.textContent).toBe('2');
      expect(dom.addCartBtn.textContent).toContain('Dans le panier (2)');
      expect(actions.dataset.inventoryModel).toBe('SKU');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(true);
      expect(dom.qtyMinus.disabled).toBe(false);
      expect(dom.qtyPlus.disabled).toBe(false);
    });

    test('desktop : un SKU déjà présent utilise le libellé compact Ajouté', () => {
      const originalMatchMedia = window.matchMedia;
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: jest.fn(() => ({ matches: true })),
      });

      try {
        setSkuSelection();
        state.cart = [
          { product: { id: 42, sku_id: 'sku-red' }, variant_combo: { color: 'Rouge', size: 'L' }, qty: 2 },
        ];

        _syncModalQtyUI();

        expect(dom.addCartBtn.textContent).toBe('✓ Ajouté');
      } finally {
        Object.defineProperty(window, 'matchMedia', {
          configurable: true,
          writable: true,
          value: originalMatchMedia,
        });
      }
    });
    test('SKU autre variante seulement : conserve Ajouter visible', () => {
      setSkuSelection();
      state.cart = [
        { product: { id: 42, sku_id: 'sku-blue' }, variant_combo: { color: 'Bleu', size: 'L' }, qty: 5 },
      ];
      _syncModalQtyUI();

      expect(state.modalQty).toBe(1);
      expect(dom.addCartBtn.classList.contains('in-cart')).toBe(false);
      expect(dom.addCartBtn.textContent).toContain('Ajouter');
    });

    test('fonctionne sans compteur, actions, bouton Ajouter ou un des contrôles', () => {
      state.modalProduct = { id: 1 };
      state.modalProductDetail = { inventory_model: 'LEGACY_VARIANTS' };
      dom.modalQtyVal = null;
      dom.addCartBtn.remove();
      dom.addCartBtn = null;
      dom.qtyMinus = null;
      expect(() => _syncModalQtyUI()).not.toThrow();
      expect(dom.qtyPlus.disabled).toBe(true);
    });

    test('bouton Ajouter détaché : actions absent mais projection du bouton conservée', () => {
      state.modalProduct = { id: 1 };
      dom.addCartBtn.remove();
      _syncModalQtyUI();
      expect(dom.addCartBtn.textContent).toContain('Ajouter');
    });
  });

  describe('setupModalCart et délégation sélection', () => {
    test('câble les listeners sans throw et reste idempotent pour les délégations', () => {
      expect(() => setupModalCart()).not.toThrow();
      expect(() => setupModalCart()).not.toThrow();
    });

    test('modal:detail-ready rejoue la synchronisation', () => {
      setupModalCart();
      state.modalProduct = { id: 42 };
      state.modalProductDetail = { inventory_model: 'LEGACY_VARIANTS' };
      state.cart = [{ product: { id: 42 }, qty: 2 }];
      dom.addCartBtn.textContent = 'sentinel';

      bus.emit('modal:detail-ready');

      expect(dom.addCartBtn.textContent).toContain('Dans le panier (2)');
      expect(actions.classList.contains('k-modal-actions--filled')).toBe(true);
    });

    test('qtyPlus appelle quickAdd puis resynchronise', () => {
      setupModalCart();
      state.modalProduct = { id: 11 };
      dom.qtyPlus.click();
      expect(quickAdd).toHaveBeenCalledWith('11', dom.qtyPlus);
      expect(dom.modalQtyVal.textContent).toBe('1');
    });

    test('qtyMinus appelle quickRemove puis resynchronise', () => {
      setupModalCart();
      state.modalProduct = { id: 22 };
      dom.qtyMinus.click();
      expect(quickRemove).toHaveBeenCalledWith('22', dom.qtyMinus);
      expect(dom.modalQtyVal.textContent).toBe('1');
    });

    test('stepper SKU mute uniquement la ligne exacte sélectionnée', () => {
      setupModalCart();
      setSkuSelection('sku-red', { color: 'Rouge', size: 'L' });
      const selectedLine = {
        product: { id: 42, sku_id: 'sku-red' },
        variant_combo: { color: 'Rouge', size: 'L' },
        qty: 2,
      };
      state.cart = [
        selectedLine,
        {
          product: { id: 42, sku_id: 'sku-blue' },
          variant_combo: { color: 'Bleu', size: 'L' },
          qty: 7,
        },
      ];
      _syncModalQtyUI();

      dom.qtyPlus.click();
      expect(setQty).toHaveBeenCalledWith('42', 3, selectedLine);
      expect(quickAdd).not.toHaveBeenCalled();

      dom.qtyMinus.click();
      expect(setQty).toHaveBeenCalledWith('42', 1, selectedLine);
      expect(quickRemove).not.toHaveBeenCalled();
    });

    test('stepper sans produit ne mute rien', () => {
      setupModalCart();
      dom.qtyPlus.click();
      dom.qtyMinus.click();
      expect(quickAdd).not.toHaveBeenCalled();
      expect(quickRemove).not.toHaveBeenCalled();
    });

    test('réconcilie après changement direct de sélection SKU', async () => {
      setupModalCart();
      setSkuSelection('sku-blue', { color: 'Bleu' });
      state.cart = [
        { product: { id: 42, sku_id: 'sku-blue' }, variant_combo: { color: 'Bleu' }, qty: 5 },
        { product: { id: 42, sku_id: 'sku-red' }, variant_combo: { color: 'Rouge' }, qty: 2 },
      ];
      _syncModalQtyUI();
      expect(dom.addCartBtn.textContent).toContain('Dans le panier (5)');

      const option = document.createElement('button');
      option.dataset.optionValue = 'Rouge';
      option.addEventListener('click', () => {
        state.modalSelection = {
          selected_sku_id: 'sku-red',
          selected_options: { color: 'Rouge' },
        };
      });
      modal.appendChild(option);
      option.click();
      await Promise.resolve();

      expect(dom.addCartBtn.textContent).toContain('Dans le panier (2)');
      expect(state.modalQty).toBe(2);
    });

    test('ignore clic non-option, option hors modal et cible sans closest', async () => {
      setupModalCart();
      setSkuSelection();
      state.cart = [{ product: { id: 42, sku_id: 'sku-red' }, qty: 2 }];
      dom.addCartBtn.textContent = 'sentinel';

      document.body.click();
      const outside = document.createElement('button');
      outside.dataset.optionValue = 'Rouge';
      document.body.appendChild(outside);
      outside.click();
      document.dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();

      expect(dom.addCartBtn.textContent).toBe('sentinel');
    });

    test('Ajouter legacy transmet le produit original', () => {
      setupModalCart();
      const product = { id: 33 };
      state.modalProduct = product;
      state.modalProductDetail = { inventory_model: 'LEGACY_VARIANTS', option_axes: [] };
      dom.addCartBtn.click();
      expect(addToCart).toHaveBeenCalledWith(product, 1, dom.addCartBtn, { requested_transport_rail: null });
    });

    test('Ajouter legacy avec variantes sans SKU : fail-closed', () => {
      setupModalCart();
      state.modalProduct = { id: 33, has_variants: true };
      state.modalProductDetail = {
        inventory_model: 'LEGACY_VARIANTS',
        option_axes: [{ key: 'Pointure' }],
      };

      dom.addCartBtn.click();

      expect(addToCart).not.toHaveBeenCalled();
    });

    test('Ajouter SKU transmet le snapshot sélectionné', () => {
      setupModalCart();
      state.modalProduct = { id: 33, name: 'Thermos', price_kmf: 5000, image_url: '/base.jpg' };
      state.modalProductDetail = {
        inventory_model: 'SKU',
        pricing: { price_kmf: 5500 },
        sellable_units: [{ sku_id: 'sku-red', sku: 'THERMOS-RED', price_kmf: 7200 }],
      };
      state.modalSelection = {
        selected_sku_id: 'sku-red',
        selected_options: { color: 'Rouge' },
        selected_media: [{ url: '/red.jpg' }],
      };

      dom.addCartBtn.click();

      expect(addToCart).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 33,
          price_kmf: 7200,
          sku_id: 'sku-red',
          sku: 'THERMOS-RED',
          image_url: '/red.jpg',
        }),
        1,
        dom.addCartBtn,
        { requested_transport_rail: null }
      );
    });

    test.each([
      ['sans produit', () => {}],
      ['désactivé', () => { state.modalProduct = { id: 1 }; dom.addCartBtn.disabled = true; }],
      ['confirmed', () => { state.modalProduct = { id: 1 }; dom.addCartBtn.classList.add('confirmed'); }],
    ])('Ajouter %s : no-op', (_label, arrange) => {
      setupModalCart();
      arrange();
      dom.addCartBtn.click();
      expect(addToCart).not.toHaveBeenCalled();
    });
  });
});
