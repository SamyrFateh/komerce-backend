'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/purchasing-readiness-vocabulary-mapping.test.js
 *
 * GAP-3 — Readiness Convergence. Caractérise, sans modifier aucun code,
 * l'exactitude du mapping documenté dans
 * docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md §9bis.
 *
 * But : si un futur changement fait dériver le comportement réel du
 * gate/de l'adapter par rapport à ce que la doctrine documente, ce test
 * casse — la doctrine ne doit jamais silencieusement devenir fausse.
 *
 * Ne teste PAS tous les chemins déjà couverts par
 * canonical-unit-purchasing-gate.test.js / supplier-fulfillment-readiness.test.js
 * / allegro-fulfillment-adapter.test.js — seulement les faits précis que
 * la doctrine affirme.
 */

const { BLOCKED, prepareCanonicalUnitPurchase } = require('../../services/suppliers/canonical-unit-purchasing-gate');
const { VERDICT } = require('../../services/suppliers/supplier-fulfillment-readiness');
const allegroAdapter = require('../../services/suppliers/allegro-fulfillment-adapter');

const soi = (provider, payload) => ({ provider, version: 1, payload });
const resolved = (identity, state = {}) => ({
  status: 'RESOLVED', canonical_unit_id: 'u1', supplier_unit_ref: state.ref || 'UNIT1',
  supplier_order_identity: identity, legacy_sku: { id: 'sku1', product_id: 'p1', supplier_sku: 'SKU' },
  canonical_unit: { canonical_unit_id: 'u1', current_state: { stock_available: 5, purchase_price: 10, currency: 'USD', is_active: true, ...state } },
});

// ═════════════════════════════════════════════════════════════════════════════
// 9bis.2 — VERDICT est le vocabulaire canonique retenu, gelé
// ═════════════════════════════════════════════════════════════════════════════

describe('§9bis.2 — VERDICT.* est le vocabulaire readiness canonique', () => {
  test('VERDICT contient exactement les 10 statuts documentés en doctrine', () => {
    const documented = [
      'FULFILLMENT_READY', 'BLOCKED_SUPPLIER_IDENTITY', 'PROCUREMENT_ROUTE_UNRESOLVED',
      'SKU_INACTIVE', 'OUT_OF_STOCK', 'SUPPLIER_UNAVAILABLE', 'PRICE_DRIFT_BLOCKED',
      'NOT_SHIPPABLE', 'FREIGHT_UNAVAILABLE', 'PREFLIGHT_FAILED',
    ];
    const actual = Object.values(VERDICT).slice().sort();
    expect(actual).toEqual(documented.slice().sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9bis.3 — Forme 1 : BLOCKED_SUPPLIER_IDENTITY est LE statut fixe de tout
// échec interne au gate ; la cause précise vit dans .reason, jamais .status
// ═════════════════════════════════════════════════════════════════════════════

describe('§9bis.3 Forme 1 — .status reste fixe, .reason porte la cause', () => {
  test('BLOCKED est la constante unique "BLOCKED_SUPPLIER_IDENTITY"', () => {
    expect(BLOCKED).toBe('BLOCKED_SUPPLIER_IDENTITY');
  });

  test.each([
    ['quantité invalide', { productSkuId: 'sku1', quantity: 0, resolveFn: jest.fn() }, 'INVALID_QUANTITY'],
    ['résolution catalogue en échec', {
      productSkuId: 'sku1',
      resolveFn: async () => ({ status: 'NO_UNIT' }),
    }, 'NO_UNIT'],
  ])('%s → .status="BLOCKED_SUPPLIER_IDENTITY" ET .reason porte la cause précise', async (_label, args, expectedReason) => {
    const out = await prepareCanonicalUnitPurchase(args);
    // Le point précis que la doctrine documente : .status ne varie JAMAIS
    // avec la cause — seul .reason varie.
    expect(out.status).toBe('BLOCKED_SUPPLIER_IDENTITY');
    expect(out.reason).toBe(expectedReason);
  });

  test('deux causes différentes produisent le même .status mais un .reason différent', async () => {
    const quantityFailure = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', quantity: -1, resolveFn: jest.fn() });
    const catalogFailure = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', resolveFn: async () => ({ status: 'AMBIGUOUS_UNIT' }) });

    // Le fait documenté : .status identique malgré des causes totalement différentes.
    expect(quantityFailure.status).toBe(catalogFailure.status);
    expect(quantityFailure.status).toBe('BLOCKED_SUPPLIER_IDENTITY');
    // .reason, lui, distingue bien les deux causes.
    expect(quantityFailure.reason).not.toBe(catalogFailure.reason);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9bis.3 — Forme 2 : quand l'adapter répond ready:false, son verdict VERDICT.*
// est transmis tel quel par le gate — aucune traduction, .status = VERDICT.*
// ═════════════════════════════════════════════════════════════════════════════

describe('§9bis.3 Forme 2 — verdict adapter transmis sans traduction', () => {
  test('adapter.evaluate() ready:false → gate.status EST le littéral VERDICT.* de l\'adapter (pas BLOCKED_SUPPLIER_IDENTITY)', async () => {
    const a = {
      provider: 'cj',
      evaluate: jest.fn(async () => ({ ready: false, status: VERDICT.OUT_OF_STOCK, evidence: {}, reason: 'CJ_OUT_OF_STOCK' })),
      buildOrderPayload: jest.fn(),
    };
    const out = await prepareCanonicalUnitPurchase({
      productSkuId: 'sku1',
      adapters: { cj: a },
      resolveFn: async () => resolved(soi('cj', { vid: 'V1' })),
    });
    // Point précis documenté : ce n'est PAS BLOCKED_SUPPLIER_IDENTITY ici,
    // c'est directement le VERDICT.* que l'adapter a choisi.
    expect(out.status).toBe(VERDICT.OUT_OF_STOCK);
    expect(out.status).not.toBe(BLOCKED);
    expect(out.reason).toBe('CJ_OUT_OF_STOCK');
    expect(a.buildOrderPayload).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9bis.3 — Forme 3 : HARD_STOP est le succès terminal, PAS un échec
// ═════════════════════════════════════════════════════════════════════════════

describe('§9bis.3 Forme 3 — HARD_STOP est un succès, jamais un échec', () => {
  test('un preflight réussi produit status="HARD_STOP" avec un payload exploitable', async () => {
    const a = {
      provider: 'allegro',
      evaluate: jest.fn(async () => ({ ready: true, status: VERDICT.READY, evidence: {}, reason: null })),
      buildOrderPayload: jest.fn(async () => ({ provider: 'allegro', native: { offer_id: '1' } })),
    };
    const out = await prepareCanonicalUnitPurchase({
      productSkuId: 'sku1',
      adapters: { allegro: a },
      resolveFn: async () => resolved(soi('allegro', { offer_id: '1' })),
    });
    expect(out.status).toBe('HARD_STOP');
    // Piège de lecture documenté : ready:false ici ne veut PAS dire échec.
    expect(out.ready).toBe(false);
    expect(out.place_order_invoked).toBe(false);
    // Le fait distinctif d'un succès : un payload exploitable est présent.
    expect(out.payload).toEqual({ provider: 'allegro', native: { offer_id: '1' } });
  });

  test('HARD_STOP n\'est jamais émis sur un chemin d\'échec (BLOCKED_SUPPLIER_IDENTITY ou VERDICT.* négatif)', async () => {
    const blockedOut = await prepareCanonicalUnitPurchase({ productSkuId: 'sku1', quantity: 0, resolveFn: jest.fn() });
    expect(blockedOut.status).not.toBe('HARD_STOP');

    const a = {
      provider: 'cj',
      evaluate: jest.fn(async () => ({ ready: false, status: VERDICT.PREFLIGHT_FAILED, evidence: {}, reason: 'X' })),
    };
    const verdictOut = await prepareCanonicalUnitPurchase({
      productSkuId: 'sku1', adapters: { cj: a }, resolveFn: async () => resolved(soi('cj', { vid: 'V1' })),
    });
    expect(verdictOut.status).not.toBe('HARD_STOP');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9bis.4 — Capability : forme d'evidence déjà en usage chez l'adapter Allegro
// ═════════════════════════════════════════════════════════════════════════════

describe('§9bis.4 — evidence porte la capability, pas le verdict', () => {
  test('evidence Allegro READY contient manual_procurement_ready/auto_order_ready/execution_mode', async () => {
    const row = { supplier_unit_ref: '7782182471', supplier_sku: 'allegro-sandbox:7782182471' };
    const identity = soi('allegro', { environment: 'sandbox', offer_id: '7782182471' });

    // Mock minimal du connector pour atteindre le chemin READY sans réseau réel.
    jest.resetModules();
    jest.doMock('../../services/suppliers/connectors/allegro-connector', () => ({
      fetchProducts: jest.fn(async () => ({
        products: [{ sellable_units: [{ stock_available: 5, purchase_price: 29.9, currency: 'PLN', is_active: true }] }],
        invalid: [],
      })),
    }));
    const freshAdapter = require('../../services/suppliers/allegro-fulfillment-adapter');
    const out = await freshAdapter.evaluate({ row, identity, quantity: 1 });
    jest.dontMock('../../services/suppliers/connectors/allegro-connector');

    expect(out.status).toBe('FULFILLMENT_READY');
    // Le point documenté : ces trois champs vivent dans .evidence, pas au
    // niveau du verdict — ce sont des signaux capability, pas readiness.
    expect(out.evidence).toMatchObject({
      manual_procurement_ready: true,
      auto_order_ready: false,
      execution_mode: 'manual',
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9bis.5 — triggerMode et evidence.execution_mode : deux calculs indépendants
// (dette documentée, à ne PAS corriger dans ce GAP)
// ═════════════════════════════════════════════════════════════════════════════

describe('§9bis.5 — triggerMode ne lit jamais evidence.execution_mode (dette connue, GAP-4)', () => {
  test('purchasing-trigger-service.js ne référence ni evidence.execution_mode ni auto_order_ready', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'services', 'purchasing-trigger-service.js'), 'utf8'
    );
    // Documente l'état actuel : triggerMode est calculé uniquement depuis
    // ps.auto_order et ps.platform, jamais depuis l'evidence d'un adapter.
    expect(src).not.toMatch(/execution_mode/);
    expect(src).not.toMatch(/auto_order_ready/);
    expect(src).toMatch(/ps\.auto_order\s*\?\s*'auto'/);
  });
});
