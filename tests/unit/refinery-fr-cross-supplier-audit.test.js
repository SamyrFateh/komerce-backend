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

test('missing description, absent draft and distinct variants produce explained blockers', () => {
  const target = audit.TARGETS[0];
  const result = audit.inspectCandidate(row(target, {
    normalized_source_contract: { source_locale: 'en', option_axes: [], sellable_units: [{ option_values: {} }] },
  }));
  expect(result.blockers).toEqual(expect.arrayContaining([
    'SOURCE_DESCRIPTION_MISSING', 'CATALOG_DRAFT_NOT_CREATED',
  ]));
  expect(result.fr_format_precheck_pass).toBe(false);
});

test('manual and native-FR preparations are accepted structurally without AI, not declared semantically proven', () => {
  const target = audit.TARGETS[0];
  const manual = audit.inspectCandidate(row(target), {
    content_source: 'manual', needs_review: false,
    description: 'Description française vérifiée et rédigée par le catalogue.',
    is_active: false, quality_validated: false,
  });
  expect(manual.fr_format_precheck_pass).toBe(true);
  expect(manual.fr_semantic_fidelity_proven).toBe(false);
  const native = audit.inspectCandidate(row(target, {
    normalized_source_contract: {
      source_locale: 'fr', description: 'Câble de recharge USB-C',
      sellable_units: [{ option_values: {} }], option_axes: [],
    },
  }), {
    content_source: 'connector_raw', needs_review: false,
    description: 'Câble USB-C destiné à la recharge.', is_active: false,
  });
  expect(native.fr_format_precheck_pass).toBe(true);
  expect(audit.inspectCandidate(row(target), {
    content_source: 'connector_raw', needs_review: false,
    description: 'USB-C fast charge cable source not reviewed',
  }).blockers).toContain('FOREIGN_RAW_SOURCE_NOT_FRENCH');
});

test('visual evidence only exposes sanitized public vendor CDN URLs', () => {
  expect(audit.publicSourceMediaUrl('https://ae01.alicdn.com/kf/thing.jpg?token=secret#fragment'))
    .toBe('https://ae01.alicdn.com/kf/thing.jpg');
  expect(audit.publicSourceMediaUrl('https://a.allegroimg.com/item/image.png')).toBe('https://a.allegroimg.com/item/image.png');
  expect(audit.publicSourceMediaUrl('https://private.example.com/?token=secret')).toBe(null);
  expect(audit.publicSourceMediaUrl('https://user:password@ae01.alicdn.com/p.png')).toBe(null);
  expect(audit.publicSourceMediaUrl('http://ae01.alicdn.com/p.png')).toBe(null);
});

test('image media is never considered translated just because a URL or alt is present', () => {
  const target = audit.TARGETS[0];
  const report = audit.inspectCandidate(row(target, {
    normalized_source_contract: {
      source_locale: 'fr', description: 'Description française source',
      option_axes: [], sellable_units: [{ option_values: {} }],
      media: [{ supplier_media_id: 'source-photo', role: 'PRODUCT',
        alt: 'French cable photo', option_values: {} }],
    },
  }), { content_source: 'manual', needs_review: false,
    description: 'Description française vérifiée et rédigée par un humain.' });
  expect(report.fr_format_precheck_pass).toBe(true);
  expect(report.source.image_text_audit.status).toBe('NOT_INSPECTED');
  expect(report.source.image_text_audit.media[0]).toMatchObject({
    source_media_id: 'source-photo', text_presence: 'NOT_INSPECTED',
    source_alt_present: true, french_translation_reviewed: false,
    image_replacement_performed: false,
  });
  expect(report.visual_text_translation_proven).toBe(false);
  expect(report.blockers).toContain('SOURCE_IMAGE_EMBEDDED_TEXT_NOT_AUDITED');
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
    publication_performed: false, editorial_contract: 'SOURCE_PRESERVED_PREPARATION_NOT_DEPENDENT_ON_DEDICATED_AI',
    cases: [{ fr_format_precheck_pass: false }, { fr_format_precheck_pass: false }],
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
