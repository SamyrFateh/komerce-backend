'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
const { sameContent, findPriorReception, replayResponse } = require('../../services/hub-receive-idempotency');

const PO = '00000000-0000-0000-0000-000000000301';
const PO2 = '00000000-0000-0000-0000-000000000302';
const SKU = '00000000-0000-0000-0000-000000000501';

describe('sameContent', () => {
  test('même PO et même quantité (SKU absent de la demande) : identique', () => {
    expect(sameContent([{ purchase_order_id: PO, quantity: 2 }], [{ purchase_order_id: PO, product_sku_id: SKU, quantity: 2 }])).toBe(true);
  });
  test('quantité différente : différent', () => {
    expect(sameContent([{ purchase_order_id: PO, quantity: 3 }], [{ purchase_order_id: PO, quantity: 2 }])).toBe(false);
  });
  test('SKU fourni et différent : différent', () => {
    expect(sameContent([{ purchase_order_id: PO, product_sku_id: SKU, quantity: 2 }], [{ purchase_order_id: PO, product_sku_id: 'autre', quantity: 2 }])).toBe(false);
  });
  test('PO supplémentaire ou manquante : différent', () => {
    expect(sameContent([{ purchase_order_id: PO, quantity: 1 }, { purchase_order_id: PO2, quantity: 1 }], [{ purchase_order_id: PO, quantity: 2 }])).toBe(false);
  });
  test('lignes éclatées du même PO : agrégées', () => {
    expect(sameContent([{ purchase_order_id: PO, quantity: 2 }], [{ purchase_order_id: PO, quantity: 1 }, { purchase_order_id: PO, quantity: 1 }])).toBe(true);
  });
});

describe('replayResponse', () => {
  const unit = { id: 'u1', reference: 'SUP-1', state: 'RECEIVED' };
  test('contenu identique : 200 déjà traité', () => {
    const res = replayResponse({ unit, contents: [{ purchase_order_id: PO, quantity: 2 }] }, [{ purchase_order_id: PO, quantity: 2 }]);
    expect(res.status).toBe(200);
    expect(res.body.idempotent_replay).toBe(true);
  });
  test('quarantaine identique : 200 déjà traité et signalée en quarantaine', () => {
    const res = replayResponse({ unit: { ...unit, state: 'QUARANTINED' }, contents: [{ purchase_order_id: PO, quantity: 2 }] }, [{ purchase_order_id: PO, quantity: 2 }]);
    expect(res.status).toBe(200);
    expect(res.body.quarantined).toBe(true);
  });
  test('contenu différent ou illisible : 409 conflit contrôlé', () => {
    expect(replayResponse({ unit, contents: [{ purchase_order_id: PO, quantity: 1 }] }, [{ purchase_order_id: PO, quantity: 2 }]).status).toBe(409);
    expect(replayResponse({ unit, contents: null }, [{ purchase_order_id: PO, quantity: 2 }]).body.code).toBe('HUB_RECEPTION_REFERENCE_CONFLICT');
  });
});

describe('findPriorReception', () => {
  test('référence vide ou inconnue : aucune antériorité', async () => {
    const exec = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await findPriorReception('  ', exec)).toBeNull();
    expect(await findPriorReception('SUP-NEW', exec)).toBeNull();
  });
  test('unité non fournisseur sous la même référence : conflit (contenu null)', async () => {
    const exec = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'u', reference: 'X', unit_type: 'MARKET_PARCEL', state: 'RECEIVED' }] }) };
    expect((await findPriorReception('X', exec)).contents).toBeNull();
  });
  test('lecture seule : aucune requête d’écriture', async () => {
    const exec = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'u', reference: 'X', unit_type: 'SUPPLIER_PACKAGE', state: 'RECEIVED' }] }) };
    await findPriorReception('X', exec);
    expect(exec.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });
});
