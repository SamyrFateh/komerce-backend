'use strict';

const {
  OPTION_STATE,
  createModalSelection,
  selectModalOption,
} = require('../../js/view-models/modal-selection-model.js');

const SKU_MAR_S = '11111111-1111-4111-8111-111111111111';
const SKU_MAR_M = '22222222-2222-4222-8222-222222222222';
const SKU_MAR_L = '33333333-3333-4333-8333-333333333333';
const SKU_BEI_M = '44444444-4444-4444-8444-444444444444';
const SKU_BEI_L = '55555555-5555-4555-8555-555555555555';

function productDetail(overrides = {}) {
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
      {
        id: 'global-main',
        url: '/main.jpg',
        role: 'PRODUCT',
        alt: 'Robe Dubaï',
        option_values: {},
      },
      {
        id: 'brown-scene',
        url: '/brown-scene.jpg',
        role: 'PRODUCT',
        alt: 'Robe marron',
        option_values: { Couleur: 'Marron' },
      },
      {
        id: 'brown-m-detail',
        url: '/brown-m-detail.jpg',
        role: 'DETAIL',
        alt: 'Robe marron M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
      },
      {
        id: 'beige-product',
        url: '/beige.jpg',
        role: 'PRODUCT',
        alt: 'Robe beige',
        option_values: { Couleur: 'Beige' },
      },
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
        sku_id: SKU_MAR_S,
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
        sku_id: SKU_MAR_L,
        sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
        price_kmf: 12500,
        media_ids: ['brown-scene'],
      },
      {
        sku_id: SKU_BEI_M,
        sku: 'ROB-BEI-M',
        option_values: { Couleur: 'Beige', Taille: 'M' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 12500,
        media_ids: ['beige-product'],
      },
      {
        sku_id: SKU_BEI_L,
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

function statesFor(state, axisKey) {
  return Object.fromEntries(
    state.option_states[axisKey].map((option) => [option.value, option.state])
  );
}

describe('modal-selection-model', () => {
  test('état initial : disponibilité agrégée depuis les unités réelles, jamais depuis un stock d’axe', () => {
    const state = createModalSelection(productDetail());

    expect(state).toMatchObject({
      inventory_model: 'SKU',
      selection_supported: true,
      selected_options: {},
      selected_sku_id: null,
      selection_message: null,
    });
    expect(state.selected_media.map((media) => media.id)).toEqual(['global-main']);
    expect(statesFor(state, 'Couleur')).toEqual({
      Marron: OPTION_STATE.AVAILABLE,
      Beige: OPTION_STATE.AVAILABLE,
      Vert: OPTION_STATE.INCOMPATIBLE,
    });
    expect(statesFor(state, 'Taille')).toEqual({
      S: OPTION_STATE.AVAILABLE,
      M: OPTION_STATE.AVAILABLE,
      L: OPTION_STATE.AVAILABLE,
    });
  });

  test('sélection Marron : médias et tailles sont recalculés depuis les SKU compatibles', () => {
    const detail = productDetail();
    const state = selectModalOption(
      detail,
      createModalSelection(detail),
      'Couleur',
      'Marron'
    );

    expect(state.selected_options).toEqual({ Couleur: 'Marron' });
    expect(state.selected_sku_id).toBeNull();
    expect(state.selected_media.map((media) => media.id)).toEqual(['brown-scene']);
    expect(statesFor(state, 'Taille')).toEqual({
      S: OPTION_STATE.AVAILABLE,
      M: OPTION_STATE.AVAILABLE,
      L: OPTION_STATE.OUT_OF_STOCK,
    });
  });

  test('L pour Marron reste non sélectionné et explique la rupture', () => {
    const detail = productDetail();
    const marron = selectModalOption(detail, createModalSelection(detail), 'Couleur', 'Marron');
    const blocked = selectModalOption(detail, marron, 'Taille', 'L');

    expect(blocked.selected_options).toEqual({ Couleur: 'Marron' });
    expect(blocked.selected_sku_id).toBeNull();
    expect(blocked.selection_message).toBe('L indisponible pour Marron — rupture de stock');
    expect(blocked.selected_media.map((media) => media.id)).toEqual(['brown-scene']);
  });

  test('M pour Marron résout un SKU précis et ses médias associés', () => {
    const detail = productDetail();
    const marron = selectModalOption(detail, createModalSelection(detail), 'Couleur', 'Marron');
    const selected = selectModalOption(detail, marron, 'Taille', 'M');

    expect(selected.selected_options).toEqual({ Couleur: 'Marron', Taille: 'M' });
    expect(selected.selected_sku_id).toBe(SKU_MAR_M);
    expect(selected.selected_media.map((media) => media.id)).toEqual([
      'brown-scene',
      'brown-m-detail',
    ]);
    expect(selected.selection_message).toBeNull();
  });

  test('changer un axe amont efface les choix aval et recalcule la fiche', () => {
    const detail = productDetail();
    const marron = selectModalOption(detail, createModalSelection(detail), 'Couleur', 'Marron');
    const marronM = selectModalOption(detail, marron, 'Taille', 'M');
    const beige = selectModalOption(detail, marronM, 'Couleur', 'Beige');

    expect(beige.selected_options).toEqual({ Couleur: 'Beige' });
    expect(beige.selected_sku_id).toBeNull();
    expect(beige.selected_media.map((media) => media.id)).toEqual(['beige-product']);
    expect(statesFor(beige, 'Taille')).toEqual({
      S: OPTION_STATE.INCOMPATIBLE,
      M: OPTION_STATE.AVAILABLE,
      L: OPTION_STATE.AVAILABLE,
    });
  });

  test('une combinaison non proposée est expliquée sans muter la sélection', () => {
    const detail = productDetail();
    const beige = selectModalOption(detail, createModalSelection(detail), 'Couleur', 'Beige');
    const blocked = selectModalOption(detail, beige, 'Taille', 'S');

    expect(blocked.selected_options).toEqual({ Couleur: 'Beige' });
    expect(blocked.selection_message).toBe('S indisponible pour Beige — combinaison non proposée');
  });

  test('une valeur amont incompatible porte un message sans contexte artificiel', () => {
    const detail = productDetail();
    const blocked = selectModalOption(detail, createModalSelection(detail), 'Couleur', 'Vert');

    expect(blocked.selected_options).toEqual({});
    expect(blocked.selection_message).toBe('Vert indisponible — combinaison non proposée');
  });

  test('axe inconnu : erreur de programmation explicite', () => {
    const detail = productDetail();
    const state = createModalSelection(detail);

    expect(() => selectModalOption(detail, state, 'Matière', 'Lin')).toThrow('Axe produit inconnu : Matière');
    try {
      selectModalOption(detail, state, 'Matière', 'Lin');
    } catch (error) {
      expect(error.code).toBe('MODAL_SELECTION_AXIS_UNKNOWN');
    }
  });

  test('valeur inconnue : erreur de programmation explicite', () => {
    const detail = productDetail();
    const state = createModalSelection(detail);

    expect(() => selectModalOption(detail, state, 'Couleur', 'Bleu')).toThrow('Valeur inconnue pour Couleur : Bleu');
    try {
      selectModalOption(detail, state, 'Couleur', 'Bleu');
    } catch (error) {
      expect(error.code).toBe('MODAL_SELECTION_VALUE_UNKNOWN');
    }
  });

  test('produit legacy : aucun faux état SKU n’est fabriqué et le reducer reste passif', () => {
    const detail = productDetail({ inventory_model: 'LEGACY_VARIANTS', sellable_units: [] });
    const state = createModalSelection(detail);

    expect(state).toEqual({
      inventory_model: 'LEGACY_VARIANTS',
      selection_supported: false,
      selected_options: {},
      selected_sku_id: null,
      selected_media: [detail.media[0]],
      option_states: {},
      selection_message: null,
    });
    expect(selectModalOption(detail, state, 'Couleur', 'Marron')).toBe(state);
  });

  test('produit legacy sans média global : conserve la galerie disponible comme fallback visuel', () => {
    const base = productDetail();
    const detail = productDetail({
      inventory_model: 'LEGACY_VARIANTS',
      sellable_units: [],
      media: [base.media[1], base.media[3]],
    });

    const state = createModalSelection(detail);
    expect(state.selected_media.map((media) => media.id)).toEqual(['brown-scene', 'beige-product']);
  });

  test('SKU par défaut sans axes : sélection transactionnelle immédiate', () => {
    const defaultSku = '66666666-6666-4666-8666-666666666666';
    const detail = productDetail({
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

    const state = createModalSelection(detail);
    expect(state.selected_options).toEqual({});
    expect(state.selected_sku_id).toBe(defaultSku);
    expect(state.option_states).toEqual({});
    expect(state.selected_media.map((media) => media.id)).toEqual(['global-main']);
  });

  test('SKU par défaut en rupture ou absent : aucune unité n’est sélectionnée', () => {
    const out = productDetail({
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
    const none = productDetail({ option_axes: [], sellable_units: [] });

    expect(createModalSelection(out).selected_sku_id).toBeNull();
    expect(createModalSelection(none).selected_sku_id).toBeNull();
  });

  test('SKU complet sans media_ids dérive les médias depuis les associations explicites', () => {
    const base = productDetail();
    const detail = productDetail({
      sellable_units: base.sellable_units.map((unit) =>
        unit.sku_id === SKU_MAR_M ? { ...unit, media_ids: [] } : unit
      ),
    });
    const marron = selectModalOption(detail, createModalSelection(detail), 'Couleur', 'Marron');
    const selected = selectModalOption(detail, marron, 'Taille', 'M');

    expect(selected.selected_sku_id).toBe(SKU_MAR_M);
    expect(selected.selected_media.map((media) => media.id)).toEqual([
      'brown-scene',
      'brown-m-detail',
    ]);
  });

  test('sans média global ni sélection spécifique, l’état SKU garde la galerie disponible', () => {
    const base = productDetail();
    const detail = productDetail({ media: [base.media[1], base.media[3]] });

    expect(createModalSelection(detail).selected_media.map((media) => media.id)).toEqual([
      'brown-scene',
      'beige-product',
    ]);
  });
});
