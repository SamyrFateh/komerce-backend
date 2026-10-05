'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const supplier360 = require('../../services/supplier-360');
const capabilityEvidence = require('../../services/suppliers/provider-capability-certifications');

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => jest.resetAllMocks());

test('resolveSupplier valide UUID et ne sélectionne jamais les secrets eux-mêmes', async () => {
  expect(await supplier360.resolveSupplier('bad')).toEqual({ invalid: true, supplier: null });
  db.query.mockResolvedValueOnce({ rows: [{
    id: ID, name: 'CJ', platform: 'cj', has_api_key: true, has_api_secret: true,
  }] });
  const resolved = await supplier360.resolveSupplier(ID);
  expect(resolved.invalid).toBe(false);
  expect(resolved.supplier.name).toBe('CJ');
  const sql = db.query.mock.calls[0][0];
  expect(sql).toContain('has_api_key');
  expect(sql).toContain('has_api_secret');
  expect(sql).not.toMatch(/SELECT[^]*api_key_enc\s*(?:,|FROM)/i);
  expect(sql).not.toMatch(/SELECT[^]*api_secret_enc\s*(?:,|FROM)/i);
});

test('Supplier 360 conserve le projecteur partagé supplier-connectivity comme API de compatibilité', () => {
  expect(supplier360.projectCapabilityCertifications).toBe(capabilityEvidence.projectCapabilityCertifications);
});

test('projectCapabilityCertifications conserve preuve, environnement et limites sans inventer activation runtime', () => {
  const projection = supplier360.projectCapabilityCertifications('CJ', {
    providers: {
      cj: [{
        capability: 'purchasing.auto_order',
        classification: 'GAP',
        availability: 'GUARDED',
        highest_proof: 'P1',
        environment: 'SANDBOX',
        evidence: ['proof/a'],
        limitations: ['production disabled'],
      }],
    },
  });
  expect(projection).toEqual(expect.objectContaining({
    provider: 'cj',
    resolution: 'RECORDED',
    authority: 'observational_proof_only',
  }));
  expect(projection.records[0]).toEqual(expect.objectContaining({
    capability: 'purchasing.auto_order',
    availability: 'GUARDED',
    highest_proof: 'P1',
    environment: 'SANDBOX',
  }));
  expect(projection.records[0].limitations).toEqual(['production disabled']);

  expect(supplier360.projectCapabilityCertifications('unknown', { providers: {} }))
    .toEqual(expect.objectContaining({ provider: null, resolution: 'UNSUPPORTED_PROVIDER', records: [] }));
});

test('loadSupplier360 conserve prix décimal en texte, sépare exécution/paiement et joint le registre de preuve provider', async () => {
  const q = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{
      product_ref: 'KPR-000001', product_name: 'Produit', supplier_sku: 'SKU-1',
      supplier_price_aed: '12.3400', min_order_qty: 1, priority: 1, is_active: true,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'po-1', order_id: null, order_reference: null, status: 'confirmed',
      procurement_hub_ref: 'HUB-DXB', supplier_order_id: 'CJ-1', supplier_currency: 'USD',
      created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:01:00Z',
    }] })
    .mockResolvedValueOnce({ rows: [{ provider: 'cj', provider_status: 'PAID', count: 2 }] })
    .mockResolvedValueOnce({ rows: [{
      provider: 'cj', status: 'ambiguous', reconciliation_status: 'unverified',
      currency: 'USD', count: 1, real_debit_verified_count: 0,
    }] })
  };
  const supplier = {
    id: ID, name: 'CJ', platform: 'cj', auto_order: true, is_active: true,
    has_api_key: true, has_api_secret: true,
  };
  const result = await supplier360.loadSupplier360(supplier, q);
  expect(result.mappings[0].supplier_price_aed).toBe('12.3400');
  expect(result.execution).toEqual([{ provider: 'cj', provider_status: 'PAID', count: 2 }]);
  expect(result.payments[0]).toEqual(expect.objectContaining({
    status: 'ambiguous', reconciliation_status: 'unverified', currency: 'USD',
    real_debit_verified_count: 0,
  }));
  expect(result.data_quality.credentials_projection).toBe('presence_flags_only');
  expect(result.supplier.capability_certifications.provider).toBe('cj');
  expect(result.supplier.capability_certifications.authority).toBe('observational_proof_only');
  expect(result.supplier.capability_certifications.records.length).toBeGreaterThan(0);
  expect(result.data_quality.capability_status).toBe('certification_ledger_projected_readonly');
  expect(result.data_quality.certification_status).toBe('RECORDED');
  expect(q.query).toHaveBeenCalledTimes(4);
});
