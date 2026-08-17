'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const connector = require('../../services/suppliers/connectors/json-connector');

function profile(overrides = {}) {
  return {
    profile_id: 'UNIT_JSON', profile_version: 1, supplier_name: 'UNIT', source_type: 'json',
    currency: { default: 'AED', resolution_policy: 'SOURCE_THEN_DEFAULT', allowed: ['AED', 'USD'] },
    identity: { supplier_id_field: 'id' },
    media: { gallery_source_field: 'images', thumbnail_fallback: true },
    weight: { source_field: 'weight', source_unit: null, target_unit: 'kg', unknown_unit_policy: 'PRESERVE_RAW_AND_OMIT' },
    policies: { unsupported_video: 'QUARANTINE_PRODUCT', lossy_mapping: 'QUARANTINE_PRODUCT', duplicate_relation: 'DEDUPLICATE_AND_AUDIT', asset_reuse: 'ALLOW_AND_AUDIT', missing_brand: 'ALLOW_NULL', missing_image: 'ALLOW_WITH_WARNING', unknown_fields: 'PRESERVE_RAW' },
    batch: { max_products: 100, max_file_bytes: 1000000, allow_empty_products: false, max_invalid_pct: 60, max_quarantined_pct: 60, max_field_bytes: 65536, max_depth: 12 },
    ...overrides,
  };
}

describe('json-connector', () => {
  test('préflight refuse une enveloppe JSON invalide avant toute classification', () => {
    expect(() => connector.preflight({ source: { products: 'not-array' }, import_profile: profile() }))
      .toThrow(expect.objectContaining({ code: 'BATCH_SOURCE_FORMAT_ERROR' }));
  });

  test('fetchProducts conserve les lignes valides et rejetées sans perte silencieuse', () => {
    const source = { products: [
      { id: 'sku-1', title: 'Produit', price: 19.99, stock: 2, images: ['https://example.test/a.jpg'] },
      { title: 'Sans identifiant', price: 10, stock: 1, images: [] },
    ] };
    const out = connector.fetchProducts({ source, import_profile: profile(), source_bytes: Buffer.byteLength(JSON.stringify(source)) });
    expect(out.connector_contract_version).toBe('1');
    expect(out.statistics.total).toBe(2);
    expect(out.ready.length + out.quarantined.length + out.rejected.length).toBe(2);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reason_code).toBe('MISSING_SUPPLIER_PRODUCT_ID');
  });

  test('la proposition de statut de batch reflète les seuils sans jeter les entrées', () => {
    const source = { products: [{ title: 'A' }, { title: 'B' }] };
    const out = connector.fetchProducts({ source, import_profile: profile({ batch: { ...profile().batch, max_invalid_pct: 10 } }) });
    expect(out.statistics.total).toBe(2);
    expect(out.statistics.threshold_evaluation.invalid_exceeded).toBe(true);
    expect(out.statistics.threshold_evaluation.proposed_batch_status).toBe('BLOCKED_INVALID_THRESHOLD');
  });
});
