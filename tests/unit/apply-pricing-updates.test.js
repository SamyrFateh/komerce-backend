'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/apply-pricing-updates.test.js
 * Couvre services/apply-pricing-updates.js
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/pricing-engine', () => ({ recommend: jest.fn() }));
jest.mock('../../services/economic-price-audit-service', () => ({ recordProductPriceChange: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const db = require('../../db');
const pricingEngine = require('../../services/pricing-engine');
const { recordProductPriceChange } = require('../../services/economic-price-audit-service');
const { applySinglePrice, applyAllPrices, computeServerSurvival } = require('../../services/apply-pricing-updates');

const ADMIN = { id: 'admin-1', role: 'admin' };

function makeClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
}

describe('computeServerSurvival', () => {
  beforeEach(() => jest.clearAllMocks());

  it('nominal → retourne le survival_price_kmf calcule', async () => {
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 5000 });
    const result = await computeServerSurvival({ id: 'p1', category: 'electro', cost_kmf: 3000, weight_kg: 1, price_kmf: 6000 });
    expect(result).toBe(5000);
  });

  it('survival_price_kmf absent/zero → retourne null', async () => {
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 0 });
    const result = await computeServerSurvival({ id: 'p1' });
    expect(result).toBeNull();
  });

  it('survival_price_kmf non numerique → retourne null', async () => {
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 'NaN' });
    const result = await computeServerSurvival({ id: 'p1' });
    expect(result).toBeNull();
  });

  it('pricingEngine.recommend rejette → catch, retourne null (pas de crash)', async () => {
    pricingEngine.recommend.mockRejectedValue(new Error('pricing engine down'));
    const result = await computeServerSurvival({ id: 'p1' });
    expect(result).toBeNull();
  });

  it('volume_m3 absent → fallback 0.005 transmis au moteur', async () => {
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 1000 });
    await computeServerSurvival({ id: 'p1', category: 'x', cost_kmf: 100, weight_kg: 1, price_kmf: 200 });
    expect(pricingEngine.recommend).toHaveBeenCalledWith(expect.objectContaining({ volume_m3: 0.005 }));
  });
});

describe('applySinglePrice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('utilisateur non admin → 403', async () => {
    const result = await applySinglePrice({ productId: 'p1', priceKmf: 1000, user: { id: 'u1', role: 'client' } });
    expect(result.status).toBe(403);
  });

  it('utilisateur absent → 403', async () => {
    const result = await applySinglePrice({ productId: 'p1', priceKmf: 1000, user: null });
    expect(result.status).toBe(403);
  });

  it('productId manquant → 400', async () => {
    const result = await applySinglePrice({ priceKmf: 1000, user: ADMIN });
    expect(result.status).toBe(400);
  });

  it('priceKmf invalide (NaN ou <= 0) → 400', async () => {
    const r1 = await applySinglePrice({ productId: 'p1', priceKmf: 'pas-un-nombre', user: ADMIN });
    expect(r1.status).toBe(400);
    const r2 = await applySinglePrice({ productId: 'p1', priceKmf: -10, user: ADMIN });
    expect(r2.status).toBe(400);
  });

  it('produit introuvable → 404, ROLLBACK', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT product → not found
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const result = await applySinglePrice({ productId: 'p1', priceKmf: 1000, user: ADMIN });
    expect(result.status).toBe(404);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('prix sous le seuil de survie serveur → 400 below_survival_server, ROLLBACK', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit', price_kmf: 6000, cost_kmf: 3000 }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 5000 });

    const result = await applySinglePrice({ productId: 'p1', priceKmf: 4000, user: ADMIN });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('below_survival_server');
    expect(result.body.survival_price_kmf).toBe(5000);
  });

  it('nominal → 200, COMMIT, audit enregistre', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit', price_kmf: 4000, cost_kmf: 2000 }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit', price_kmf: 5000 }] }) // UPDATE RETURNING
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 3000 });
    recordProductPriceChange.mockResolvedValue({ id: 'audit-1' });

    const result = await applySinglePrice({ productId: 'p1', priceKmf: 5000, user: ADMIN, source: 'manual' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.old_price_kmf).toBe(4000);
    expect(result.body.new_price_kmf).toBe(5000);
    expect(result.body.audit).toEqual({ id: 'audit-1' });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(recordProductPriceChange).toHaveBeenCalledWith(client, expect.objectContaining({
      productId: 'p1', oldPriceKmf: 4000, newPriceKmf: 5000, appliedBy: 'admin-1',
    }));
  });

  it('erreur en cours de transaction → ROLLBACK puis rethrow, client libere', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('db down')); // SELECT echoue

    await expect(applySinglePrice({ productId: 'p1', priceKmf: 1000, user: ADMIN })).rejects.toThrow('db down');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('applyAllPrices', () => {
  beforeEach(() => jest.clearAllMocks());

  it('utilisateur non admin → 403', async () => {
    const result = await applyAllPrices({ items: [{ product_id: 'p1', price_kmf: 1000 }], user: { id: 'u1', role: 'client' } });
    expect(result.status).toBe(403);
  });

  it('items absent ou vide → 400', async () => {
    const r1 = await applyAllPrices({ user: ADMIN });
    expect(r1.status).toBe(400);
    const r2 = await applyAllPrices({ items: [], user: ADMIN });
    expect(r2.status).toBe(400);
  });

  it('plus de 500 items → 400', async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({ product_id: `p${i}`, price_kmf: 1000 }));
    const result = await applyAllPrices({ items, user: ADMIN });
    expect(result.status).toBe(400);
  });

  it('item invalide (product_id ou price manquant) → classe dans skipped, pas de crash', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query.mockResolvedValue({ rows: [] }); // BEGIN/COMMIT generiques

    const result = await applyAllPrices({
      items: [{ product_id: null, price_kmf: 1000 }, { product_id: 'p1', price_kmf: 'invalide' }],
      user: ADMIN,
    });
    expect(result.status).toBe(200);
    expect(result.body.skipped_count).toBe(2);
    expect(result.body.skipped[0].reason).toBe('invalid_item');
  });

  it('produit introuvable → classe dans skipped (not_found)', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT product not found
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await applyAllPrices({ items: [{ product_id: 'p1', price_kmf: 1000 }], user: ADMIN });
    expect(result.body.skipped).toEqual([{ product_id: 'p1', reason: 'not_found' }]);
  });

  it('prix sous le seuil de survie → classe dans rejected, statut 207', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit', price_kmf: 6000 }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 5000 });

    const result = await applyAllPrices({ items: [{ product_id: 'p1', price_kmf: 4000 }], user: ADMIN });
    expect(result.status).toBe(207);
    expect(result.body.ok).toBe(false);
    expect(result.body.rejected[0].reason).toBe('below_survival_server');
  });

  it('nominal multi-items → tous appliques, audit par item, statut 200', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'P1', price_kmf: 1000 }] }) // SELECT p1
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'P1', price_kmf: 1500 }] }) // UPDATE p1
      .mockResolvedValueOnce({ rows: [{ id: 'p2', name: 'P2', price_kmf: 2000 }] }) // SELECT p2
      .mockResolvedValueOnce({ rows: [{ id: 'p2', name: 'P2', price_kmf: 2500 }] }) // UPDATE p2
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    pricingEngine.recommend.mockResolvedValue({ survival_price_kmf: 0 }); // pas de seuil
    recordProductPriceChange.mockResolvedValue({ id: 'audit-x' });

    const result = await applyAllPrices({
      items: [{ product_id: 'p1', price_kmf: 1500 }, { product_id: 'p2', price_kmf: 2500 }],
      user: ADMIN,
    });
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(2);
    expect(result.body.rejected_count).toBe(0);
    expect(recordProductPriceChange).toHaveBeenCalledTimes(2);
  });

  it('erreur en cours de transaction → ROLLBACK puis rethrow', async () => {
    const client = makeClient();
    db.getClient.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('db crashed'));

    await expect(applyAllPrices({ items: [{ product_id: 'p1', price_kmf: 1000 }], user: ADMIN })).rejects.toThrow('db crashed');
    expect(client.release).toHaveBeenCalled();
  });
});
