'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/market-delegation-service', () => ({ audit: jest.fn(async () => {}) }));
jest.mock('../../services/market-transport-sale-rates', () => ({
  RATE_KEYS: ['SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE'],
  convertRateToKmfPerKg: jest.fn(async () => ({ kmf: 65, conversion: { pivot: 'EUR', legs: [] } })),
}));
const writer = require('../../services/market-transport-sale-rate-writer');
const delegation = require('../../services/market-delegation-service');
const fx = require('../../services/market-transport-sale-rates');

function client(old = null) {
  const calls = [];
  const next = { id: 'rate-new', rate_key: 'SEA_KMF_PER_KG_COMMERCIAL', rate_per_kg: '86.6700', currency: 'XAF', evidence_ref: 'RECETTE-CM-2026-11-07', set_by: 'admin' };
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM markets')) return { rows: [{ id: 'market-cm', code: 'CM', currency: 'XAF' }] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
    if (sql.includes('FOR UPDATE')) return { rows: old ? [old] : [] };
    if (sql.includes('INSERT INTO market_transport_sale_rates')) return { rows: [next] };
    return { rows: [] };
  });
  return { query, calls };
}
const args = { actorUserId: 'admin', code: 'CM', key: 'SEA_KMF_PER_KG_COMMERCIAL', ratePerKg: '86.6700', currency: 'XAF', evidence: 'RECETTE-CM-2026-11-07', reason: 'Tarif provisoire de certification', correlationId: 'e2e-cm' };

beforeEach(() => jest.clearAllMocks());

test('rejette prix nul, format à précision excessive et clés non supportées', () => {
  expect(() => writer.canonicalRate('0')).toThrow();
  expect(() => writer.canonicalRate('1.00001')).toThrow();
  expect(() => writer.canonicalRate('1e3')).toThrow();
  expect(() => writer.rateKey('OTHER')).toThrow();
  expect(() => writer.evidenceRef('')).toThrow();
});
test('refuse devise différente avant toute mutation', async () => {
  const db = client();
  await expect(writer.set(db, { ...args, currency: 'KMF' })).rejects.toMatchObject({ code: 'MARKET_TRANSPORT_CURRENCY_MISMATCH' });
  expect(db.calls.filter(c => /UPDATE |INSERT INTO/.test(c.sql))).toHaveLength(0);
  expect(fx.convertRateToKmfPerKg).not.toHaveBeenCalled();
});
test('crée le tarif par la transaction appelante, avec audit', async () => {
  const db = client();
  const result = await writer.set(db, args);
  expect(result.unchanged).toBe(false);
  expect(result.rate.currency).toBe('XAF');
  expect(db.calls.map(c => c.sql).join(' ')).toContain('pg_advisory_xact_lock');
  expect(db.calls.filter(c => c.sql.includes('INSERT INTO market_transport_sale_rates'))).toHaveLength(1);
  expect(fx.convertRateToKmfPerKg).toHaveBeenCalledWith('86.6700', 'XAF', { client: db });
  expect(delegation.audit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'MARKET_TRANSPORT_SALE_RATE_SET', actorUserId: 'admin', marketId: 'market-cm' }));
});
test('révoque la valeur ancienne et conserve la preuve', async () => {
  const db = client({ id: 'old', rate_key: args.key, rate_per_kg: '70', currency: 'XAF', evidence_ref: 'OLD' });
  await writer.set(db, args);
  expect(db.calls.find(c => c.sql.startsWith('UPDATE market_transport_sale_rates')).params).toEqual(['old']);
  expect(delegation.audit).toHaveBeenCalledWith(db, expect.objectContaining({ before: expect.objectContaining({ id: 'old' }) }));
});
test('saisie identique idempotente sans écriture ni audit', async () => {
  const db = client({ id: 'old', rate_key: args.key, rate_per_kg: args.ratePerKg, currency: 'XAF', evidence_ref: args.evidence });
  const result = await writer.set(db, args);
  expect(result.unchanged).toBe(true);
  expect(db.calls.filter(c => /UPDATE |INSERT INTO/.test(c.sql))).toHaveLength(0);
  expect(delegation.audit).not.toHaveBeenCalled();
});
test('la route est limitée au rôle admin et utilise une transaction', () => {
  const fs = require('fs'); const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin-market-control-plane.js'), 'utf8');
  expect(source).toMatch(/router\.put\('\/:marketCode\/transport-sale-rates\/:rateKey', \.\.\.centralAdmin/);
  expect(source).toMatch(/router\.get\('\/:marketCode\/transport-sale-rates', \.\.\.centralAdmin/);
  expect(source).toMatch(/withTransaction\(client => transportSaleRates\.set/);
});
