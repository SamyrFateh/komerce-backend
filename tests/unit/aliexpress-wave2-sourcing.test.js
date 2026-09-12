'use strict';

const {
  WAVE_ID,
  WAVE_TARGET,
  WAVE_QUERIES,
  waveConfig,
  logicalWavePage,
  checkpointCategoryId,
  waveSourceFilename,
  withWaveProvenance,
} = require('../../scripts/aliexpress-wave2-sourcing');

describe('AliExpress Wave 2 sourcing', () => {
  test('is a separate 500-product sourcing wave', () => {
    expect(WAVE_ID).toBe('wave2-500-v1');
    expect(WAVE_TARGET).toBe(500);
    expect(WAVE_QUERIES.length).toBeGreaterThan(40);
    expect(new Set(WAVE_QUERIES.map(row => row.keyword)).size).toBe(WAVE_QUERIES.length);
    expect(checkpointCategoryId()).toBe(`text:${WAVE_ID}`);
  });

  test('round-robins fresh search vocabulary before increasing supplier page', () => {
    const queries = [
      { keyword: 'one', category: 'A', subcategory: 'a' },
      { keyword: 'two', category: 'B', subcategory: 'b' },
    ];
    expect(logicalWavePage(1, queries)).toMatchObject({ keyword: 'one', queryIndex: 0, queryPage: 1 });
    expect(logicalWavePage(2, queries)).toMatchObject({ keyword: 'two', queryIndex: 1, queryPage: 1 });
    expect(logicalWavePage(3, queries)).toMatchObject({ keyword: 'one', queryIndex: 0, queryPage: 2 });
  });

  test('persists explicit wave provenance without losing supplier raw payload', () => {
    const original = {
      supplier_product_id: '12345',
      raw_payload: { supplier_fact: 'kept', discovery: { previous: 'kept' } },
    };
    const projected = withWaveProvenance(original, {
      keyword: 'maxi summer dress',
      category: 'Mode & Beauté',
      subcategory: 'Femme',
      queryPage: 2,
      countryCode: 'AE',
    });

    expect(projected.raw_payload.supplier_fact).toBe('kept');
    expect(projected.raw_payload.discovery.previous).toBe('kept');
    expect(projected.raw_payload.discovery.wave).toBe(WAVE_ID);
    expect(projected.raw_payload.discovery.target_category).toBe('Mode & Beauté');
    expect(projected.raw_payload.discovery.query_page).toBe(2);
    expect(original.raw_payload.discovery.wave).toBeUndefined();
  });

  test('uses an isolated source path', () => {
    expect(waveSourceFilename('wave2-sync', 7))
      .toBe(`aliexpress-pool/wave2-sync/${WAVE_ID}/page-0007.json`);
  });

  test('requires explicit staging wave authorization', () => {
    const base = {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://test',
      ALIEXPRESS_APP_KEY: 'key',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
    };
    expect(() => waveConfig(base)).toThrow('KOMERCE_ALLOW_ALIEXPRESS_WAVE2=1 requis');
    expect(() => waveConfig({ ...base, KOMERCE_ALLOW_ALIEXPRESS_WAVE2: '1', KOMERCE_ENV: 'production' }))
      .toThrow('interdite en production');

    const config = waveConfig({ ...base, KOMERCE_ALLOW_ALIEXPRESS_WAVE2: '1' });
    expect(config.runtime).toBe('staging');
    expect(config.syncKey).toBe('aliexpress-wave2-500-v1');
    expect(config.countryCode).toBe('AE');
  });
});
