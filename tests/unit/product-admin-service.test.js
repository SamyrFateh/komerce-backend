'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../services/product-price-audit', () => ({ recordProductPriceChange: jest.fn() }));
jest.mock('../../services/product-publication-guard', () => ({
  auditProductStockChange: jest.fn(),
  validatePublicationUpdate: jest.fn(() => ({ ok: true })),
}));
// Le vrai catalog-overrides.js require('./catalog-enrichment') -> require('../db')
// -> connexion pg reelle instanciee a l'import. Mocke ici comme les autres
// dependances de service (meme pattern que product-publication-guard
// ci-dessus) pour garder ces tests unitaires hors DB.
jest.mock('../../services/catalog-overrides', () => ({
  OVERRIDABLE_FIELDS: ['name', 'description', 'category', 'fragility', 'emoji'],
  isPipelineSourced: jest.fn(() => false),
  upsertOverrides: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const { recordProductPriceChange } = require('../../services/product-price-audit');
const { auditProductStockChange, validatePublicationUpdate } = require('../../services/product-publication-guard');
const { isPipelineSourced, upsertOverrides } = require('../../services/catalog-overrides');
const svc = require('../../services/product-admin-service');

describe('product-admin-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validateProductTaxonomyPayload accepte labsence de categorie', async () => {
    await expect(svc.validateProductTaxonomyPayload({ query: jest.fn() }, {})).resolves.toEqual({ ok: true });
  });

  it('validateProductTaxonomyPayload retourne 422 avec categories valides si categorie inconnue', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ key: 'food', label: 'Food' }] }) };

    await expect(svc.validateProductTaxonomyPayload(db, { category: 'bad' })).resolves.toEqual({
      ok: false,
      status: 422,
      body: { error: 'Catégorie invalide : "bad"', validCategories: [{ key: 'food', label: 'Food' }] },
    });
  });

  it('createProduct refuse les champs obligatoires manquants et les nombres negatifs', async () => {
    const db = { query: jest.fn() };

    await expect(svc.createProduct(db, { name: 'Riz' }, { id: 'admin' }))
      .resolves.toEqual({ status: 400, body: { error: 'Champs obligatoires manquants : name, category, price_kmf' } });
    await expect(svc.createProduct(db, { name: 'Riz', category: 'food', price_kmf: -1 }, { id: 'admin' }))
      .resolves.toEqual({ status: 400, body: { error: 'Le champ "price_kmf" doit être un nombre positif' } });
  });

  it('createProduct insere le produit et audite prix/stock', async () => {
    const product = { id: 'prod-001', name: 'Riz', category: 'food', price_kmf: 1000, stock: 5 };
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ key: 'food' }] })
      .mockResolvedValueOnce({ rows: [product] }) };

    await expect(svc.createProduct(db, { name: 'Riz', category: 'food', price_kmf: 1000, stock: 5 }, { id: 'admin' }))
      .resolves.toEqual({ status: 201, body: product });
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO products'));
    expect(insertCall[0]).toContain('is_available');
    expect(insertCall[0]).toContain('is_active');
    expect(insertCall[1]).toEqual(expect.arrayContaining([false, false]));
    expect(recordProductPriceChange).toHaveBeenCalledWith(db, expect.objectContaining({ productId: 'prod-001', oldPriceKmf: 0, newPriceKmf: 1000 }));
    expect(auditProductStockChange).toHaveBeenCalledWith(db, expect.objectContaining({ productId: 'prod-001', oldStock: null, newStock: 5 }));
  });

  it('createProduct ne publie que sur demande explicite et passe alors par le garde', async () => {
    const product = { id: 'prod-002', name: 'Riz premium', category: 'food', price_kmf: 2000, is_active: true, is_available: true };
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ key: 'food' }] })
      .mockResolvedValueOnce({ rows: [product] }) };

    await expect(svc.createProduct(db, {
      name: 'Riz premium', category: 'food', price_kmf: 2000,
      is_active: true, is_available: true,
    }, { id: 'admin' })).resolves.toEqual({ status: 201, body: product });

    expect(validatePublicationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ is_active: true, is_available: true }),
    }));
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO products'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([true, true]));
  });

  it('updateProduct retourne 404 si produit introuvable', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(svc.updateProduct(db, 'prod-404', { name: 'New' }, { id: 'admin' }))
      .resolves.toEqual({ status: 404, body: { error: 'Produit introuvable' } });
  });

  it('updateProduct audite changement prix et stock', async () => {
    const before = { id: 'prod-001', name: 'Old', category: 'food', subcategory: null, price_kmf: 1000, stock: 1, is_active: true, is_available: true };
    const updated = { ...before, price_kmf: 1500, stock: 3 };
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [updated] }) };

    await expect(svc.updateProduct(db, 'prod-001', { price_kmf: 1500, stock: 3 }, { id: 'admin' }))
      .resolves.toEqual({ status: 200, body: updated });
    expect(recordProductPriceChange).toHaveBeenCalledWith(db, expect.objectContaining({ oldPriceKmf: 1000, newPriceKmf: 1500 }));
    expect(auditProductStockChange).toHaveBeenCalledWith(db, expect.objectContaining({ oldStock: 1, newStock: 3 }));
  });

  it('updateProduct route les champs overridables vers catalog-overrides pour un produit issu du pipeline (§5)', async () => {
    const before = {
      id: 'prod-001', name: 'Old', category: 'food', subcategory: null,
      price_kmf: 1000, stock: 1, is_active: true, is_available: true,
      content_source: 'ai_enriched', lifecycle_status: 'active',
    };
    isPipelineSourced.mockReturnValueOnce(true);
    upsertOverrides.mockResolvedValueOnce({ overridden: ['name'], product: { ...before, name: 'Nom corrigé' } });
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [before] }) };

    const result = await svc.updateProduct(db, 'prod-001', { name: 'Nom corrigé' }, { id: 'admin' });

    expect(upsertOverrides).toHaveBeenCalledWith(
      db, 'prod-001', { name: 'Nom corrigé' }, { reason: null, setBy: 'admin' }
    );
    expect(result).toEqual({ status: 200, body: { ...before, name: 'Nom corrigé' } });
    // Un seul SELECT ("avant") — aucun UPDATE direct sur products puisque
    // tous les champs de la requête sont passés par l'override.
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('updateProduct refuse la publication directe d\'un candidat pipeline non approuvé (§6, code pending_approval)', async () => {
    const before = {
      id: 'prod-002', name: 'Nouveau', category: 'tech', subcategory: null,
      price_kmf: 5000, stock: 2, is_active: false, is_available: true,
      content_source: 'connector_raw', lifecycle_status: 'candidate',
    };
    isPipelineSourced.mockReturnValueOnce(true);
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [before] }) };

    await expect(svc.updateProduct(db, 'prod-002', { is_active: true }, { id: 'admin' }))
      .resolves.toEqual({
        status: 409,
        body: {
          error: 'Fiche candidate en attente d\'approbation — utilisez la file d\'approbation (approve/override), pas une édition directe.',
          code: 'pending_approval',
        },
      });
    expect(upsertOverrides).not.toHaveBeenCalled();
  });

  it('setMainImage et appendImages gerent 404 et ajout premiere image', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', images: null }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    await expect(svc.setMainImage(db, 'missing', 'img.jpg')).resolves.toEqual({ status: 404, body: { error: 'Produit introuvable ou inactif' } });
    await expect(svc.appendImages(db, 'prod-001', ['a.jpg', 'b.jpg'])).resolves.toEqual({
      status: 200,
      body: { product_name: 'Riz', images: ['a.jpg', 'b.jpg'], new_images: ['a.jpg', 'b.jpg'], total_count: 2 },
    });
    expect(db.query.mock.calls[2][1]).toEqual([JSON.stringify(['a.jpg', 'b.jpg']), 'a.jpg', 'prod-001']);
  });

  it('replaceVariants valide le payload avant transaction', async () => {
    await expect(svc.replaceVariants({ getClient: jest.fn() }, 'prod-001', null)).rejects.toMatchObject({ status: 400 });
    await expect(svc.replaceVariants({ getClient: jest.fn() }, 'prod-001', [{ type: '', value: 'M' }])).rejects.toMatchObject({ status: 400 });
    await expect(svc.replaceVariants({ getClient: jest.fn() }, 'prod-001', [{ type: 'Taille', value: 'M', stock: -1 }])).rejects.toMatchObject({ status: 400 });
  });

  it('replaceVariants remplace atomiquement les variantes et relit has_variants', async () => {
    const client = makeClient([
      { rows: [{ id: 'prod-001', name: 'Riz' }] },
      { rows: [], rowCount: 1 },
      { rows: [{ id: 'var-001', variant_type: 'Taille', variant_value: 'M' }] },
    ]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client), query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: true }] }) };

    const result = await svc.replaceVariants(dbPool, 'prod-001', [{ type: ' Taille ', value: ' M ', stock: 2, price_kmf: 1500 }]);

    expect(result).toMatchObject({ product_id: 'prod-001', has_variants: true, count: 1 });
    expect(client.calls[3].params).toEqual(['prod-001', 'Taille', 'M', null, 2, 1500, null, JSON.stringify([]), 0]);
    expectTransactionCommitted(client);
  });

  it('replaceVariants rollback si produit introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    await expect(svc.replaceVariants(dbPool, 'missing', [{ type: 'Taille', value: 'M' }])).rejects.toMatchObject({ status: 404 });
    expectTransactionRolledBack(client);
  });

  it('deleteVariant refuse une variante referencee puis supprime sinon', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'var-001', variant_type: 'Taille', variant_value: 'M' }] }) };

    await expect(svc.deleteVariant(db, 'prod-001', 'var-001')).resolves.toMatchObject({ status: 409 });
    await expect(svc.deleteVariant(db, 'prod-001', 'var-001')).resolves.toMatchObject({ status: 200, body: { deleted: { id: 'var-001', variant_type: 'Taille', variant_value: 'M' } } });
  });

  // ── SKU (Lot 1) ──────────────────────────────────────────────────────────

  describe('getSkuCandidates', () => {
    it('rejette si produit introuvable', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.getSkuCandidates(db, 'missing')).rejects.toMatchObject({ status: 404 });
    });

    it('produit sans variantes : un seul candidat combo=null', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: false, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [] }) };

      await expect(svc.getSkuCandidates(db, 'prod-001')).resolves.toMatchObject({
        has_variants: false,
        candidates: [{ variant_combo: null, declared: false, sku: null }],
      });
    });

    it('produit a variantes : produit cartesien des axes croise avec les SKU declares', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Robe', has_variants: true, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku-001', sku: 'ROBE-N-M', variant_combo: { couleur: 'Noir', taille: 'M' }, stock: 5, price_kmf: null, is_active: true }] })
        .mockResolvedValueOnce({ rows: [
          { variant_type: 'couleur', variant_value: 'Noir' },
          { variant_type: 'couleur', variant_value: 'Blanc' },
          { variant_type: 'taille', variant_value: 'M' },
        ] }) };

      const result = await svc.getSkuCandidates(db, 'prod-001');

      expect(result.candidate_count).toBe(2);
      expect(result.candidates).toEqual(expect.arrayContaining([
        { variant_combo: { couleur: 'Noir', taille: 'M' }, declared: true, sku: expect.objectContaining({ id: 'sku-001' }) },
        { variant_combo: { couleur: 'Blanc', taille: 'M' }, declared: false, sku: null },
      ]));
    });

    it('refuse au-dela de 500 combinaisons possibles (garde-fou anti-explosion)', async () => {
      const values = Array.from({ length: 30 }, (_, i) => `v${i}`);
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'X', has_variants: true, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          ...values.map(v => ({ variant_type: 'a', variant_value: v })),
          ...values.map(v => ({ variant_type: 'b', variant_value: v })),
        ] }) };

      await expect(svc.getSkuCandidates(db, 'prod-001')).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('upsertProductSku', () => {
    it('rejette si produit introuvable', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.upsertProductSku(db, 'missing', { stock: 1 })).rejects.toMatchObject({ status: 404 });
    });

    it('exige variant_combo si le produit a des variantes', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Robe', has_variants: true }] }) };
      await expect(svc.upsertProductSku(db, 'prod-001', { stock: 1 })).rejects.toMatchObject({ status: 400 });
    });

    it('refuse variant_combo si le produit n a pas de variantes', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: false }] }) };
      await expect(svc.upsertProductSku(db, 'prod-001', { stock: 1, variant_combo: { couleur: 'Noir' } })).rejects.toMatchObject({ status: 400 });
    });

    it('exige un stock entier positif', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: false }] }) };
      await expect(svc.upsertProductSku(db, 'prod-001', { stock: -1 })).rejects.toMatchObject({ status: 400 });
    });

    it('rejette un combo qui ne correspond a aucun axe declare', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Robe', has_variants: true }] })
        .mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.upsertProductSku(db, 'prod-001', { stock: 1, variant_combo: { couleur: 'Rose' } }))
        .rejects.toMatchObject({ status: 400 });
    });

    it('declare le SKU par defaut pour un produit sans variantes', async () => {
      const row = { id: 'sku-001', product_id: 'prod-001', sku: null, variant_combo: null, stock: 10, is_active: true };
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: false }] })
        .mockResolvedValueOnce({ rows: [row] }) };

      await expect(svc.upsertProductSku(db, 'prod-001', { stock: 10 })).resolves.toMatchObject({ sku: row });
    });

    it('declare un SKU pour une combinaison valide', async () => {
      const row = { id: 'sku-002', product_id: 'prod-001', sku: 'ROBE-N-M', variant_combo: { couleur: 'Noir', taille: 'M' }, stock: 3, is_active: true };
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Robe', has_variants: true }] })
        .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // couleur=Noir existe
        .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // taille=M existe
        .mockResolvedValueOnce({ rows: [row] }) };

      await expect(svc.upsertProductSku(db, 'prod-001', { stock: 3, variant_combo: { taille: 'M', couleur: 'Noir' }, sku: 'ROBE-N-M' }))
        .resolves.toMatchObject({ sku: row });
    });
  });

  describe('deactivateProductSku', () => {
    it('retourne 404 si le SKU n existe pas pour ce produit', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.deactivateProductSku(db, 'prod-001', 'sku-404')).resolves.toEqual({ status: 404, body: { error: 'SKU introuvable pour ce produit' } });
    });

    it('desactive le SKU (soft, jamais de DELETE)', async () => {
      const row = { id: 'sku-001', sku: 'ROBE-N-M', variant_combo: { couleur: 'Noir' }, is_active: false };
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [row] }) };
      await expect(svc.deactivateProductSku(db, 'prod-001', 'sku-001')).resolves.toEqual({ status: 200, body: { message: 'SKU désactivé', sku: row } });
    });
  });

  describe('auditProductSkuReadiness', () => {
    it('rejette si produit introuvable', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.auditProductSkuReadiness(db, 'missing')).rejects.toMatchObject({ status: 404 });
    });

    it('deja en mode SKU : ready=true sans autre verification', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: false, inventory_model: 'SKU' }] }) };
      await expect(svc.auditProductSkuReadiness(db, 'prod-001')).resolves.toEqual({ product_id: 'prod-001', ready: true, already_sku: true, reasons: ['Déjà en mode SKU'] });
    });

    it('produit sans variantes sans SKU par defaut : not ready', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: false, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [] }) };
      const result = await svc.auditProductSkuReadiness(db, 'prod-001');
      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('Aucun SKU par défaut déclaré pour ce produit sans variantes');
    });

    it('produit a variantes sans SKU actif : not ready', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Robe', has_variants: true, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }) };
      const result = await svc.auditProductSkuReadiness(db, 'prod-001');
      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('Aucun SKU actif déclaré pour ce produit à variantes');
    });

    it('detecte les SKU actifs orphelins (axe modifie apres declaration)', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Robe', has_variants: true, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku-001', variant_combo: { couleur: 'Rouge' } }] })
        .mockResolvedValueOnce({ rows: [{ variant_type: 'couleur', variant_value: 'Noir' }] }) };
      const result = await svc.auditProductSkuReadiness(db, 'prod-001');
      expect(result.ready).toBe(false);
      expect(result.orphaned).toEqual([{ sku_id: 'sku-001', type: 'couleur', value: 'Rouge' }]);
    });
  });

  describe('adjustStock (Lot 2 + PDC-7)', () => {
    it('chemin SKU : inventory_model=SKU + sku_id -> un seul UPDATE sur product_skus, aucune touche a products/product_variants', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'sku-001' }] }) };
      await svc.adjustStock(db, [{ product_id: 'prod-001', sku_id: 'sku-001', inventory_model: 'SKU', quantity: 2 }], 'decrement');

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE product_skus SET stock = stock - $1'),
        [2, 'sku-001', 'prod-001']
      );
    });

    it('chemin SKU : increment utilise le signe +', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'sku-001' }] }) };
      await svc.adjustStock(db, [{ product_id: 'prod-001', sku_id: 'sku-001', inventory_model: 'SKU', quantity: 1 }], 'increment');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE product_skus SET stock = stock + $1'),
        [1, 'sku-001', 'prod-001']
      );
    });

    it('PDC-7 : inventory_model=SKU sans sku_id -> echec bloquant, jamais de fallback vers products.stock', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(svc.adjustStock(db, [{ product_id: 'prod-001', inventory_model: 'SKU', quantity: 2 }], 'decrement'))
        .rejects.toThrow();
      expect(db.query).not.toHaveBeenCalled();
    });

    it('PDC-7 : la seule presence de sku_id ne suffit plus a router vers product_skus (dispatch gouverne par inventory_model)', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      // sku_id renseigne mais inventory_model absent/LEGACY_VARIANTS -> chemin legacy, jamais product_skus
      await svc.adjustStock(db, [{ product_id: 'prod-001', sku_id: 'sku-001', quantity: 2, has_variants: false }], 'decrement');

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][0]).toContain('UPDATE products SET stock');
      expect(db.query.mock.calls[0][0]).not.toContain('product_skus');
    });

    it('chemin legacy : sans sku_id, decremente products.stock puis chaque axe de variant_combo', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await svc.adjustStock(db, [{
        product_id: 'prod-001', quantity: 1, has_variants: true,
        variant_combo: { couleur: 'Noir', taille: 'M' },
      }], 'decrement');

      expect(db.query).toHaveBeenCalledTimes(3);
      expect(db.query.mock.calls[0][0]).toContain('UPDATE products SET stock = stock - $1');
      expect(db.query.mock.calls[0][1]).toEqual([1, 'prod-001']);
      expect(db.query.mock.calls[1][1]).toEqual([1, 'prod-001', 'couleur', 'Noir']);
      expect(db.query.mock.calls[2][1]).toEqual([1, 'prod-001', 'taille', 'M']);
    });

    it('chemin legacy : produit sans variantes ne touche que products.stock', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await svc.adjustStock(db, [{ product_id: 'prod-001', quantity: 3, has_variants: false }], 'increment');

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE products SET stock = stock + $1'), [3, 'prod-001']);
    });

    it('items mixtes : certains inventory_model=SKU (chemin SKU), d autres LEGACY_VARIANTS (chemin legacy), dans le meme appel', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'sku-001' }] })
        .mockResolvedValue({ rows: [] }) };
      await svc.adjustStock(db, [
        { product_id: 'prod-sku', sku_id: 'sku-001', inventory_model: 'SKU', quantity: 1 },
        { product_id: 'prod-legacy', quantity: 2, has_variants: false },
      ], 'decrement');

      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[0][0]).toContain('product_skus');
      expect(db.query.mock.calls[1][0]).toContain('UPDATE products SET stock');
    });
  });

  describe('resolveActiveSku (Lot 3)', () => {
    it('resout le SKU par defaut (combo null)', async () => {
      const row = { id: 'sku-default', sku: null, stock: 10, price_kmf: 5000 };
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [row] }) };

      await expect(svc.resolveActiveSku(db, 'prod-001', null)).resolves.toEqual(row);
      expect(db.query.mock.calls[0][0]).toMatch(/variant_combo IS NULL/);
      expect(db.query.mock.calls[0][1]).toEqual(['prod-001']);
    });

    it('resout un SKU par combo (jsonb) et retourne null si aucune ligne active', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

      await expect(svc.resolveActiveSku(db, 'prod-001', { couleur: 'Noir', taille: 'M' })).resolves.toBeNull();
      expect(db.query.mock.calls[0][0]).toMatch(/variant_combo = \$2::jsonb/);
      expect(db.query.mock.calls[0][1]).toEqual(['prod-001', JSON.stringify({ couleur: 'Noir', taille: 'M' })]);
    });

    it('canonicalise le combo (cles triees) avant la requete', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

      await svc.resolveActiveSku(db, 'prod-001', { taille: 'M', couleur: 'Noir' });
      expect(db.query.mock.calls[0][1][1]).toBe(JSON.stringify({ couleur: 'Noir', taille: 'M' }));
    });

    it('rejette un combo malforme (valeur non-string)', async () => {
      const db = { query: jest.fn() };
      await expect(svc.resolveActiveSku(db, 'prod-001', { couleur: 42 })).rejects.toMatchObject({ status: 400 });
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  // GAP-07 (lot préalable Lot 3) — boundary canonique d'unité vendable.
  describe('applyCanonicalPromotion', () => {
    it('renvoie le prix de base si is_promo est faux', () => {
      expect(svc.applyCanonicalPromotion(10000, { is_promo: false, promo_pct: 50 })).toBe(10000);
    });

    it('renvoie le prix de base si promo_pct <= 0', () => {
      expect(svc.applyCanonicalPromotion(10000, { is_promo: true, promo_pct: 0 })).toBe(10000);
    });

    it('applique la remise si promo active sans date limite', () => {
      expect(svc.applyCanonicalPromotion(10000, { is_promo: true, promo_pct: 10 })).toBe(9000);
    });

    it('applique la remise si promo_until est dans le futur', () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      expect(svc.applyCanonicalPromotion(10000, { is_promo: true, promo_pct: 20, promo_until: future })).toBe(8000);
    });

    it('ignore la remise si promo_until est dans le passe', () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      expect(svc.applyCanonicalPromotion(10000, { is_promo: true, promo_pct: 20, promo_until: past })).toBe(10000);
    });

    it('arrondit le resultat', () => {
      expect(svc.applyCanonicalPromotion(9999, { is_promo: true, promo_pct: 33 })).toBe(Math.round(9999 * 0.67));
    });
  });

  describe('computeSellablePricing', () => {
    const product = { price_kmf: 10000, is_promo: false, promo_pct: null, promo_until: null };

    it('utilise product_skus.price_kmf comme prix de base quand renseigne', () => {
      const result = svc.computeSellablePricing({ product, resolvedSku: { price_kmf: 15000 } });
      expect(result.base_unit_price_kmf).toBe(15000);
      expect(result.effective_unit_price_kmf).toBe(15000);
    });

    it('retombe sur products.price_kmf quand product_skus.price_kmf est null (nullable, §5)', () => {
      const result = svc.computeSellablePricing({ product, resolvedSku: { price_kmf: null } });
      expect(result.base_unit_price_kmf).toBe(10000);
    });

    it('utilise products.price_kmf pour un produit sans SKU resolu (legacy)', () => {
      const result = svc.computeSellablePricing({ product, resolvedSku: null });
      expect(result.base_unit_price_kmf).toBe(10000);
    });

    it('applique la promo canonique une seule fois sur le prix de base resolu', () => {
      const promoProduct = { ...product, is_promo: true, promo_pct: 10 };
      const result = svc.computeSellablePricing({ product: promoProduct, resolvedSku: { price_kmf: 20000 } });
      expect(result.base_unit_price_kmf).toBe(20000);
      expect(result.effective_unit_price_kmf).toBe(18000);
    });
  });

  describe('resolveSellableUnit (GAP-07 §5) — boundary canonique', () => {
    const productSku = {
      id: 'prod-1', name: 'Robe', image_url: 'https://img/generic.jpg', category: 'vetements',
      price_kmf: 10000, is_active: true, inventory_model: 'SKU', has_variants: true, stock: null,
      promo_pct: null, is_promo: false, promo_until: null,
    };
    const productLegacy = {
      id: 'prod-2', name: 'Sac', image_url: 'https://img/sac.jpg', category: 'accessoires',
      price_kmf: 5000, is_active: true, inventory_model: 'LEGACY_VARIANTS', has_variants: true, stock: 20,
      promo_pct: null, is_promo: false, promo_until: null,
    };

    it('404 product_not_found si le produit est introuvable ou inactif', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.resolveSellableUnit(db, { productId: 'nope', variantCombo: null }))
        .rejects.toMatchObject({ status: 404, code: 'product_not_found' });
    });

    it('SKU nominal : resout sku_id/prix/media, priorite au media explicite SKU', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productSku] }) // products
        .mockResolvedValueOnce({ rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 5, price_kmf: 15000 }] }) // resolveActiveSku
        .mockResolvedValueOnce({ rows: [{ url: 'https://img/sku-noir.jpg' }] }) }; // product_sku_media JOIN catalog_media

      const result = await svc.resolveSellableUnit(db, {
        productId: 'prod-1', variantCombo: { couleur: 'Noir' }, quantity: 2,
      });

      expect(result).toMatchObject({
        product_id: 'prod-1', inventory_model: 'SKU',
        sku_id: 'sku-1', sku: 'ROBE-N', variant_combo: { couleur: 'Noir' },
        stock: 5, base_unit_price_kmf: 15000, effective_unit_price_kmf: 15000,
        name: 'Robe', image_url: 'https://img/sku-noir.jpg', category: 'vetements',
      });
    });

    it('SKU : fallback vers products.image_url si aucun media explicite rattache au SKU', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productSku] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 5, price_kmf: 15000 }] })
        .mockResolvedValueOnce({ rows: [] }) }; // aucune association product_sku_media

      const result = await svc.resolveSellableUnit(db, { productId: 'prod-1', variantCombo: null, quantity: 1 });
      expect(result.image_url).toBe('https://img/generic.jpg');
    });

    it('SKU : 409 sellable_unit_not_found si la combinaison ne resout aucun SKU actif', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productSku] })
        .mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.resolveSellableUnit(db, { productId: 'prod-1', variantCombo: { couleur: 'Rose' } }))
        .rejects.toMatchObject({ status: 409, code: 'sellable_unit_not_found' });
    });

    it('SKU : 409 sellable_unit_out_of_stock si le stock du SKU resolu est insuffisant', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productSku] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 1, price_kmf: 15000 }] }) };
      await expect(svc.resolveSellableUnit(db, { productId: 'prod-1', variantCombo: { couleur: 'Noir' }, quantity: 5 }))
        .rejects.toMatchObject({ status: 409, code: 'sellable_unit_out_of_stock', available_stock: 1 });
    });

    it('legacy nominal : combo valide, prix produit, pas de sku_id', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productLegacy] }) // products
        .mockResolvedValueOnce({ rows: [{ stock: 10 }] }) }; // product_variants (couleur=Rouge)

      const result = await svc.resolveSellableUnit(db, {
        productId: 'prod-2', variantCombo: { couleur: 'Rouge' }, quantity: 1,
      });
      expect(result).toMatchObject({
        product_id: 'prod-2', inventory_model: 'LEGACY_VARIANTS',
        sku_id: null, sku: null, variant_combo: { couleur: 'Rouge' },
        base_unit_price_kmf: 5000, effective_unit_price_kmf: 5000,
        image_url: 'https://img/sac.jpg',
      });
    });

    it('legacy : 400 variant_unknown si la variante n\'existe pas', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productLegacy] })
        .mockResolvedValueOnce({ rows: [] }) };
      await expect(svc.resolveSellableUnit(db, { productId: 'prod-2', variantCombo: { couleur: 'Turquoise' } }))
        .rejects.toMatchObject({ status: 400, code: 'variant_unknown' });
    });

    it('legacy : 409 sellable_unit_out_of_stock si le stock de la variante est insuffisant', async () => {
      const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [productLegacy] })
        .mockResolvedValueOnce({ rows: [{ stock: 1 }] }) };
      await expect(svc.resolveSellableUnit(db, { productId: 'prod-2', variantCombo: { couleur: 'Rouge' }, quantity: 3 }))
        .rejects.toMatchObject({ status: 409, code: 'sellable_unit_out_of_stock', available_stock: 1 });
    });

    it('legacy sans combo : 409 sellable_unit_out_of_stock sur products.stock', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ ...productLegacy, stock: 1 }] }) };
      await expect(svc.resolveSellableUnit(db, { productId: 'prod-2', variantCombo: null, quantity: 5 }))
        .rejects.toMatchObject({ status: 409, code: 'sellable_unit_out_of_stock', available_stock: 1 });
    });

    it('meme unite (meme SKU) produit le meme prix quel que soit le point d\'entree (parite §18)', async () => {
      const promoSku = { ...productSku, is_promo: true, promo_pct: 10 };
      const dbA = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [promoSku] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 5, price_kmf: 20000 }] })
        .mockResolvedValueOnce({ rows: [] }) };
      const dbB = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [promoSku] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 5, price_kmf: 20000 }] })
        .mockResolvedValueOnce({ rows: [] }) };

      const a = await svc.resolveSellableUnit(dbA, { productId: 'prod-1', variantCombo: { couleur: 'Noir' } });
      const b = await svc.resolveSellableUnit(dbB, { productId: 'prod-1', variantCombo: { couleur: 'Noir' } });
      expect(a.effective_unit_price_kmf).toBe(18000);
      expect(a.effective_unit_price_kmf).toBe(b.effective_unit_price_kmf);
      expect(a.sku_id).toBe(b.sku_id);
    });
  });
});
