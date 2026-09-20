/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const audit = require('../../scripts/refinery-fr-cross-supplier-audit');

function row(target, options = {}) {
  return {
    id: target.id,
    supplier_name: target.supplier,
    supplier_product_id: target.supplierProductId,
    state: 'scanned',
    product_id: null,
    product_name: 'Source Title',
    description: null,
    normalized_source_contract: {
      source_locale: 'en',
      product_name: 'Source Title',
      description: 'Source description says cable 100W',
      option_axes: [{ key: 'length', values: ['1m', '2m'] }],
      sellable_units: [
        { option_values: { length: '1m' } },
        { option_values: { length: '2m' } },
      ],
      media: [{ supplier_media_id: 'photo1' }],
    },
    ...options,
  };
}

test('configuration status never reveals model keys or pretends an inference ran', () => {
  expect(audit.providerReadiness({ ANTHROPIC_API_KEY: '' })).toEqual({
    provider: 'anthropic', status: 'PROVIDER_KEY_MISSING',
  });
  expect(audit.providerReadiness({ CATALOG_ENRICH_PROVIDER: 'openai', OPENAI_API_KEY: 'private-key' }))
    .toEqual({ provider: 'openai', status: 'PROVIDER_KEY_PRESENT_NOT_YET_TESTED' });
});

test('missing description, absent draft and distinct variants produce explained blockers', () => {
  const target = audit.TARGETS[0];
  const result = audit.inspectCandidate(row(target, {
    normalized_source_contract: { source_locale: 'en', option_axes: [], sellable_units: [{ option_values: {} }] },
  }));
  expect(result.blockers).toEqual(expect.arrayContaining([
    'SOURCE_DESCRIPTION_MISSING', 'CATALOG_DRAFT_NOT_CREATED',
  ]));
  expect(result.fr_preparation_proven).toBe(false);
});

test('cross supplier run reads exactly two known cases in a SQL READ ONLY transaction', async () => {
  const rows = audit.TARGETS.map(t => row(t));
  const q = {
    query: jest.fn(async sql => {
      if (String(sql).includes('FROM sourcing_candidates')) return { rows };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const result = await audit.run({
    env: { KOMERCE_ENV: 'staging', DATABASE_URL: 'placeholder-for-test' },
    executor: { getClient: async () => q },
  });
  expect(result).toMatchObject({
    writes: false, ai_call_invoked: false, purchase_invoked: false,
    publication_performed: false, cases: [{ fr_preparation_proven: false }, { fr_preparation_proven: false }],
  });
  expect(q.query.mock.calls.map(([sql]) => String(sql))).toEqual([
    'BEGIN TRANSACTION READ ONLY', expect.stringContaining('FROM sourcing_candidates'), 'COMMIT',
  ]);
  expect(q.release).toHaveBeenCalledTimes(1);
});

test('identity mismatch fails closed and rolls back', async () => {
  const q = {
    query: jest.fn(async sql => String(sql).includes('FROM sourcing_candidates')
      ? { rows: audit.TARGETS.map(t => row(t, { supplier_product_id: 'wrong' })) }
      : { rows: [] }),
    release: jest.fn(),
  };
  await expect(audit.run({
    env: { KOMERCE_ENV: 'staging', DATABASE_URL: 'placeholder-for-test' },
    executor: { getClient: async () => q },
  })).rejects.toThrow('REFINERY_FR_AUDIT_EXACT_TARGETS_NOT_FOUND');
  expect(q.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  await expect(audit.run({ env: { KOMERCE_ENV: 'production' } }))
    .rejects.toThrow('REFINERY_FR_AUDIT_STAGING_ONLY');
});
