'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

  test('Lot C5 — cost_price_kmf (legacy) est mappé vers cost_kmf, pas de double-write', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'p1' }] });
    await sourcingMutations.updateProduct('p1', { cost_price_kmf: 500 });

    const sql    = db.query.mock.calls[0][0];
    const params = db.query.mock.calls[0][1];
    expect(sql).toMatch('cost_kmf');
    expect(sql).not.toMatch('cost_price_kmf');
    expect(params).toContain(500);
  });

  test('Lot C5 — weight_g (legacy) est mappé vers weight_kg converti, pas de double-write', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'p1' }] });
    await sourcingMutations.updateProduct('p1', { weight_g: 1500 });

    const sql    = db.query.mock.calls[0][0];
    const params = db.query.mock.calls[0][1];
    expect(sql).toMatch('weight_kg');
    expect(sql).not.toMatch('weight_g');
    // 1500g → 1.50kg
    expect(params).toContain(1.5);
  });

  test('weight_g invalide (<=0 ou non numérique) → mappé à null', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'p1' }] });
    await sourcingMutations.updateProduct('p1', { weight_g: 0 });

    const params = db.query.mock.calls[0][1];
    expect(params).toContain(null);
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

  test('variante non-objet (ex: string dans le tableau) → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', ['pas-un-objet']);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('doit être un objet');
  });

  test('variante sans value → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [variant('couleur', '')]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('value requis');
  });

  test('variante avec type trop long (>50) → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [variant('x'.repeat(51), 'rouge')]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('type trop long');
  });

  test('variante avec value trop longue (>50) → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [variant('couleur', 'x'.repeat(51))]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('value trop long');
  });

  test('variante avec stock invalide (non entier) → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [{ ...variant('couleur', 'rouge'), stock: 1.5 }]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('stock invalide');
  });

  test('variante avec stock négatif → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [{ ...variant('couleur', 'rouge'), stock: -1 }]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('stock invalide');
  });

  test('variante avec price_kmf invalide (non entier) → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [{ ...variant('couleur', 'rouge'), price_kmf: 12.5 }]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('price_kmf invalide');
  });

  test('variante avec price_kmf négatif → 400', async () => {
    const client = makeClient([{}, { rows: [{ id: 'p1' }] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', [{ ...variant('couleur', 'rouge'), price_kmf: -5 }]);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('price_kmf invalide');
  });

  test('stock/price_kmf null ou undefined sont acceptés (pas de validation déclenchée)', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'p1' }] }, { rows: [] }, {}, {}, {}, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    const result = await sourcingMutations.replaceVariants('p1', [{ ...variant('couleur', 'rouge'), stock: null, price_kmf: undefined }]);
    expect(result.status).toBe(200);
  });

  test('variante avec stock et price_kmf valides (entiers >=0) + sku/image_url/display_order fournis → insérée telle quelle', async () => {
    const full = { type: 'couleur', value: 'rouge', sku: ' SKU1 ', stock: 10, price_kmf: 5000, image_url: ' http://x/1.png ', display_order: 2 };
    const client = makeClient([
      {},                        // BEGIN
      { rows: [{ id: 'p1' }] }, // SELECT FOR UPDATE
      { rows: [] },              // SELECT old variants
      {},                        // DELETE
      {},                        // INSERT
      {},                        // UPDATE has_variants
      {},                        // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    const result = await sourcingMutations.replaceVariants('p1', [full]);

    expect(result.status).toBe(200);
    const insertCall = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO product_variants'));
    expect(insertCall[1]).toEqual(['p1', 'couleur', 'rouge', 'SKU1', 10, 5000, 'http://x/1.png', JSON.stringify(['http://x/1.png']), 2]);
  });

  test('garde-fou : commandes pending existent mais ne référencent aucune variante supprimée → pas de 409', async () => {
    const oldRows      = [{ variant_type: 'couleur', variant_value: 'rouge' }];
    const pendingItems = [{ variant_combo: { couleur: 'vert' }, status: 'pending' }];

    const client = makeClient([
      {},                             // BEGIN
      { rows: [{ id: 'p1' }] },      // SELECT FOR UPDATE
      { rows: oldRows },              // SELECT old variants
      { rows: pendingItems },         // SELECT pending order_items (aucune correspondance)
      {},                             // DELETE
      {},                             // INSERT
      {},                             // UPDATE has_variants
      {},                             // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    const result = await sourcingMutations.replaceVariants('p1', [variant('couleur', 'bleu')]);
    expect(result.status).toBe(200);
  });

  test('erreur inattendue pendant la transaction → ROLLBACK, propage, release appelé', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'p1' }] }) // SELECT FOR UPDATE
        .mockRejectedValueOnce(new Error('db down')) // SELECT old variants échoue
        .mockResolvedValueOnce({}), // ROLLBACK
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    await expect(sourcingMutations.replaceVariants('p1', [variant('couleur', 'rouge')])).rejects.toThrow('db down');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('variants non-tableau → 400', async () => {
    const client = makeClient([{}, {}]); // BEGIN, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await sourcingMutations.replaceVariants('p1', 'pas-un-tableau');
    expect(result.status).toBe(400);
  });
});
