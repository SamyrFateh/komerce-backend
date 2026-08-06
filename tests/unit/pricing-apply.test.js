'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pricing-apply.test.js
 *
 * Couvre services/pricing-apply.js (REFACTO-R1), extrait de
 * routes/pricing.js (PUT /apply-price/:id, PUT /apply-all) :
 *
 *   ✅ applyPrice nominal → product mis à jour + price_history (scenario_*)
 *   ✅ applyPrice price_kmf invalide → 400
 *   ✅ applyPrice produit introuvable → 404
 *   ✅ applyPrice sous le seuil de survie → 400 + code: 'below_survival'
 *   ✅ applyPrice fallback price_history (colonnes scenario_* absentes)
 *   ✅ applyAll batch nominal → products mis à jour, items invalides ignorés
 *   ✅ applyAll items vide/absent → 400
 *   ✅ applyAll > 500 items → 400
 */

const { makeClient, expectTransactionCommitted } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const db = require('../../db');
const { applyPrice, applyAll } = require('../../services/pricing-apply');

describe('pricing-apply', () => {
  describe('applyPrice', () => {
    it('refuse price_kmf invalide (0, négatif, absent) sans requête DB', async () => {
      const result = await applyPrice('prod-1', { price_kmf: 0 }, 'user-1');
      expect(result).toEqual({ status: 400, body: { error: 'price_kmf invalide' } });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('404 si produit introuvable', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // SELECT product

      const result = await applyPrice('prod-x', { price_kmf: 1000 }, 'user-1');

      expect(result).toEqual({ status: 404, body: { error: 'Produit introuvable' } });
    });

    it('400 + code below_survival si prix < survival_price_kmf', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 5000 }] });

      const result = await applyPrice('prod-1', { price_kmf: 800, survival_price_kmf: 1000 }, 'user-1');

      expect(result).toEqual({
        status: 400,
        body: {
          error: 'Prix sous le seuil de survie : refusé par doctrine.',
          code: 'below_survival',
          survival_price_kmf: 1000,
          attempted_price_kmf: 800,
        },
      });
      // Aucune écriture (ni UPDATE ni price_history) après le refus
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('nominal → UPDATE products + INSERT price_history (avec scenario_*)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 5000 }] }) // SELECT
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 6000 }] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }); // INSERT price_history (avec scenario_*)

      const result = await applyPrice('prod-1', {
        price_kmf: 6000,
        source: 'manual',
        scenario_id: 'sc-1',
        scenario_label: 'Hausse saison',
        levier: 'demande',
      }, 'user-1');

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          product: { id: 'prod-1', name: 'Robe', price_kmf: 6000 },
          old_price_kmf: 5000,
          new_price_kmf: 6000,
          scenario_id: 'sc-1',
          levier: 'demande',
        },
      });

      const insertCall = db.query.mock.calls[2];
      expect(insertCall[0]).toMatch(/INSERT INTO price_history/);
      expect(insertCall[0]).toMatch(/scenario_id, scenario_label, levier/);
      expect(insertCall[1]).toEqual(['prod-1', 5000, 6000, 'manual', 'user-1', 'sc-1', 'Hausse saison', 'demande']);
    });

    it('fallback gracieux si colonnes scenario_* absentes (insert simplifié)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 5000 }] }) // SELECT
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 6000 }] }) // UPDATE
        .mockRejectedValueOnce(new Error('column "scenario_id" does not exist')) // INSERT (colonnes scenario_*)
        .mockResolvedValueOnce({ rows: [] }); // INSERT fallback simplifié

      const result = await applyPrice('prod-1', { price_kmf: 6000 }, 'user-1');

      expect(result.status).toBe(200);
      expect(result.body.ok).toBe(true);

      // 4 appels : SELECT, UPDATE, INSERT (échoue), INSERT fallback
      expect(db.query).toHaveBeenCalledTimes(4);
      const fallbackInsert = db.query.mock.calls[3];
      expect(fallbackInsert[0]).toMatch(/INSERT INTO price_history \(product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at\)/);
      expect(fallbackInsert[1]).toEqual(['prod-1', 5000, 6000, 'manual', 'user-1']);
    });

    it('reste 200 même si les deux INSERT price_history échouent (table optionnelle)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 5000 }] }) // SELECT
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1', name: 'Robe', price_kmf: 6000 }] }) // UPDATE
        .mockRejectedValueOnce(new Error('relation price_history does not exist')) // INSERT 1
        .mockRejectedValueOnce(new Error('relation price_history does not exist')); // INSERT fallback

      const result = await applyPrice('prod-1', { price_kmf: 6000 }, 'user-1');

      expect(result.status).toBe(200);
      expect(result.body.product).toEqual({ id: 'prod-1', name: 'Robe', price_kmf: 6000 });
    });
  });

  describe('applyAll', () => {
    it('400 si items absent ou vide', async () => {
      expect(await applyAll(undefined)).toEqual({ status: 400, body: { error: 'items array requis' } });
      expect(await applyAll([])).toEqual({ status: 400, body: { error: 'items array requis' } });
      expect(db.getClient).not.toHaveBeenCalled();
    });

    it('400 si > 500 items', async () => {
      const items = new Array(501).fill({ product_id: 'p1', price_kmf: 1000 });
      expect(await applyAll(items)).toEqual({ status: 400, body: { error: 'max 500 items par batch' } });
      expect(db.getClient).not.toHaveBeenCalled();
    });

    it('batch nominal → met à jour les items valides, ignore les invalides', async () => {
      const client = makeClient([
        { rows: [{ id: 'p1', name: 'Robe', price_kmf: 1000 }], rowCount: 1 }, // UPDATE p1
        { rows: [{ id: 'p3', name: 'Sac', price_kmf: 3000 }], rowCount: 1 },  // UPDATE p3
      ]);
      db.getClient.mockResolvedValue(client);

      const items = [
        { product_id: 'p1', price_kmf: 1000 },
        { product_id: 'p2', price_kmf: 0 },       // invalide → ignoré
        { price_kmf: 3000 },                       // product_id manquant → ignoré
        { product_id: 'p3', price_kmf: 3000 },
      ];

      const result = await applyAll(items);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        ok: true,
        count: 2,
        products: [
          { id: 'p1', name: 'Robe', price_kmf: 1000 },
          { id: 'p3', name: 'Sac', price_kmf: 3000 },
        ],
      });
      expectTransactionCommitted(client);

      // Seules les 2 UPDATE valides ont été exécutées (+ BEGIN/COMMIT)
      const updates = client.calls.filter(c => /UPDATE products/.test(c.sql));
      expect(updates).toHaveLength(2);
    });
  });
});
