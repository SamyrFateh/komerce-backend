'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { resolveSkuMediaLinks } = require('../../services/catalog-promotion/sku-media');

describe('catalog-promotion/sku-media — resolveSkuMediaLinks (PDC-8 Lot 5)', () => {
  test('#18 relation media_refs → SKU media explicite', () => {
    const mediaBySourceId = new Map([
      ['IMG-RED-01', 'media-uuid-1'],
      ['IMG-RED-02', 'media-uuid-2'],
    ]);
    const links = resolveSkuMediaLinks(
      [{ sku_id: 'sku-1', media_refs: ['IMG-RED-01', 'IMG-RED-02'] }],
      mediaBySourceId
    );
    expect(links).toEqual([
      { sku_id: 'sku-1', media_id: 'media-uuid-1' },
      { sku_id: 'sku-1', media_id: 'media-uuid-2' },
    ]);
  });

  test('#19 media_ref inconnu rejeté', () => {
    const mediaBySourceId = new Map([['IMG-RED-01', 'media-uuid-1']]);
    expect(() => resolveSkuMediaLinks(
      [{ sku_id: 'sku-1', media_refs: ['IMG-GHOST'] }],
      mediaBySourceId
    )).toThrow(/media_ref inconnu/);
  });

  test('sku sans media_refs → aucun lien produit (fallback legacy hors périmètre)', () => {
    const links = resolveSkuMediaLinks(
      [{ sku_id: 'sku-1', media_refs: null }, { sku_id: 'sku-2' }],
      new Map()
    );
    expect(links).toEqual([]);
  });

  test('plusieurs SKU référencent le même média sans duplication de la paire', () => {
    const mediaBySourceId = new Map([['IMG-SHARED', 'media-uuid-shared']]);
    const links = resolveSkuMediaLinks(
      [
        { sku_id: 'sku-1', media_refs: ['IMG-SHARED', 'IMG-SHARED'] }, // doublon intra-unité
        { sku_id: 'sku-2', media_refs: ['IMG-SHARED'] },
      ],
      mediaBySourceId
    );
    expect(links).toEqual([
      { sku_id: 'sku-1', media_id: 'media-uuid-shared' },
      { sku_id: 'sku-2', media_id: 'media-uuid-shared' },
    ]);
  });

  test('rejette un sellable_unit résolu sans sku_id', () => {
    expect(() => resolveSkuMediaLinks([{ media_refs: ['X'] }], new Map())).toThrow();
  });

  test('rejette des arguments de mauvais type', () => {
    expect(() => resolveSkuMediaLinks(null, new Map())).toThrow();
    expect(() => resolveSkuMediaLinks([], {})).toThrow();
  });

  test('ne fait jamais de matching heuristique par option_values (aucune référence à option_values dans ce module)', () => {
    const mediaBySourceId = new Map([['IMG-RED-01', 'media-uuid-1']]);
    // Un sellable_unit sans media_refs mais avec un variant_combo similaire à un média
    // ne doit produire AUCUN lien ici — ce module ne devine jamais.
    const links = resolveSkuMediaLinks(
      [{ sku_id: 'sku-1', variant_combo: { couleur: 'Rouge' }, media_refs: null }],
      mediaBySourceId
    );
    expect(links).toEqual([]);
  });
});
