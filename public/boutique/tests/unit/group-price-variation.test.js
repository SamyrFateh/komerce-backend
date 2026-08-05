'use strict';

/**
 * tests/unit/group-price-variation.test.js
 *
 * Module js/group/group-price-variation.js — comparaison prix snapshot
 * (liste partagée) / prix catalogue actuel, pour le recap de checkout
 * (mandat V2-E §2/§3). Logique pure, sans DOM.
 */

const {
  computePriceVariations,
  buildPriceVariationSummary,
} = require('../../js/group/group-price-variation.js');

function line({ shared_cart_item_id = 'sci-1', name = 'Riz', snapshot, current }) {
  return {
    shared_cart_item_id,
    product: { id: 'p-1', name, price_kmf: current },
    shared_list_context: snapshot === undefined ? undefined : {
      snapshot_unit_price_kmf: snapshot,
      snapshot_name: name,
      snapshot_image_url: null,
    },
  };
}

describe('computePriceVariations', () => {
  it('retourne [] pour un panier vide ou non-tableau', () => {
    expect(computePriceVariations([])).toEqual([]);
    expect(computePriceVariations(null)).toEqual([]);
    expect(computePriceVariations(undefined)).toEqual([]);
  });

  it('aucun message si prix snapshot === prix actuel', () => {
    const cart = [line({ snapshot: 6500, current: 6500 })];
    expect(computePriceVariations(cart)).toEqual([]);
  });

  it('hausse affichée si prix actuel > snapshot', () => {
    const cart = [line({ snapshot: 6500, current: 7200 })];
    const result = computePriceVariations(cart);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ snapshotPrice: 6500, currentPrice: 7200 });
  });

  it('baisse affichée si prix actuel < snapshot', () => {
    const cart = [line({ snapshot: 7200, current: 6500 })];
    const result = computePriceVariations(cart);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ snapshotPrice: 7200, currentPrice: 6500 });
  });

  it('aucun message si le snapshot est absent (pas un item de liste)', () => {
    const cart = [line({ snapshot: undefined, current: 7200 })];
    expect(computePriceVariations(cart)).toEqual([]);
  });

  it('aucun message si le snapshot vaut zéro', () => {
    const cart = [line({ snapshot: 0, current: 7200 })];
    expect(computePriceVariations(cart)).toEqual([]);
  });

  it('aucun message si le prix actuel est absent', () => {
    const cart = [{
      shared_cart_item_id: 'sci-1',
      product: { id: 'p-1', name: 'Riz' }, // pas de price_kmf
      shared_list_context: { snapshot_unit_price_kmf: 6500, snapshot_name: 'Riz' },
    }];
    expect(computePriceVariations(cart)).toEqual([]);
  });

  it('panier mixte : seules les lignes réellement modifiées ressortent', () => {
    const cart = [
      line({ shared_cart_item_id: 'sci-1', snapshot: 6500, current: 6500 }), // inchangé
      line({ shared_cart_item_id: 'sci-2', snapshot: 6500, current: 7200 }), // changé
      { product: { id: 'p-3', price_kmf: 1000 } }, // panier personnel, pas de contexte liste
    ];
    const result = computePriceVariations(cart);
    expect(result).toHaveLength(1);
    expect(result[0].shared_cart_item_id).toBe('sci-2');
  });
});

describe('buildPriceVariationSummary', () => {
  it('null si aucune variation', () => {
    expect(buildPriceVariationSummary([])).toBeNull();
  });

  it('message au singulier pour un seul article modifié', () => {
    const msg = buildPriceVariationSummary([{ shared_cart_item_id: 'sci-1' }]);
    expect(msg).toBe('Le prix d’un article a été actualisé depuis le partage.');
  });

  it('message au pluriel pour plusieurs articles modifiés', () => {
    const msg = buildPriceVariationSummary([
      { shared_cart_item_id: 'sci-1' },
      { shared_cart_item_id: 'sci-2' },
    ]);
    expect(msg).toBe('Les prix de 2 articles ont été actualisés depuis le partage.');
  });
});
