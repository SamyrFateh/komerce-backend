'use strict';

const {
  assertPersistedProof,
} = require('../../scripts/ebay-p3-pipeline-proof');

function fixture() {
  const unitRef = 'v1|1234567890|0';
  return {
    snapshot: {
      import_row: {
        id: 'import-1',
        supplier_name: 'eBay Sandbox',
        source_type: 'api',
        total_items: 1,
      },
      candidates: [{
        id: 'candidate-1',
        supplier_name: 'eBay Sandbox',
        supplier_product_id: '1234567890',
        state: 'scanned',
        normalized_source_contract: { schema_version: '2' },
      }],
      source: {
        source_id: 'api:ebay',
        adapter_type: 'ebay',
        acquisition: 'pull',
        continuity: 'recurring',
      },
      capture: {
        capture_id: 'capture-1',
        source_id: 'api:ebay',
        status: 'complete',
        stats: {},
      },
      observations: [
        {
          observation_id: 'obs-product',
          grain: 'product',
          source_ref: '1234567890',
          normalized: { schema_version: '2', product_name: 'Test' },
        },
        {
          observation_id: 'obs-offer',
          grain: 'offer',
          source_ref: null,
          normalized: { purchase_price: 10, currency: 'USD' },
        },
        {
          observation_id: 'obs-unit',
          grain: 'unit',
          source_ref: unitRef,
          normalized: {
            supplier_sku: 'ebay-sandbox:1234567890:0',
            supplier_unit_ref: unitRef,
            supplier_order_identity: {
              provider: 'ebay',
              version: 1,
              payload: {
                environment: 'sandbox',
                marketplace_id: 'EBAY_US',
                item_id: unitRef,
              },
            },
          },
        },
      ],
      bindings: [
        { observation_id: 'obs-product', canonical_entity_id: 'canon-product', grain: 'product' },
        { observation_id: 'obs-offer', canonical_entity_id: 'canon-offer', grain: 'offer' },
        { observation_id: 'obs-unit', canonical_entity_id: 'canon-unit', grain: 'unit' },
      ],
    },
    importResult: {
      body: {
        shadow_ingestion: {
          resolution: {
            status: 'resolved',
            new_canonical: 3,
            linked: 0,
            review_required: 0,
            deferred_parent: 0,
          },
        },
      },
    },
  };
}

describe('eBay P3 pipeline proof assertions', () => {
  test('accepts exact provider-neutral P3 persistence proof', () => {
    const { snapshot, importResult } = fixture();
    expect(assertPersistedProof(snapshot, importResult)).toMatchObject({
      proof: 'EBAY_P3_PIPELINE_PASS',
      source_id: 'api:ebay',
      observations: { product: 1, offer: 1, unit: 1, total: 3 },
      canonical_bindings: 3,
      provider: 'ebay',
      environment: 'sandbox',
      place_order_invoked: false,
      provider_mutation_invoked: false,
    });
  });

  test('rejects Supplier Order Identity leaked to Product grain', () => {
    const { snapshot, importResult } = fixture();
    snapshot.observations[0].normalized.supplier_order_identity = {
      provider: 'ebay',
      version: 1,
      payload: {},
    };
    expect(() => assertPersistedProof(snapshot, importResult))
      .toThrow('EBAY_P3_SOI_LEAKED_TO_PRODUCT');
  });

  test('rejects Unit source_ref different from opaque SOI item_id', () => {
    const { snapshot, importResult } = fixture();
    snapshot.observations[2].normalized.supplier_order_identity.payload.item_id = 'v1|other|0';
    expect(() => assertPersistedProof(snapshot, importResult))
      .toThrow('EBAY_P3_UNIT_SOURCE_REF_MISMATCH');
  });

  test('rejects incomplete canonical binding coverage', () => {
    const { snapshot, importResult } = fixture();
    snapshot.bindings.pop();
    expect(() => assertPersistedProof(snapshot, importResult))
      .toThrow('EBAY_P3_OBSERVATION_BINDING_INCOMPLETE');
  });

  test('rejects resolution requiring manual review', () => {
    const { snapshot, importResult } = fixture();
    importResult.body.shadow_ingestion.resolution.review_required = 1;
    expect(() => assertPersistedProof(snapshot, importResult))
      .toThrow('EBAY_P3_RESOLUTION_REVIEW_REQUIRED');
  });
});
