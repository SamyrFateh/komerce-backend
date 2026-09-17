'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Allegro Golden Preflight Contract Suite
 *
 * Principe :
 *   Internal contract proofs → all green → external Sandbox Golden authorised.
 *
 * Ces tests ne font AUCUN appel externe. Ils vérifient que les briques
 * internes Komerce acceptent les contrats Allegro et rejettent les
 * violations, en isolation complète.
 *
 * Couverture :
 *   P-01..P-02  suppliers_platform_check + validator
 *   P-03..P-05  DB schema contracts (colonnes, nullabilité)
 *   P-06..P-08  Canonical money resolution
 *   P-09..P-11  Supplier Order Identity
 *   P-12..P-13  Allegro fulfillment adapter identity
 *   P-14..P-15  Allegro reconciliation
 *   P-16..P-17  PO DB constraint simulation
 *   P-18        Idempotence
 *   P-19        Flow routing (trigger_mode)
 *   P-20        Legacy fallback fail-closed
 */

const fs = require('fs');
const path = require('path');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..', '..');

function extractPlatformsFromSchema() {
  const src = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  const match = src.match(
    /suppliers_platform_check\s+CHECK\s*\(\(platform\s*=\s*ANY\s*\(ARRAY\[([^\]]+)\]/
  );
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/::text/g, '').replace(/['"]/g, '')).filter(Boolean);
}

function extractPlatformsFromValidator() {
  const src = fs.readFileSync(path.join(ROOT, 'validators', 'index.js'), 'utf8');
  const match = src.match(/const PLATFORMS\s*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

function migrationExists(pattern) {
  const dir = path.join(ROOT, 'migrations');
  return fs.readdirSync(dir).some(f => f.includes(pattern));
}

function migrationContains(pattern, text) {
  const dir = path.join(ROOT, 'migrations');
  const file = fs.readdirSync(dir).find(f => f.includes(pattern));
  if (!file) return false;
  return fs.readFileSync(path.join(dir, file), 'utf8').includes(text);
}

// ─── Mock Allegro SOI ────────────────────────────────────────────────────────

const ALLEGRO_SOI = {
  provider: 'allegro',
  version: 1,
  payload: { environment: 'sandbox', offer_id: '7782182471' },
};

const ALLEGRO_SUPPLIER_UNIT_REF = '7782182471';
const ALLEGRO_SUPPLIER_SKU = 'allegro-sandbox:7782182471';

// ═══════════════════════════════════════════════════════════════════════════════
// P-01..P-02  suppliers_platform_check + validator
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-01/P-02 — suppliers platform allowlist', () => {
  test('P-01 — db/schema.sql suppliers_platform_check inclut allegro', () => {
    const platforms = extractPlatformsFromSchema();
    expect(platforms).toContain('allegro');
  });

  test('P-02 — validators/index.js PLATFORMS inclut allegro', () => {
    const platforms = extractPlatformsFromValidator();
    expect(platforms).toContain('allegro');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-03..P-05  DB schema contracts
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-03..P-05 — DB schema contracts (migrations)', () => {
  test('P-03 — migration 239 ajoute supplier_unit_price et supplier_currency à purchase_orders', () => {
    expect(migrationContains('239_', 'supplier_unit_price')).toBe(true);
    expect(migrationContains('239_', 'supplier_currency')).toBe(true);
  });

  test('P-04 — migration 225 ajoute supplier_order_identity et product_sku_id à purchase_orders', () => {
    expect(migrationContains('225_', 'supplier_order_identity')).toBe(true);
    expect(migrationContains('225_', 'product_sku_id')).toBe(true);
  });

  test('P-05 — migration 239 rend product_suppliers.supplier_price_aed nullable', () => {
    expect(migrationContains('239_', 'supplier_price_aed DROP NOT NULL')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-06..P-08  Canonical money resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-06..P-08 — requireSupplierMoney', () => {
  const { _requireSupplierMoney: requireSupplierMoney } = require('../../services/purchasing-trigger-service');

  test('P-06 — accepte { supplier_unit_price: 29.90, supplier_currency: "PLN" }', () => {
    const result = requireSupplierMoney({ supplier_unit_price: 29.90, supplier_currency: 'PLN' });
    expect(result).toEqual({ amount: 29.90, currency: 'PLN' });
  });

  test('P-07 — accepte { supplier_unit_price: 150.00, supplier_currency: "AED" }', () => {
    const result = requireSupplierMoney({ supplier_unit_price: 150, supplier_currency: 'AED' });
    expect(result).toEqual({ amount: 150, currency: 'AED' });
  });

  test('P-08 — rejette { supplier_unit_price: NaN, supplier_currency: "" }', () => {
    expect(() => requireSupplierMoney({ supplier_unit_price: NaN, supplier_currency: '' }))
      .toThrow('SUPPLIER_MONEY_UNAVAILABLE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-09..P-11  Supplier Order Identity
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-09..P-11 — Supplier Order Identity', () => {
  const { normalizeIdentity, BLOCKED_SUPPLIER_IDENTITY } = require('../../services/suppliers/supplier-order-identity');

  test('P-09 — normalizeIdentity accepte SOI Allegro v1 sandbox', () => {
    const result = normalizeIdentity(ALLEGRO_SOI, ALLEGRO_SUPPLIER_UNIT_REF);
    expect(result.provider).toBe('allegro');
    expect(result.version).toBe(1);
    expect(result.payload).toEqual(ALLEGRO_SOI.payload);
  });

  test('P-10 — normalizeIdentity rejette SOI sans provider', () => {
    expect(() => normalizeIdentity({ version: 1, payload: { x: 1 } }, 'ref'))
      .toThrow(BLOCKED_SUPPLIER_IDENTITY);
  });

  test('P-11 — normalizeIdentity rejette SOI sans supplier_unit_ref', () => {
    expect(() => normalizeIdentity(ALLEGRO_SOI, null))
      .toThrow(BLOCKED_SUPPLIER_IDENTITY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-12..P-13  Allegro fulfillment adapter identity
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-12..P-13 — Allegro adapter exactOfferId', () => {
  const { exactOfferId } = require('../../services/suppliers/allegro-fulfillment-adapter');

  const validRow = {
    supplier_unit_ref: '7782182471',
    supplier_sku: 'allegro-sandbox:7782182471',
  };

  test('P-12 — accepte identity Allegro sandbox correcte', () => {
    const id = exactOfferId(validRow, ALLEGRO_SOI);
    expect(id).toBe('7782182471');
  });

  test('P-13 — rejette un mismatch provider', () => {
    const wrongIdentity = { ...ALLEGRO_SOI, provider: 'noon' };
    const id = exactOfferId(validRow, wrongIdentity);
    expect(id).toBeNull();
  });

  test('P-13b — rejette un mismatch environment', () => {
    const wrongEnv = {
      ...ALLEGRO_SOI,
      payload: { ...ALLEGRO_SOI.payload, environment: 'production' },
    };
    const id = exactOfferId(validRow, wrongEnv);
    expect(id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-14..P-15  Allegro reconciliation
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-14..P-15 — Allegro purchase reconciliation', () => {
  const { verifyCheckoutForm } = require('../../services/suppliers/allegro-purchase-reconciliation');

  const validPayload = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    status: 'READY_FOR_PROCESSING',
    revision: 'rev-1',
    lineItems: [{
      id: 'line-1',
      offer: { id: '7782182471' },
      quantity: 1,
      price: { amount: '29.90', currency: 'PLN' },
      boughtAt: '2026-09-17T10:00:00Z',
    }],
  };

  const reconcileOptions = {
    checkoutFormId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    identity: ALLEGRO_SOI,
    supplierUnitRef: '7782182471',
    supplierSku: 'allegro-sandbox:7782182471',
    quantity: 1,
  };

  test('P-14 — accepte une réponse READY_FOR_PROCESSING correcte', () => {
    const result = verifyCheckoutForm(validPayload, reconcileOptions);
    expect(result.verified).toBe(true);
    expect(result.provider).toBe('allegro');
    expect(result.environment).toBe('sandbox');
    expect(result.unit_price).toBe(29.90);
    expect(result.currency).toBe('PLN');
    expect(result.quantity).toBe(1);
  });

  test('P-15 — rejette status BOUGHT (payment not confirmed)', () => {
    const boughtPayload = { ...validPayload, status: 'BOUGHT' };
    expect(() => verifyCheckoutForm(boughtPayload, reconcileOptions))
      .toThrow(/ALLEGRO_RECONCILIATION_NOT_READY/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-16..P-17  PO DB constraint simulation (migration content verification)
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-16..P-17 — PO supplier money pair constraint', () => {
  test('P-16 — migration 239 constraint accepte (supplier_unit_price > 0, currency 3-letter)', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '239_purchase_orders_canonical_supplier_money.sql'),
      'utf8'
    );
    // The CHECK constraint allows: (price > 0 AND currency ~ '^[A-Z]{3}$')
    expect(migration).toMatch(/supplier_unit_price > 0/);
    expect(migration).toMatch(/supplier_currency ~ '\^\[A-Z\]\{3\}\$'/);
  });

  test('P-17 — migration 239 constraint also allows both NULL (legacy compat)', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '239_purchase_orders_canonical_supplier_money.sql'),
      'utf8'
    );
    expect(migration).toMatch(/supplier_unit_price IS NULL AND supplier_currency IS NULL/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-18  Idempotence
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-18 — Idempotence (unique index)', () => {
  test('P-18 — migration 225 crée l\'index unique ux_purchase_orders_order_item_supplier_active', () => {
    expect(migrationContains('225_', 'ux_purchase_orders_order_item_supplier_active')).toBe(true);
    // Verify it's a partial unique index on order_item_id + product_supplier_id
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '225_purchase_orders_exact_supplier_identity.sql'),
      'utf8'
    );
    expect(migration).toMatch(/UNIQUE INDEX.*ux_purchase_orders_order_item_supplier_active/);
    expect(migration).toMatch(/order_item_id, product_supplier_id/);
    expect(migration).toMatch(/status <> 'cancelled'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-19  Flow routing
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-19 — trigger_mode pour Allegro', () => {
  test('P-19 — platform=allegro + auto_order=false → triggerMode=manual (code path)', () => {
    // Verify from source code that the triggerMode logic is:
    //   auto_order ? 'auto' : (platform === 'whatsapp' ? 'whatsapp' : 'manual')
    const src = fs.readFileSync(
      path.join(ROOT, 'services', 'purchasing-trigger-service.js'),
      'utf8'
    );
    // The exact line should compute triggerMode for non-whatsapp, non-auto as 'manual'
    expect(src).toMatch(/triggerMode\s*=\s*ps\.auto_order\s*\?\s*'auto'\s*:/);
    expect(src).toMatch(/ps\.platform\s*===\s*'whatsapp'\s*\?\s*'whatsapp'\s*:\s*'manual'/);
    // For allegro with auto_order=false: platform !== 'whatsapp' → 'manual' ✓
  });

  test('P-19b — purchase_orders.trigger_mode CHECK inclut manual', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
    expect(schema).toMatch(/purchase_orders_trigger_mode_check.*manual/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P-20  Legacy fallback fail-closed
// ═══════════════════════════════════════════════════════════════════════════════

describe('P-20 — Legacy fallback fail-closed', () => {
  const { _requireSupplierMoney: requireSupplierMoney } = require('../../services/purchasing-trigger-service');

  test('P-20 — legacy path (sku_id=null) avec supplier_price_aed=null → SUPPLIER_MONEY_UNAVAILABLE', () => {
    // Simulate the legacy path where exactSku is null:
    // purchaseTarget = { ...ps, supplier_unit_price: Number(null), supplier_currency: 'AED' }
    // Number(null) = 0, which fails the > 0 check
    const legacyTarget = {
      supplier_price_aed: null,
    };
    // The code does: Number(target?.supplier_unit_price ?? target?.supplier_price_aed)
    // With only supplier_price_aed=null: amount = Number(null) = 0
    expect(() => requireSupplierMoney(legacyTarget))
      .toThrow('SUPPLIER_MONEY_UNAVAILABLE');
  });

  test('P-20b — legacy path avec supplier_price_aed > 0 → accepte en AED', () => {
    const legacyTarget = {
      supplier_price_aed: 150,
    };
    const result = requireSupplierMoney(legacyTarget);
    expect(result).toEqual({ amount: 150, currency: 'AED' });
  });
});
