'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const supplier360 = require('../../public/dashboards/canonical/js/supplier-360');

test('supplierIdFromPath accepte uniquement la fiche fournisseur', () => {
  expect(supplier360.supplierIdFromPath('/admin/suppliers/11111111-1111-4111-8111-111111111111'))
    .toBe('11111111-1111-4111-8111-111111111111');
  expect(supplier360.supplierIdFromPath('/admin/suppliers')).toBeNull();
  expect(supplier360.supplierIdFromPath('/admin/suppliers/a/b')).toBeNull();
});

test('metricItems compte seulement les faits projetés sans score inventé', () => {
  const metrics = supplier360.metricItems({
    mappings: [{ is_active: true }, { is_active: false }],
    purchase_orders: [{}, {}],
    execution: [{ count: 3 }, { count: 2 }],
    payments: [{ count: 4 }],
  });
  expect(metrics.map(row => row.value)).toEqual(['1', '2', '5', '4']);
  expect(metrics.map(row => row.key)).toEqual(['mappings', 'po', 'execution', 'payments']);
});

test('certificationRows garde disponibilité, environnement, preuve et limites séparés', () => {
  expect(supplier360.certificationRows({
    records: [{
      capability: 'purchasing.manual_procurement',
      availability: 'PROVEN',
      environment: 'SANDBOX',
      highest_proof: 'P4',
      classification: 'RECLASSIFIED',
      evidence: ['proof/a', 'proof/b'],
      limitations: ['human buyer'],
    }],
  })).toEqual([{
    capability: 'purchasing.manual_procurement',
    availability: 'PROVEN',
    environment: 'SANDBOX',
    proof: 'P4',
    classification: '↻ RECLASSIFIED',
    evidence: 'proof/a · proof/b',
    limitations: 'human buyer',
  }]);
});

test('mount charge le namespace Supplier 360', async () => {
  const root = {};
  const fetch = jest.fn().mockResolvedValue({
    ok: false, status: 404, json: jest.fn().mockResolvedValue({ error: 'Fournisseur introuvable' }),
  });
  const ui = { UIState: { render: jest.fn() } };
  await expect(supplier360.mount({
    root, document: {}, ui, fetch,
    pathname: '/admin/suppliers/11111111-1111-4111-8111-111111111111',
  })).rejects.toThrow('Fournisseur introuvable');
  expect(fetch).toHaveBeenCalledWith(
    '/api/admin/entities/suppliers/11111111-1111-4111-8111-111111111111',
    expect.objectContaining({ method: 'GET', credentials: 'include' })
  );
});

describe('Supplier 360 — registre de preuves affiché littéralement', () => {
  const supplier360 = require('../../public/dashboards/canonical/js/supplier-360');
  test('GAP est visuellement distinct de CONFIRMED, valeurs du registre conservées', () => {
    const rows = supplier360.certificationRows({ records: [
      { capability: 'purchasing.real_debit', availability: 'available', environment: 'live', highest_proof: 'P4', classification: 'CONFIRMED' },
      { capability: 'reconcile_payment', availability: 'unavailable', environment: 'sandbox', highest_proof: null, classification: 'GAP' },
      { capability: 'x', classification: null },
    ] });
    expect(rows[0].classification).toBe('✓ CONFIRMED');
    expect(rows[0].proof).toBe('P4');
    expect(rows[0].environment).toBe('live');
    expect(rows[1].classification).toBe('✖ GAP — non disponible');
    expect(rows[1].proof).toBe('— aucune preuve');
    expect(rows[2].classification).toBe('? non classé');
    expect(rows[1].classification).not.toBe(rows[0].classification);
  });
});
