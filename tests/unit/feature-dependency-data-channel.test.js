/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const { scanDataChannel } = require('../../scripts/lib/feature-dependency-conformance');

describe('O5 data dependency channel', () => {
  test('projects business reads/writes and excludes technical writers', () => {
    const rows = scanDataChannel({
      products: {
        lifecycleOwner: 'catalog',
        readers: ['orders', 'catalog'],
        writers: [
          { feature: 'catalog', mode: 'RW', technical: false },
          { feature: 'sourcing', mode: 'W', technical: false },
          { feature: 'dashboard', mode: 'RW', technical: true },
        ],
      },
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ consumerFeature: 'orders', providerFeature: 'catalog', channel: 'data-read', table: 'products' }),
      expect.objectContaining({ consumerFeature: 'sourcing', providerFeature: 'catalog', channel: 'data-write', table: 'products' }),
    ]));
    expect(rows.some(row => row.consumerFeature === 'dashboard')).toBe(false);
    expect(rows.some(row => row.consumerFeature === row.providerFeature)).toBe(false);
  });
});
