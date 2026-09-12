'use strict';

const surface = require('../../scripts/aliexpress-wave2-feed-surface');

describe('AliExpress Wave 2 feed/category surface', () => {
  test('keeps Wave 2 identity while recording a distinct supplier discovery surface', () => {
    const product = {
      supplier_product_id: '1234567890',
      raw_payload: { source: 'aliexpress_ds_api' },
    };
    const spec = {
      feed: 'DS bestseller',
      page: 2,
      categoryId: '200000345',
      categoryName: 'Home & Garden',
    };

    const projected = surface.withWaveSurfaceProvenance(product, spec, 'KM');

    expect(surface.SURFACE_ID).toBe('wave2-feed-category-v1');
    expect(projected.raw_payload.discovery).toMatchObject({
      source: 'aliexpress.ds.recommend.feed.get',
      wave: 'wave2-500-v1',
      wave_leg: 'wave2-feed-category-v1',
      feed_name: 'DS bestseller',
      supplier_category_id: '200000345',
      supplier_category_name: 'Home & Garden',
      query_page: 2,
      supplier_destination_country: 'KM',
    });
  });
});
