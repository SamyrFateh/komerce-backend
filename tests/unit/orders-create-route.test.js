'use strict';

/**
 * tests/unit/orders-create-route.test.js
 *
 * Tests du router routes/orders/create.js (POST /api/orders).
 *
 * Couverture :
 *   ✓ Validations synchrones : items[] obligatoire, payment_mode valide,
 *     module_type valide → rollback + 400
 *   ✓ Résolution relais : relais_id fourni introuvable → 404 ; relais_id
 *     absent → relais par défaut ; RoutingError → status/code propagés
 *   ✓ Recipient : réutilisation si existant, création sinon
 *   ✓ Produits : product_id invalide, produit introuvable, quantité
 *     invalide, stock insuffisant
 *   ✓ Variant combo : ignoré silencieusement si has_variants=false,
 *     type/valeur invalide, variante inconnue, stock variante insuffisant
 *   ✓ Loyalty discount appliqué sur total_kmf
 *   ✓ Wallet : crédit appliqué, debit appelé, wallet_applied_kmf mis à jour
 *   ✓ confirmPaymentCycle : appelé seulement si wallet couvre 100% ;
 *     stockBlocked → rollback 409 ; succès → order rafraîchi
 *   ✓ Cost snapshot : échec non-bloquant (try/catch local)
 *   ✓ share_token : update fire-and-forget sur db (pas client)
 *   ✓ Commit + réponse 201 avec structure attendue
 *   ✓ Erreur DB → rollback + next(err)
 */

const { makeClient, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, _res, next) => {
    req.user = req.user || { id: 'user-1', role: 'client', full_name: 'Ali', phone: '+269111' };
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, _res, next) => next(),
}));

// O7.3 (provider loyalty) : fusion des deux mocks loyalty-service (getLoyaltyDiscount
// venait auparavant de routes/loyalty.js, désormais du même module que
// handleOrderConfirmed). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
jest.mock('../../services/loyalty-service', () => ({
  getLoyaltyDiscount: jest.fn(),
  handleOrderConfirmed: jest.fn().mockResolvedValue({ skipped: true }),
}));

jest.mock('../../utils/rules', () => ({
  getRule: jest.fn(),
}));

jest.mock('../../utils/rates', () => ({
  getRates: jest.fn(),
}));

jest.mock('../../services/order-service', () => ({
  getUniqueRef: jest.fn(),
  generateCashCode: jest.fn(),
  generatePickupCode: jest.fn(),
}));

jest.mock('../../services/wallet-service', () => ({
  getBalanceInTx: jest.fn(),
  debit: jest.fn(),
}));

jest.mock('../../services/routing', () => {
  const actual = jest.requireActual('../../services/routing');
  return {
    resolveRoutingFromRelais: jest.fn(),
    RoutingError: actual.RoutingError,
  };
});

jest.mock('../../services/notification-service', () => ({
  notifyOrderCreated: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/customs-classification', () => ({
  resolveFrozenClassification: jest.fn(),
}));

jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));

jest.mock('../../services/order-cost-snapshot', () => ({
  lockEstimatedCostsForOrder: jest.fn(),
}));

// handleOrderConfirmed mocké dans le jest.mock('../../services/loyalty-service', ...) plus haut

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { getLoyaltyDiscount } = require('../../services/loyalty-service');
const { getRule } = require('../../utils/rules');
const { getRates } = require('../../utils/rates');
const { getUniqueRef, generateCashCode, generatePickupCode } = require('../../services/order-service');
const walletService = require('../../services/wallet-service');
const { resolveRoutingFromRelais } = require('../../services/routing');
const { notifyOrderCreated } = require('../../services/notification-service');
const { resolveFrozenClassification } = require('../../services/customs-classification');
const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');
const { lockEstimatedCostsForOrder } = require('../../services/order-cost-snapshot');
const { handleOrderConfirmed } = require('../../services/loyalty-service');

const express = require('express');
const request = require('supertest');

let app;

const RELAIS = { id: 'relais-1', name: 'Relais Moroni', address: 'Centre-ville', island_code: 'MORONI', is_active: true };
const PRODUCT = {
  id: 'prod-1', name: 'Robe', price_kmf: 10000, stock: 50, is_active: true,
  weight_kg: 1, price_aed: 0, customs_risk_coeff: 1, category: 'vetements', has_variants: false,
};

function defaultMocks() {
  getRates.mockResolvedValue({ eur_kmf: 492 });
  getRule.mockImplementation((key, fallback) => Promise.resolve(fallback));
  getLoyaltyDiscount.mockResolvedValue({ discountPct: 0, discountLabel: null });
  walletService.getBalanceInTx.mockResolvedValue(0);
  walletService.debit.mockResolvedValue(undefined);
  getUniqueRef.mockResolvedValue('CMD-2026-001');
  generateCashCode.mockReturnValue(null);
  generatePickupCode.mockReturnValue('PICKUP123');
  resolveRoutingFromRelais.mockReturnValue({ destination_island: 'MORONI', routing_mode: 'direct', transit_hub: null });
  resolveFrozenClassification.mockResolvedValue({
    customs_category_key: 'vetements', sh_code: '6101', douane_pct: 20, tva_pct: 0, taxe_add_pct: 0, classification_defaulted: false,
  });
  confirmPaymentCycle.mockResolvedValue({ stockBlocked: false });
  lockEstimatedCostsForOrder.mockResolvedValue(undefined);
  db.query.mockResolvedValue({ rows: [] });
}

function validBody(overrides = {}) {
  return {
    items: [{ product_id: 'prod-1', quantity: 2 }],
    payment_mode: 'cash_relais',
    recipient_name: 'Fatima',
    recipient_phone: '+269222',
    ...overrides,
  };
}

function orderRow(overrides = {}) {
  return {
    id: 'order-1', reference: 'CMD-2026-001', status: 'pending', total_kmf: 20000, total_eur: 40.65,
    payment_mode: 'cash_relais', payment_status: 'pending', cash_ref_code: null, confection_type: 'aucun',
    module_type: null, destination_island: 'MORONI', routing_mode: 'direct', transit_hub: null,
    created_at: '2026-06-01T00:00:00Z', discount_pct: 0, discount_kmf: 0, loyalty_label: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  defaultMocks();

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/orders/create');
    app.use('/api/orders', router);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('orders/create — validations synchrones', () => {
  it('400 si items[] manquant ou vide', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody({ items: [] }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/);
    expectTransactionRolledBack(client);
  });

  it('400 si payment_mode invalide', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody({ payment_mode: 'bitcoin' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payment_mode/);
    expectTransactionRolledBack(client);
  });

  it('400 si module_type invalide', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody({ module_type: 'invalide' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/module_type/);
    expectTransactionRolledBack(client);
  });
});

describe('orders/create — résolution relais', () => {
  it('404 si relais_id fourni introuvable', async () => {
    const client = makeClient([{ rows: [] }]); // SELECT relais WHERE id = $1
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody({ relais_id: 'unknown' }));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Relais introuvable/);
    expectTransactionRolledBack(client);
  });

  it('relais_id absent → sélectionne le relais actif par défaut', async () => {
    const client = makeClient([
      { rows: [RELAIS] }, // SELECT relais par défaut
      { rows: [] }, // recipient lookup
      { rows: [{ id: 'recip-1' }] }, // INSERT recipient
      { rows: [PRODUCT] }, // SELECT products
      { rows: [orderRow()] }, // INSERT orders
      { rows: [] }, // INSERT order_status_history
      { rows: [] }, // INSERT order_items
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(201);
    expect(resolveRoutingFromRelais).toHaveBeenCalledWith(RELAIS);
  });

  it('RoutingError → status/code propagés, rollback', async () => {
    const client = makeClient([{ rows: [RELAIS] }]);
    db.getClient.mockResolvedValue(client);
    const { RoutingError } = require('../../services/routing');
    resolveRoutingFromRelais.mockImplementation(() => {
      throw new RoutingError('île manquante', 'ISLAND_CODE_MISSING');
    });

    const res = await request(app).post('/api/orders').send(validBody({ relais_id: 'relais-1' }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'île manquante', code: 'ISLAND_CODE_MISSING' });
    expectTransactionRolledBack(client);
  });

  it('erreur non-RoutingError pendant le routing → next(err)', async () => {
    const client = makeClient([{ rows: [RELAIS] }]);
    db.getClient.mockResolvedValue(client);
    resolveRoutingFromRelais.mockImplementation(() => { throw new Error('panne inattendue'); });

    const res = await request(app).post('/api/orders').send(validBody({ relais_id: 'relais-1' }));

    expect(res.status).toBe(500);
    expectTransactionRolledBack(client);
  });
});

describe('orders/create — recipient', () => {
  it('réutilise un recipient existant (pas d\'INSERT)', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-existing' }] }, // recipient trouvé
      { rows: [PRODUCT] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(201);
    const insertRecipientCall = client.calls.find(c => /INSERT INTO recipients/.test(c.sql));
    expect(insertRecipientCall).toBeUndefined();
  });
});

describe('orders/create — produits', () => {
  it('400 si product_id invalide (non string)', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 42, quantity: 1 }] })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/product_id invalide/);
    expectTransactionRolledBack(client);
  });

  it('404 si produit introuvable', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [] }, // aucun produit retourné
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Produit introuvable/);
    expectTransactionRolledBack(client);
  });

  it('400 si quantité hors bornes (max)', async () => {
    getRule.mockImplementation((key, fallback) => Promise.resolve(key === 'MAX_QUANTITY_PER_ITEM' ? 5 : fallback));
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 99 }] })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Quantité invalide/);
    expectTransactionRolledBack(client);
  });

  it('409 si stock produit insuffisant', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [{ ...PRODUCT, stock: 1 }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 2 }] })
    );

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Stock insuffisant/);
    expect(res.body.available_stock).toBe(1);
    expectTransactionRolledBack(client);
  });
});

describe('orders/create — variant_combo', () => {
  it('ignore silencieusement la combo si le produit n\'a pas de variantes', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] }, // has_variants: false
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { taille: 'M' } }] })
    );

    expect(res.status).toBe(201);
    const variantLookup = client.calls.find(c => /product_variants/.test(c.sql));
    expect(variantLookup).toBeUndefined();
  });

  it('400 si variant_combo a un type/valeur non-string', async () => {
    const productWithVariants = { ...PRODUCT, has_variants: true };
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [productWithVariants] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { taille: 42 } }] })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/variant_combo invalide/);
    expectTransactionRolledBack(client);
  });

  it('400 si la variante est inconnue en DB', async () => {
    const productWithVariants = { ...PRODUCT, has_variants: true };
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [productWithVariants] },
      { rows: [] }, // SELECT stock FROM product_variants → rien
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { taille: 'XL' } }] })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Variante inconnue/);
    expectTransactionRolledBack(client);
  });

  it('409 si stock de la variante insuffisant', async () => {
    const productWithVariants = { ...PRODUCT, has_variants: true };
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [productWithVariants] },
      { rows: [{ stock: 0 }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { taille: 'XL' } }] })
    );

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Stock insuffisant/);
    expectTransactionRolledBack(client);
  });
});

describe('orders/create — SKU (Lot 3, inventory_model="SKU")', () => {
  const PRODUCT_SKU = { ...PRODUCT, has_variants: true, inventory_model: 'SKU' };

  it('nominal : résout le SKU actif, l\'insère dans order_items, ne touche jamais product_variants', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT_SKU] },
      { rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 5, price_kmf: 10000 }] }, // resolveActiveSku
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { couleur: 'Noir' } }] })
    );

    expect(res.status).toBe(201);
    const skuLookup = client.calls.find(c => /product_skus/.test(c.sql));
    expect(skuLookup).toBeDefined();
    expect(skuLookup.params).toEqual(['prod-1', JSON.stringify({ couleur: 'Noir' })]);

    const variantLookup = client.calls.find(c => /product_variants/.test(c.sql));
    expect(variantLookup).toBeUndefined();

    const itemInsert = client.calls.find(c => /INSERT INTO order_items/.test(c.sql));
    expect(itemInsert.params).toContain('sku-1');
  });

  it('409 si aucune combinaison active ne correspond', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT_SKU] },
      { rows: [] }, // resolveActiveSku → rien trouvé
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { couleur: 'Rose' } }] })
    );

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Combinaison indisponible/);
    expectTransactionRolledBack(client);
  });

  it('409 si le stock du SKU résolu est insuffisant', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT_SKU] },
      { rows: [{ id: 'sku-1', sku: 'ROBE-N', stock: 0, price_kmf: 10000 }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { couleur: 'Noir' } }] })
    );

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Stock insuffisant/);
    expect(res.body.available_stock).toBe(0);
    expectTransactionRolledBack(client);
  });

  it('400 si variant_combo malformé (avant toute requête product_skus)', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT_SKU] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1, variant_combo: { couleur: 42 } }] })
    );

    expect(res.status).toBe(400);
    expectTransactionRolledBack(client);
  });

  it('SKU par défaut (sans variant_combo) : lookup avec variant_combo IS NULL', async () => {
    const productSkuNoVariant = { ...PRODUCT, has_variants: false, inventory_model: 'SKU' };
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [productSkuNoVariant] },
      { rows: [{ id: 'sku-default', sku: null, stock: 10, price_kmf: 10000 }] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(
      validBody({ items: [{ product_id: 'prod-1', quantity: 1 }] })
    );

    expect(res.status).toBe(201);
    const skuLookup = client.calls.find(c => /product_skus/.test(c.sql));
    expect(skuLookup.sql).toMatch(/variant_combo IS NULL/);
    expect(skuLookup.params).toEqual(['prod-1']);
  });
});

describe('orders/create — loyalty discount', () => {
  it('applique le discountPct sur total_kmf', async () => {
    getLoyaltyDiscount.mockResolvedValue({ discountPct: 10, discountLabel: 'Fidèle' });
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(201);
    const insertOrderCall = client.calls.find(c => /INSERT INTO orders/.test(c.sql));
    // total brut produits = 10000*2 = 20000 ; + transport §8 (1kg*2*65) = 130
    // => 20130 ; discount 10% = 2013 ; total_kmf final = 18117
    expect(insertOrderCall.params).toContain(18117);
  });
});

describe('orders/create — wallet', () => {
  it('applique le crédit wallet, débite et marque wallet_applied_kmf', async () => {
    walletService.getBalanceInTx.mockResolvedValue(5000);
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] }, // INSERT orders
      { rows: [] }, // INSERT order_status_history
      { rows: [] }, // UPDATE orders SET wallet_applied_kmf
      { rows: [] }, // INSERT order_items
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody({ use_wallet: true }));

    expect(res.status).toBe(201);
    expect(walletService.debit).toHaveBeenCalledWith(client, expect.objectContaining({
      userId: 'user-1',
      amountKmf: 5000,
      reason: 'checkout',
    }));
    expect(res.body.credit_applied_kmf).toBe(5000);
    const updateWalletCall = client.calls.find(c => /wallet_applied_kmf/.test(c.sql));
    expect(updateWalletCall).toBeDefined();
  });

  it('wallet couvre 100% → confirmPaymentCycle appelé et order rafraîchi', async () => {
    // couvre tout le total ; total brut 10000*2 = 20000 + transport (§8)
    // 1kg*2*65 = 130 => 20130
    walletService.getBalanceInTx.mockResolvedValue(20130);
    const refreshedOrder = { ...orderRow(), status: 'paid', confirmed_at: '2026-06-01T01:00:00Z' };
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] }, // INSERT orders
      { rows: [] }, // INSERT order_status_history
      { rows: [] }, // UPDATE wallet_applied_kmf
      { rows: [] }, // INSERT order_items
      { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
      { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
      { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
      { rows: [refreshedOrder] }, // SELECT orders refresh post confirmPaymentCycle
    ]);
    db.getClient.mockResolvedValue(client);
    confirmPaymentCycle.mockResolvedValue({ stockBlocked: false });

    const res = await request(app).post('/api/orders').send(validBody({ use_wallet: true }));

    expect(res.status).toBe(201);
    expect(confirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      source: 'wallet_full_payment',
    }));
    expect(res.body.order.status).toBe('paid');
  });

  it('confirmPaymentCycle stockBlocked → rollback 409', async () => {
    walletService.getBalanceInTx.mockResolvedValue(20130); // couvre tout le total (§8)
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);
    confirmPaymentCycle.mockResolvedValue({ stockBlocked: true, insufficientItems: [{ product_id: 'prod-1' }] });

    const res = await request(app).post('/api/orders').send(validBody({ use_wallet: true }));

    expect(res.status).toBe(409);
    expect(res.body.items).toEqual([{ product_id: 'prod-1' }]);
    expectTransactionRolledBack(client);
  });
});

describe('orders/create — cost snapshot non-bloquant', () => {
  it('continue et committe même si lockEstimatedCostsForOrder échoue', async () => {
    lockEstimatedCostsForOrder.mockRejectedValue(new Error('snapshot indisponible'));
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(201);
    expect(client.calls.map(c => c.sql.trim())).toContain('COMMIT');
  });
});

describe('orders/create — share_token (fire-and-forget)', () => {
  it('met à jour cart_shares via db.query (pas via client de transaction)', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    const res = await request(app).post('/api/orders').send(validBody({ share_token: 'share-abc' }));

    expect(res.status).toBe(201);
    await new Promise(process.nextTick);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE cart_shares'),
      ['order-1', 'share-abc']
    );
  });
});

describe('orders/create — réponse nominale', () => {
  it('201 avec structure attendue et notification envoyée', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { rows: [PRODUCT] },
      { rows: [orderRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      id: 'order-1',
      reference: 'CMD-2026-001',
      status: 'pending',
      relais: { id: 'relais-1', name: 'Relais Moroni', address: 'Centre-ville' },
      routing: { destination_island: 'MORONI', routing_mode: 'direct', transit_hub: null },
    });
    await new Promise(process.nextTick);
    expect(notifyOrderCreated).toHaveBeenCalled();
  });
});

describe('orders/create — erreurs DB', () => {
  it('erreur pendant la lecture des produits → rollback + next(err) → 500', async () => {
    const client = makeClient([
      { rows: [RELAIS] },
      { rows: [{ id: 'recip-1' }] },
      { error: new Error('connexion DB perdue') },
    ]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders').send(validBody());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'connexion DB perdue' });
    expectTransactionRolledBack(client);
  });
});
