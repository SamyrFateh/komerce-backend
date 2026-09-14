'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { findCanonicalProductIdsForCatalogProduct } = require('../../services/sourcing-catalog-product-linkage');

test.each([
  [[], []],
  [[{ canonical_entity_id: 'canon-1' }], ['canon-1']],
  [[{ canonical_entity_id: 'canon-1' }, { canonical_entity_id: 'canon-2' }], ['canon-1', 'canon-2']],
])('retourne toute la cardinalité sans arbitrage', async (rows, expected) => {
  const query = jest.fn(async () => ({ rows }));
  await expect(findCanonicalProductIdsForCatalogProduct('product-1', query)).resolves.toEqual(expected);
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual(['product-1']);
  expect(sql).toContain('WHERE sc.product_id = $1');
  expect(sql).not.toContain('LIMIT');
});
