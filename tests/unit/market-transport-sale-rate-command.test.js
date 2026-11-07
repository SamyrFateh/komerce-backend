'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/market-delegation-service', () => ({ audit: jest.fn() }));
const delegation = require('../../services/market-delegation-service');
const rates = require('../../services/market-transport-sale-rate-command');

const mk = { id: '11111111-1111-4111-8111-111111111111', code: 'CM', currency: 'XAF', lifecycle_status: 'ACTIVE' };
const actor = '22222222-2222-4222-8222-222222222222';
const base = { marketCode: 'CM', rateKey: 'SEA_KMF_PER_KG_COMMERCIAL', ratePerKg: '86.6713',
  currency: 'XAF', evidenceRef: 'RECETTE-CM-2026-11-07', reason: 'Essai staging, non commercialisable', actorUserId: actor };

beforeEach(() => jest.clearAllMocks());

describe('tarifs de vente transport gouvernés', () => {
  test('validation stricte: aucun prix nul, négatif, exponentiel ou arrondi implicite', () => {
    for (const invalid of [0, -1, '0.0000', '1.00001', '1e3', null, '99999999999', '']) {
      expect(() => rates.validRate(invalid)).toThrow();
    }
    expect(rates.validRate('86.6713')).toBe('86.6713');
    expect(() => rates.validKey('FREIGHT_KMF_PER_KG')).toThrow();
    expect(() => rates.validMarketCode('CM; DELETE')).toThrow();
  });

  test('écriture versionnée, même transaction, avec pièce, auteur, motif et audit', async () => {
    const old = { id: 'old-id', rate_key: base.rateKey, rate_per_kg: '100', currency: 'XAF', evidence_ref: 'OLD' };
    const next = { id: 'new-id', rate_key: base.rateKey, rate_per_kg: base.ratePerKg,
      currency: 'XAF', evidence_ref: base.evidenceRef, set_by: actor };
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [mk] })
      .mockResolvedValueOnce({ rows: [old] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [next] }) };
    const res = await rates.setSaleRate(executor, base);
    expect(res.changed).toBe(true);
    expect(res.rate.id).toBe('new-id');
    expect(executor.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(executor.query.mock.calls[2][0]).toContain('revoked_at = NOW()');
    expect(executor.query.mock.calls[3][0]).toContain('INSERT INTO market_transport_sale_rates');
    expect(executor.query.mock.calls[3][1]).toEqual([mk.id, base.rateKey, base.ratePerKg, 'XAF', base.evidenceRef, actor]);
    expect(delegation.audit).toHaveBeenCalledWith(executor, expect.objectContaining({
      actorUserId: actor, marketId: mk.id, action: 'MARKET_TRANSPORT_SALE_RATE_SET',
      before: old, after: expect.objectContaining({ id: 'new-id', reason: base.reason }),
    }));
  });

  test('même valeur et même preuve: idempotent, sans réécriture ni audit', async () => {
    const row = { rate_per_kg: base.ratePerKg, evidence_ref: base.evidenceRef, rate_key: base.rateKey };
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [mk] })
      .mockResolvedValueOnce({ rows: [row] }) };
    expect((await rates.setSaleRate(executor, base)).changed).toBe(false);
    expect(executor.query).toHaveBeenCalledTimes(2);
    expect(delegation.audit).not.toHaveBeenCalled();
  });

  test('refus devise différente et justificatif manquant avant toute écriture', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [mk] }) };
    await expect(rates.setSaleRate(executor, { ...base, currency: 'KMF' }))
      .rejects.toMatchObject({ code: 'TRANSPORT_SALE_CURRENCY_MISMATCH', status: 422 });
    expect(executor.query).toHaveBeenCalledTimes(1);
    await expect(rates.setSaleRate(executor, { ...base, evidenceRef: '' }))
      .rejects.toMatchObject({ code: 'TRANSPORT_SALE_EVIDENCE_REQUIRED' });
    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(delegation.audit).not.toHaveBeenCalled();
  });

  test('lecture limitée au marché, historique désactivé par défaut', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [mk] })
      .mockResolvedValueOnce({ rows: [{ rate_key: base.rateKey, rate_per_kg: '86.6713' }] }) };
    const out = await rates.listSaleRates(executor, { marketCode: 'CM' });
    expect(out.market).toBe('CM');
    expect(out.currency).toBe('XAF');
    expect(out.rates).toHaveLength(1);
    expect(executor.query.mock.calls[1][0]).toContain('revoked_at IS NULL');
    expect(executor.query.mock.calls[1][1]).toEqual([mk.id]);
  });
});

describe('route centralisée', () => {
  const fs = require('fs');
  const path = require('path');
  const route = fs.readFileSync(path.join(__dirname, '../../routes/admin-market-control-plane.js'), 'utf8');
  test('GET et PUT réservés à admin central; PUT transactionnel', () => {
    expect(route).toMatch(/router\.get\('\/:marketCode\/transport-sale-rates', \.\.\.centralAdmin/);
    expect(route).toMatch(/router\.put\('\/:marketCode\/transport-sale-rates\/:rateKey', \.\.\.centralAdmin/);
    expect(route).toContain('withTransaction(client => transportSale.setSaleRate(client, {');
  });
});
