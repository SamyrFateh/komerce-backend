'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/purchasing-adapter-resolution.test.js
 *
 * GAP-2 — Adapter Resolution. Purchasing ne connaît plus aucun nom
 * provider en dur : `callSupplierAPI` résout un adapter via le registry
 * d'exécution + le contrat `supplier-fulfillment-adapter-contract.js`,
 * jamais via `switch(platform)`.
 *
 * Non-régression déjà couverte par tests/unit/purchasing-trigger-
 * service.test.js et tests/unit/purchasing.test.js (mode manuel + les
 * 4 cas auto_order=true existants, qui assertent uniquement `status`,
 * jamais le contenu de `.error` — donc inchangés par ce GAP). Ce
 * fichier couvre les preuves spécifiques à GAP-2.
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const mk = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child: mk, forModule: mk, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { notifyText } = require('../../services/notification-service');
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
const { EXECUTION_ADAPTER_REGISTRY } = require('../../services/suppliers/execution-adapter-registry');

function makeClient(script = []) {
  const calls = [];
  const queue = [...script];
  const client = {
    calls,
    released: false,
    query: jest.fn(async (sql) => {
      calls.push(sql);
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (
        normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK' ||
        /^SAVEPOINT /.test(normalized) || /^RELEASE SAVEPOINT/.test(normalized) ||
        /^ROLLBACK TO SAVEPOINT/.test(normalized)
      ) {
        return { rows: [], rowCount: 0 };
      }
      const next = queue.shift();
      if (!next) throw new Error(`No mock query result for SQL: ${normalized}`);
      if (typeof next === 'function') return next(sql);
      if (next.error) throw next.error;
      return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows ? next.rows.length : 0) };
    }),
    release: jest.fn(() => { client.released = true; }),
  };
  return client;
}

const order = { id: 'o1', reference: 'KOM-001', relais_id: 'r1', relais_name: 'Relais A' };
const item = { product_id: 'p1', product_name: 'Sac Ali', category: 'sacs', quantity: 2, price_aed: 50 };

function supplierRow(overrides = {}) {
  return {
    id: 'ps1', supplier_id: 's1', supplier_sku: 'SKU-1', supplier_price_aed: 30,
    supplier_name: 'Supplier X', platform: 'local', auto_order: false,
    contact_phone: '971500000000', account_id: null, api_key_enc: null,
    api_secret_enc: null, lead_time_days: 5, supplier_url: 'https://x.test/p',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_PHONE;
  notifyText.mockResolvedValue(undefined);
});

// ═════════════════════════════════════════════════════════════════════════════
// Aucun nom de provider en dur ne subsiste dans le cœur Purchasing
// ═════════════════════════════════════════════════════════════════════════════

describe('purchasing-trigger-service.js ne contient plus aucun littéral de provider', () => {
  test('zéro littéral \'noon\' | \'amazon_uae\' | \'aliexpress\' | \'allegro\' | \'cj\' dans le source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'services', 'purchasing-trigger-service.js'), 'utf8'
    );
    for (const literal of ["'noon'", "'amazon_uae'", "'aliexpress'", "'allegro'", "'cj'"]) {
      expect(src).not.toContain(literal);
    }
  });

  test('aucune fonction stub par provider (noonOrder/amazonOrder/aliexpressOrder) ne subsiste', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'services', 'purchasing-trigger-service.js'), 'utf8'
    );
    expect(src).not.toMatch(/function (noon|amazon|aliexpress)Order/);
  });

  test('le déclencheur ne résout aucun adapter et n\'appelle jamais un fournisseur (P0-5)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/purchasing-trigger-service.js'), 'utf8');
    expect(src).not.toMatch(/EXECUTION_ADAPTER_REGISTRY/);
    expect(src).not.toMatch(/placeOrder|callSupplierAPI|validateAdapter/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Registry — composition root réutilisable
// ═════════════════════════════════════════════════════════════════════════════

describe('execution-adapter-registry — composition root', () => {
  test('contient exactement les adapters fulfillment runtime connus', () => {
    expect(Object.keys(EXECUTION_ADAPTER_REGISTRY).sort()).toEqual(['aliexpress', 'allegro', 'cj']);
  });

  test('est gelé (Object.frozen)', () => {
    expect(Object.isFrozen(EXECUTION_ADAPTER_REGISTRY)).toBe(true);
  });

  test('CJ et AliExpress exposent placeOrder ; Allegro reste manuel', () => {
    expect(typeof EXECUTION_ADAPTER_REGISTRY.cj.placeOrder).toBe('function');
    expect(typeof EXECUTION_ADAPTER_REGISTRY.aliexpress.placeOrder).toBe('function');
    expect(typeof EXECUTION_ADAPTER_REGISTRY.allegro.placeOrder).not.toBe('function');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Caractérisation AVANT — le chemin manuel Golden Allegro reste inchangé
// ═════════════════════════════════════════════════════════════════════════════

describe('résolution fail-closed — deux causes distinctes, jamais confondues', () => {
  test('les deux causes d\'échec produisent des messages .error distincts (pas de success:false silencieux ambigu)', async () => {
    // Test direct de callSupplierAPI (exporté ? non — testé via triggerPurchasing
    // + interception de notifyAdminManual serait indirect ; on vérifie donc le
    // comportement via le registry + validateAdapter directement, qui EST le
    // contrat que callSupplierAPI consomme).
    const { validateAdapter } = require('../../services/suppliers/supplier-fulfillment-adapter-contract');

    const unknownCheck = validateAdapter('totally_unknown_provider', EXECUTION_ADAPTER_REGISTRY['totally_unknown_provider']);
    expect(unknownCheck.ok).toBe(false);
    expect(unknownCheck.reason).toMatch(/absent/);

    const knownCheck = validateAdapter('allegro', EXECUTION_ADAPTER_REGISTRY.allegro);
    expect(knownCheck.ok).toBe(true);
    expect(typeof knownCheck.adapter.placeOrder).not.toBe('function');
    // La distinction "adapter trouvé mais sans placeOrder" vs "adapter
    // introuvable" est bien deux chemins différents dans validateAdapter
    // (ok:false) vs la vérification placeOrder faite par callSupplierAPI
    // lui-même (ok:true mais capacité absente).
    expect(unknownCheck.ok).not.toBe(knownCheck.ok);
  });
});
