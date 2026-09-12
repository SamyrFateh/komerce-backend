'use strict';

const wave2 = require('../../scripts/aliexpress-wave2-sourcing');
const {
  COMPLETION_ID,
  DEFAULT_SYNC_KEY,
  DEFAULT_PAGES_PER_QUERY,
  COMPLETION_QUERIES,
  completionConfig,
  logicalCompletionPage,
  checkpointCategoryId,
  sourceFilename,
  withCompletionProvenance,
} = require('../../scripts/aliexpress-wave2-completion');

describe('AliExpress Wave 2 completion sourcing', () => {
  test('keeps the same Wave 2 target with an isolated completion leg', () => {
    expect(wave2.WAVE_ID).toBe('wave2-500-v1');
    expect(wave2.WAVE_TARGET).toBe(500);
    expect(COMPLETION_ID).toBe('wave2-completion-v1');
    expect(DEFAULT_SYNC_KEY).toBe('aliexpress-wave2-completion-v1');
    expect(DEFAULT_PAGES_PER_QUERY).toBe(4);
    expect(checkpointCategoryId()).toBe(`text:${wave2.WAVE_ID}:${COMPLETION_ID}`);
  });

  test('uses fresh discovery vocabulary distinct from original Wave 2', () => {
    const original = new Set(wave2.WAVE_QUERIES.map(row => row.keyword));
    const completion = COMPLETION_QUERIES.map(row => row.keyword);
    expect(COMPLETION_QUERIES.length).toBeGreaterThan(40);
    expect(new Set(completion).size).toBe(completion.length);
    expect(completion.some(keyword => original.has(keyword))).toBe(false);
  });

  test('round-robins completion terms before increasing supplier page', () => {
    const queries = [
      { keyword: 'alpha', category: 'A', subcategory: 'a' },
      { keyword: 'beta', category: 'B', subcategory: 'b' },
    ];
    expect(logicalCompletionPage(1, queries)).toMatchObject({ keyword: 'alpha', queryIndex: 0, queryPage: 1 });
    expect(logicalCompletionPage(2, queries)).toMatchObject({ keyword: 'beta', queryIndex: 1, queryPage: 1 });
    expect(logicalCompletionPage(3, queries)).toMatchObject({ keyword: 'alpha', queryIndex: 0, queryPage: 2 });
  });

  test('preserves Wave 2 provenance and identifies the completion leg', () => {
    const original = {
      supplier_product_id: 'new-123',
      raw_payload: { source_fact: true, discovery: { previous: 'kept' } },
    };
    const projected = withCompletionProvenance(original, {
      keyword: 'drawer organizer',
      category: 'Maison',
      subcategory: 'Confort',
      queryPage: 1,
      countryCode: 'AE',
    });

    expect(projected.raw_payload.source_fact).toBe(true);
    expect(projected.raw_payload.discovery.previous).toBe('kept');
    expect(projected.raw_payload.discovery.wave).toBe(wave2.WAVE_ID);
    expect(projected.raw_payload.discovery.wave_leg).toBe(COMPLETION_ID);
    expect(projected.raw_payload.discovery.keyword).toBe('drawer organizer');
    expect(original.raw_payload.discovery.wave).toBeUndefined();
  });

  test('uses a separate checkpoint/source path without changing the Wave id', () => {
    expect(sourceFilename('completion-sync', 7))
      .toBe(`aliexpress-pool/completion-sync/${wave2.WAVE_ID}/${COMPLETION_ID}/page-0007.json`);
  });

  test('inherits Wave 2 staging guard and supports a completion page override', () => {
    const base = {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://test',
      ALIEXPRESS_APP_KEY: 'key',
      ALIEXPRESS_APP_SECRET: 'secret',
      ALIEXPRESS_SESSION: 'session',
      KOMERCE_ALLOW_ALIEXPRESS_WAVE2: '1',
      KOMERCE_ALIEXPRESS_WAVE2_COMPLETION_PAGES_PER_QUERY: '6',
    };
    const config = completionConfig(base);
    expect(config.runtime).toBe('staging');
    expect(config.syncKey).toBe(DEFAULT_SYNC_KEY);
    expect(config.pagesPerQuery).toBe(6);
    expect(config.countryCode).toBe('AE');
  });
});
