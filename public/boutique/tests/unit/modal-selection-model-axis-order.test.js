'use strict';

const {
  createModalSelection,
  selectModalOption,
} = require('../../js/view-models/modal-selection-model.js');

const DETAIL = {
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
  media: [{
    id: 'global-main',
    url: '/main.jpg',
    role: 'PRODUCT',
    alt: 'Robe Dubaï',
    option_values: {},
  }],
  option_axes: [
    {
      key: 'Couleur',
      display_name: 'Couleur',
      values: [
        { value: 'Marron', thumbnail_url: null },
        { value: 'Beige', thumbnail_url: null },
      ],
    },
    {
      key: 'Taille',
      display_name: 'Taille',
      values: [{ value: 'M', thumbnail_url: null }],
    },
  ],
  sellable_units: [
    {
      sku_id: '11111111-1111-4111-8111-111111111111',
      sku: 'ROB-MAR-M',
      option_values: { Couleur: 'Marron', Taille: 'M' },
      stock_status: 'AVAILABLE',
      available_quantity: 3,
      price_kmf: 12500,
      media_ids: [],
    },
    {
      sku_id: '22222222-2222-4222-8222-222222222222',
      sku: 'ROB-BEI-M',
      option_values: { Couleur: 'Beige', Taille: 'M' },
      stock_status: 'AVAILABLE',
      available_quantity: 2,
      price_kmf: 12500,
      media_ids: [],
    },
  ],
  delivery_options: [],
};

describe('modal-selection-model — ordre des axes', () => {
  test('un axe aval peut être choisi en premier sans inventer son axe amont', () => {
    const state = selectModalOption(
      DETAIL,
      createModalSelection(DETAIL),
      'Taille',
      'M'
    );

    expect(state.selected_options).toEqual({ Taille: 'M' });
    expect(state.selected_sku_id).toBeNull();
    expect(state.selected_media.map((media) => media.id)).toEqual(['global-main']);
  });

  test('choisir ensuite un axe amont efface le choix aval', () => {
    const sizeFirst = selectModalOption(
      DETAIL,
      createModalSelection(DETAIL),
      'Taille',
      'M'
    );
    const beige = selectModalOption(DETAIL, sizeFirst, 'Couleur', 'Beige');

    expect(beige.selected_options).toEqual({ Couleur: 'Beige' });
    expect(beige.selected_sku_id).toBeNull();
  });
});
