import {
  OPTION_STATE,
  createModalSelection,
  selectModalOption,
} from '../../js/view-models/modal-selection-model.js';

const SKU_MAR_M = '22222222-2222-4222-8222-222222222222';

function detail(overrides = {}) {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reference: 'ROB-001',
      name: 'Robe Dubaï',
      description: null,
      category: 'vetements',
      subcategory: 'robes',
    },
    pricing: { price_kmf: 12500, old_price_kmf: null, promo_pct: null },
    media: [
      { id: 'global-main', url: '/main.jpg', role: 'PRODUCT', alt: 'Robe', option_values: {} },
      { id: 'brown-scene', url: '/brown.jpg', role: 'PRODUCT', alt: 'Marron', option_values: { Couleur: 'Marron' } },
      { id: 'brown-m-detail', url: '/brown-m.jpg', role: 'DETAIL', alt: 'Marron M', option_values: { Couleur: 'Marron', Taille: 'M' } },
      { id: 'beige-product', url: '/beige.jpg', role: 'PRODUCT', alt: 'Beige', option_values: { Couleur: 'Beige' } },
    ],
    option_axes: [
      {
        key: 'Couleur',
        display_name: 'Couleur',
        values: [
          { value: 'Marron', thumbnail_url: '/brown.jpg' },
          { value: 'Beige', thumbnail_url: '/beige.jpg' },
          { value: 'Vert', thumbnail_url: '/green.jpg' },
        ],
      },
      {
        key: 'Taille',
        display_name: 'Taille',
        values: [
          { value: 'S', thumbnail_url: null },
          { value: 'M', thumbnail_url: null },
          { value: 'L', thumbnail_url: null },
        ],
      },
    ],
    sellable_units: [
      {
        sku_id: '11111111-1111-4111-8111-111111111111',
        sku: 'ROB-MAR-S',
        option_values: { Couleur: 'Marron', Taille: 'S' },
        stock_status: 'AVAILABLE',
        available_quantity: 3,
        price_kmf: 12500,
        media_ids: ['brown-scene'],
      },
      {
        sku_id: SKU_MAR_M,
        sku: 'ROB-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_status: 'AVAILABLE',
        available_quantity: 8,
        price_kmf: 12500,
        media_ids: ['brown-scene', 'brown-m-detail'],
      },
      {
        sku_id: '33333333-3333-4333-8333-333333333333',
        sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
        price_kmf: 12500,
        media_ids: ['brown-scene'],
      },
      {
        sku_id: '44444444-4444-4444-8444-444444444444',
        sku: 'ROB-BEI-M',
        option_values: { Couleur: 'Beige', Taille: 'M' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 12500,
        media_ids: ['beige-product'],
      },
      {
        sku_id: '55555555-5555-4555-8555-555555555555',
        sku: 'ROB-BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_status: 'AVAILABLE',
        available_quantity: 1,
        price_kmf: 12500,
        media_ids: ['beige-product'],
      },
    ],
    delivery_options: [],
    ...overrides,
  };
}

function stateMap(state, axisKey) {
  return Object.fromEntries(state.option_states[axisKey].map((entry) => [entry.value, entry.state]));
}

describe('modal-selection-model', () => {
  test('état initial dérivé des unités vendables réelles', () => {
    const state = createModalSelection(detail());

    expect(state.selected_sku_id).toBeNull();
    expect(state.selected_media.map((media) => media.id)).toEqual(['global-main']);
    expect(stateMap(state, 'Couleur')).toEqual({
      Marron: OPTION_STATE.AVAILABLE,
      Beige: OPTION_STATE.AVAILABLE,
      Vert: OPTION_STATE.INCOMPATIBLE,
    });
    expect(stateMap(state, 'Taille')).toEqual({
      S: OPTION_STATE.AVAILABLE,
      M: OPTION_STATE.AVAILABLE,
      L: OPTION_STATE.AVAILABLE,
    });
  });

  test('Marron recalcule les tailles et les médias', () => {
    const product = detail();
    const state = selectModalOption(product, createModalSelection(product), 'Couleur', 'Marron');

    expect(state.selected_options).toEqual({ Couleur: 'Marron' });
    expect(state.selected_media.map((media) => media.id)).toEqual(['brown-scene']);
    expect(stateMap(state, 'Taille')).toEqual({
      S: OPTION_STATE.AVAILABLE,
      M: OPTION_STATE.AVAILABLE,
      L: OPTION_STATE.OUT_OF_STOCK,
    });
  });

  test('Marron + L reste bloqué avec une raison explicite', () => {
    const product = detail();
    const marron = selectModalOption(product, createModalSelection(product), 'Couleur', 'Marron');
    const blocked = selectModalOption(product, marron, 'Taille', 'L');

    expect(blocked.selected_options).toEqual({ Couleur: 'Marron' });
    expect(blocked.selected_sku_id).toBeNull();
    expect(blocked.selection_message).toBe('L indisponible pour Marron — rupture de stock');
  });

  test('Marron + M résout le SKU précis et ses médias', () => {
    const product = detail();
    const marron = selectModalOption(product, createModalSelection(product), 'Couleur', 'Marron');
    const selected = selectModalOption(product, marron, 'Taille', 'M');

    expect(selected.selected_sku_id).toBe(SKU_MAR_M);
    expect(selected.selected_media.map((media) => media.id)).toEqual(['brown-scene', 'brown-m-detail']);
    expect(selected.selection_message).toBeNull();
  });

  test('changer la couleur efface la taille aval', () => {
    const product = detail();
    const marron = selectModalOption(product, createModalSelection(product), 'Couleur', 'Marron');
    const marronM = selectModalOption(product, marron, 'Taille', 'M');
    const beige = selectModalOption(product, marronM, 'Couleur', 'Beige');

    expect(beige.selected_options).toEqual({ Couleur: 'Beige' });
    expect(beige.selected_sku_id).toBeNull();
    expect(beige.selected_media.map((media) => media.id)).toEqual(['beige-product']);
    expect(stateMap(beige, 'Taille')).toEqual({
      S: OPTION_STATE.INCOMPATIBLE,
      M: OPTION_STATE.AVAILABLE,
      L: OPTION_STATE.AVAILABLE,
    });
  });

  test('combinaison non proposée expliquée sans muter la sélection', () => {
    const product = detail();
    const beige = selectModalOption(product, createModalSelection(product), 'Couleur', 'Beige');
    const blocked = selectModalOption(product, beige, 'Taille', 'S');

    expect(blocked.selected_options).toEqual({ Couleur: 'Beige' });
    expect(blocked.selection_message).toBe('S indisponible pour Beige — combinaison non proposée');
  });

  test('valeur amont incompatible sans faux contexte', () => {
    const product = detail();
    const blocked = selectModalOption(product, createModalSelection(product), 'Couleur', 'Vert');

    expect(blocked.selected_options).toEqual({});
    expect(blocked.selection_message).toBe('Vert indisponible — combinaison non proposée');
  });

  test('axe et valeur inconnus échouent bruyamment', () => {
    const product = detail();
    const state = createModalSelection(product);

    expect(() => selectModalOption(product, state, 'Matière', 'Lin')).toThrow('Axe produit inconnu : Matière');
    expect(() => selectModalOption(product, state, 'Couleur', 'Bleu')).toThrow('Valeur inconnue pour Couleur : Bleu');
  });

  test('produit legacy : aucun faux état SKU', () => {
    const product = detail({ inventory_model: 'LEGACY_VARIANTS', sellable_units: [] });
    const state = createModalSelection(product);

    expect(state.selection_supported).toBe(false);
    expect(state.selected_sku_id).toBeNull();
    expect(state.option_states).toEqual({});
    expect(selectModalOption(product, state, 'Couleur', 'Marron')).toBe(state);
  });

  test('détail legacy incomplet ou nul reste passif sans crash ni faux média', () => {
    expect(createModalSelection(null)).toEqual({
      inventory_model: null,
      selection_supported: false,
      selected_options: {},
      selected_sku_id: null,
      selected_media: [],
      option_states: {},
      selection_message: null,
    });

    const state = createModalSelection({ inventory_model: 'LEGACY_VARIANTS' });
    expect(state.selection_supported).toBe(false);
    expect(state.selected_media).toEqual([]);
  });

  test('SKU par défaut sans axes : sélection immédiate si disponible', () => {
    const defaultSku = '66666666-6666-4666-8666-666666666666';
    const product = detail({
      option_axes: [],
      sellable_units: [{
        sku_id: defaultSku,
        sku: 'SAVON-001',
        option_values: {},
        stock_status: 'AVAILABLE',
        available_quantity: 12,
        price_kmf: 1500,
        media_ids: [],
      }],
    });

    const state = createModalSelection(product);
    expect(state.selected_sku_id).toBe(defaultSku);
    expect(state.selected_media.map((media) => media.id)).toEqual(['global-main']);
  });

  test('SKU par défaut en rupture : aucune sélection transactionnelle', () => {
    const product = detail({
      option_axes: [],
      sellable_units: [{
        sku_id: '77777777-7777-4777-8777-777777777777',
        sku: 'SAVON-OUT',
        option_values: {},
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
        price_kmf: 1500,
        media_ids: [],
      }],
    });

    expect(createModalSelection(product).selected_sku_id).toBeNull();
  });

  test('sans media_ids, les associations option_values restent la source de vérité', () => {
    const product = detail({
      sellable_units: detail().sellable_units.map((unit) =>
        unit.sku_id === SKU_MAR_M ? { ...unit, media_ids: [] } : unit
      ),
    });
    const marron = selectModalOption(product, createModalSelection(product), 'Couleur', 'Marron');
    const selected = selectModalOption(product, marron, 'Taille', 'M');

    expect(selected.selected_media.map((media) => media.id)).toEqual(['brown-scene', 'brown-m-detail']);
  });
});
