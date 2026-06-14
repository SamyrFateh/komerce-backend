'use strict';

/**
 * Tests unitaires — services/sourcing-mutations.js (REFACTO-R2)
 *
 * Couverture :
 *   updateProduct    — nominal, aucun champ, introuvable, sync colonnes sœurs
 *   bulkAssignRail   — nominal, rail invalide, params manquants
 *   replaceVariants  — nominal, vide (supprime tout), doublons, garde-fou pending,
 *                      variante invalide, > 50 variantes
 */

jest.mock('../../db');
jest.mock('../../services/sourcing-analysis');

const db               = require('../../db');
const sourcingAnalysis = require('../../services/sourcing-analysis');
const sourcingMutations = require('../../services/sourcing-mutations');

function makeClient(queryResponses = []) {
  let callIdx = 0;
  return {
    query: jest.fn().mockImplementation(() => {
      const r = queryResponses[callIdx++];
      return Promise.resolve(r ?? { rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sourcingAnalysis.loadSourcingConfig.mockResolvedValue({});
  sourcingAnalysis.getSales30d.mockResolvedValue({});
  sourcingAnalysis.analyzeProduct.mockReturnValue({ id: 'p1', analyzed: true });
});

// ─── updateProduct ────────────────────────────────────────────────────────────

describe('updateProduct', () => {
  test('nominal — met à jour sourcing_rail et retourne une analyse', async () => {
    const product = { id: 'p1', sourcing_rail: 'B' };
    db.query.mockResolvedValue({ rows: [product] });

    const result = await sourcingMutations.updateProduct('p1', { sourcing_rail: 'B' });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(sourcingAnalysis.analyzeProduct).toHaveBeenCalled();
  });

  test('aucun champ autorisé fourni → 400', async () => {
    const result = await sourcingMutations.updateProduct('p1', { champ_inconnu: 'x' });
    expect(result.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('produit introuvable → 404', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await sourcingMutations.updateProduct('xxx', { sourcing_rail: 'A' });
    expect(result.status).toBe(404);
  });

  test('sync colonnes sœurs : cost_price_kmf écrit aussi cost_kmf', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'p1' }] });
    await sourcingMutations.updateProduct('p1', { cost_price_kmf: 500 });

    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch('cost_price_kmf');
    expect(sql).toMatch('cost_kmf');
  });

  test('sync colonnes sœurs : weight_g écrit aussi weight_kg converti', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'p1' }] });
    await sourcingMutations.updateProduct('p1', { weight_g: 1500 });

    const sql    = db.query.mock.calls[0][0];
    const params = db.query.mock.calls[0][1];
    expect(sql).toMatch('weight_g');
    expect(sql).toMatch('weight_kg');
    // 1500g → 1.50kg
    expect(params).toContain(1.5);
  });
});

// ─── bulkAssignRail ───────────────────────────────────────────────────────────

describe('bulkAssignRail', () => {
  test('nominal — assigne rail A à 3 produits', async () => {
    db.query.mockResolvedValue({ rowCount: 3 });
    const result = await sourcingMutations.bulkAssignRail(['p1', 'p2', 'p3'], 'a');

    expect(result.status).toBe(200);
    expect(result.body.updated).toBe(3);
    // Rail normalisé en majuscule
    expect(db.query.mock.calls[0][1][0]).toBe('A');
  });

  test('rail invalide → 400', async () => {
    const result = await sourcingMutations.bulkAssignRail(['p1'], 'Z');
    expect(result.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('params manquants → 400', async () => {
    const result = await sourcingMutations.bulkAssignRail(null, 'A');
    expect(result.status).toBe(400);
  });
});

// ─── replaceVariants ─────────────────────────────────────────────────────────

describe('replaceVariants', () => {
  const variant = (type, value) => ({ type, value });

  test('nominal — remplace 2 variantes et retourne 200', async () => {
    const variants = [variant('couleur', 'rouge'), variant('taille', 'M')];
    const client = makeClient([
      {},                             // BEGIN
      { rows: [{ id: 'p1' }] },      // SELECT FOR UPDATE
      { rows: [] },                   // SELECT old variants
      {},                             // DELETE
      {},                             // INSERT variant 1
      {},                             // INSERT variant 2
      {},                             // UPDATE has_variants
      {},                             // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: variants.map((v, i) => ({
      id: i, variant_type: v.type, variant_value: v.value,
    })) });

    const result = await sourcingMutations.replaceVariants('p1', variants);

    expect(result.status).toBe(200);
    expect(result.body.count).toBe(2);
    expect(result.body.has_variants).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  test('tableau vide → supprime tout, has_variants = false', async () => {
    const client = makeClient([
      {},                        // BEGIN
      { rows: [{ id: 'p1' }] }, // SELECT FOR UPDATE
      { rows: [] },              // SELECT old variants
      {},                        // DELETE
      {},                        // UPDATE has_variants = false
      {},                        // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    const result = await sourcingMutations.replaceVariants('p1', []);

    expect(result.status).toBe(200);
    expect(result.body.has_variants).toBe(false);
    expect(result.body.count).toBe(0);
  });

  test('> 50 variantes → 400 + ROLLBACK', async () => {
    const many = Array.from({ length: 51 }, (_, i) => variant('taille', `T${i}`));
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]); // BEGIN, SELECT, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', many);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('50');
  });

  test('doublon (type, value) → 400 + ROLLBACK', async () => {
    const variants = [variant('couleur', 'rouge'), variant('couleur', 'rouge')];
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', variants);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('Doublon');
  });

  test('produit introuvable → 404 + ROLLBACK', async () => {
    const client = makeClient([{}, { rows: [] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('xxx', [variant('c', 'r')]);
    expect(result.status).toBe(404);
  });

  test('garde-fou : variante référencée en commande pending → 409', async () => {
    // Ancienne variante = couleur:rouge (va être supprimée)
    // Nouvelle variante = seulement couleur:bleu
    const oldRows      = [{ variant_type: 'couleur', variant_value: 'rouge' }];
    const pendingItems = [{ variant_combo: { couleur: 'rouge' }, status: 'pending' }];

    const client = makeClient([
      {},                             // BEGIN
      { rows: [{ id: 'p1' }] },      // SELECT FOR UPDATE
      { rows: oldRows },              // SELECT old variants
      { rows: pendingItems },         // SELECT pending order_items
      {},                             // ROLLBACK
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [variant('couleur', 'bleu')]);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch('commande en cours');
  });

  test('variante sans type → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [{ value: 'rouge' }]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('type requis');
  });

  test('variants non-tableau → 400', async () => {
    const client = makeClient([{}, {}]); // BEGIN, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', 'pas-un-tableau');
    expect(result.status).toBe(400);
  });
});
