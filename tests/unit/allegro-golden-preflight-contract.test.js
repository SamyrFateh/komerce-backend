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
 * v2 — rebasée sur main incluant PR #1592 (suppliers_platform_check fermé).
 * Tous les tests doivent passer. Si un test échoue, le Golden ne doit
 * PAS être lancé tant que la cause n'est pas résolue.
 *
 * P-01..P-02  suppliers_platform_check + validator
 * P-03..P-05  DB schema contracts (colonnes, nullabilité)
 * P-06..P-08  Canonical money resolution
 * P-09..P-11  Supplier Order Identity
 * P-12..P-13  Allegro fulfillment adapter identity
 * P-14..P-15  Allegro reconciliation
 * P-16..P-17  PO DB constraint simulation
 * P-18        Idempotence
 * P-19        Flow routing (trigger_mode)
 * P-20        Legacy fallback fail-closed
 * G-01..G-02  Governance — railway-live-schema.sql baseline safety
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractPlatformsFromSchema(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const match = src.match(
    /suppliers_platform_check\s+CHECK\s*\(\(platform\s*=\s*ANY\s*\(ARRAY\[([^\]]+)\]/
  );
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/::text/g, '').replace(/['"]/g, '')).filter(Boolean);
}

function extractPlatformsFromValidator() {
  // L'autorité canonique vit dans services/suppliers/provider-authority.js.
  // Depuis GAP-1 v2 elle est consommée par purchasing-validators.js
  // (@domain purchasing), jamais par validators/index.js (@domain
  // infrastructure) — cf. tests/unit/provider-authority.test.js.
  const { PROVIDERS } = require('../../services/suppliers/provider-authority');
  return [...PROVIDERS];
}

function migrationContains(pattern, text) {
  const dir = path.join(ROOT, 'migrations');
  const file = fs.readdirSync(dir).find(f => f.includes(pattern));
  if (!file) return false;
  return fs.readFileSync(path.join(dir, file), 'utf8').includes(text);
}

const ALLEGRO_SOI = {
  provider: 'allegro',
  version: 1,
  payload: { environment: 'sandbox', offer_id: '7782182471' },
};

// ═════════════════════════════════════════════════════════════════════════════
// P-01..P-02  suppliers_platform_check + validator
// ═════════════════════════════════════════════════════════════════════════════

describe('P-01/P-02 — suppliers platform allowlist', () => {
  test('P-01 — db/schema.sql suppliers_platform_check inclut allegro', () => {
    expect(extractPlatformsFromSchema(path.join(ROOT, 'db', 'schema.sql')))
      .toContain('allegro');
  });

  test('P-02 — validators/index.js PLATFORMS inclut allegro', () => {
    expect(extractPlatformsFromValidator()).toContain('allegro');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-03..P-05  DB schema contracts (migrations)
// ═════════════════════════════════════════════════════════════════════════════

describe('P-03..P-05 — DB schema contracts', () => {
  test('P-03 — migration 239 ajoute supplier_unit_price et supplier_currency', () => {
    expect(migrationContains('239_', 'supplier_unit_price')).toBe(true);
    expect(migrationContains('239_', 'supplier_currency')).toBe(true);
  });

  test('P-04 — migration 225 ajoute supplier_order_identity et product_sku_id', () => {
    expect(migrationContains('225_', 'supplier_order_identity')).toBe(true);
    expect(migrationContains('225_', 'product_sku_id')).toBe(true);
  });

  test('P-05 — migration 239 rend product_suppliers.supplier_price_aed nullable', () => {
    expect(migrationContains('239_', 'supplier_price_aed DROP NOT NULL')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-06..P-08  Canonical money
// ═════════════════════════════════════════════════════════════════════════════

describe('P-06..P-08 — requireSupplierMoney', () => {
  const { _requireSupplierMoney: requireSupplierMoney } = require('../../services/purchasing-trigger-service');

  test('P-06 — accepte 29.90 PLN', () => {
    expect(requireSupplierMoney({ supplier_unit_price: 29.90, supplier_currency: 'PLN' }))
      .toEqual({ amount: 29.90, currency: 'PLN' });
  });

  test('P-07 — accepte 150 AED (legacy compat)', () => {
    expect(requireSupplierMoney({ supplier_unit_price: 150, supplier_currency: 'AED' }))
      .toEqual({ amount: 150, currency: 'AED' });
  });

  test('P-08 — rejette NaN / vide', () => {
    expect(() => requireSupplierMoney({ supplier_unit_price: NaN, supplier_currency: '' }))
      .toThrow('SUPPLIER_MONEY_UNAVAILABLE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-09..P-11  Supplier Order Identity
// ═════════════════════════════════════════════════════════════════════════════

describe('P-09..P-11 — Supplier Order Identity', () => {
  const { normalizeIdentity, BLOCKED_SUPPLIER_IDENTITY } = require('../../services/suppliers/supplier-order-identity');

  test('P-09 — accepte SOI Allegro v1 sandbox', () => {
    const result = normalizeIdentity(ALLEGRO_SOI, '7782182471');
    expect(result.provider).toBe('allegro');
    expect(result.version).toBe(1);
    expect(result.payload.environment).toBe('sandbox');
  });

  test('P-10 — rejette SOI sans provider', () => {
    expect(() => normalizeIdentity({ version: 1, payload: { x: 1 } }, 'ref'))
      .toThrow(BLOCKED_SUPPLIER_IDENTITY);
  });

  test('P-11 — rejette SOI sans supplier_unit_ref', () => {
    expect(() => normalizeIdentity(ALLEGRO_SOI, null))
      .toThrow(BLOCKED_SUPPLIER_IDENTITY);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-12..P-13  Allegro fulfillment adapter
// ═════════════════════════════════════════════════════════════════════════════

describe('P-12..P-13 — Allegro adapter exactOfferId', () => {
  const { exactOfferId } = require('../../services/suppliers/allegro-fulfillment-adapter');
  const row = { supplier_unit_ref: '7782182471', supplier_sku: 'allegro-sandbox:7782182471' };

  test('P-12 — accepte identity Allegro sandbox correcte', () => {
    expect(exactOfferId(row, ALLEGRO_SOI)).toBe('7782182471');
  });

  test('P-13 — rejette mismatch provider/environment', () => {
    expect(exactOfferId(row, { ...ALLEGRO_SOI, provider: 'noon' })).toBeNull();
    expect(exactOfferId(row, {
      ...ALLEGRO_SOI,
      payload: { ...ALLEGRO_SOI.payload, environment: 'production' },
    })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-14..P-15  Allegro reconciliation
// ═════════════════════════════════════════════════════════════════════════════

describe('P-14..P-15 — Allegro reconciliation', () => {
  const { verifyCheckoutForm } = require('../../services/suppliers/allegro-purchase-reconciliation');

  const payload = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    status: 'READY_FOR_PROCESSING',
    revision: 'rev-1',
    lineItems: [{
      id: 'line-1', offer: { id: '7782182471' }, quantity: 1,
      price: { amount: '29.90', currency: 'PLN' }, boughtAt: '2026-09-17T10:00:00Z',
    }],
  };

  const opts = {
    checkoutFormId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    identity: ALLEGRO_SOI, supplierUnitRef: '7782182471',
    supplierSku: 'allegro-sandbox:7782182471', quantity: 1,
  };

  test('P-14 — accepte READY_FOR_PROCESSING', () => {
    const r = verifyCheckoutForm(payload, opts);
    expect(r.verified).toBe(true);
    expect(r.unit_price).toBe(29.90);
    expect(r.currency).toBe('PLN');
  });

  test('P-15 — rejette status BOUGHT', () => {
    expect(() => verifyCheckoutForm({ ...payload, status: 'BOUGHT' }, opts))
      .toThrow(/ALLEGRO_RECONCILIATION_NOT_READY/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-16..P-17  PO constraint
// ═════════════════════════════════════════════════════════════════════════════

describe('P-16..P-17 — PO supplier money pair constraint', () => {
  test('P-16 — constraint accepte (price > 0, currency 3-letter) ou both NULL', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'migrations', '239_purchase_orders_canonical_supplier_money.sql'), 'utf8'
    );
    expect(src).toMatch(/supplier_unit_price > 0/);
    expect(src).toMatch(/supplier_currency ~ '\^\[A-Z\]\{3\}\$'/);
    expect(src).toMatch(/supplier_unit_price IS NULL AND supplier_currency IS NULL/);
  });

  test('P-17 — migration 240 existe et est forward-only', () => {
    const dir = path.join(ROOT, 'migrations');
    const file = fs.readdirSync(dir).find(f => f.startsWith('240_'));
    expect(file).toBeDefined();
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    expect(content).toMatch(/DROP CONSTRAINT/i);
    expect(content).toMatch(/ADD CONSTRAINT\s+suppliers_platform_check/i);
    expect(content).not.toMatch(/DROP TABLE/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-18  Idempotence
// ═════════════════════════════════════════════════════════════════════════════

describe('P-18 — Idempotence', () => {
  test('P-18 — migration 225 crée unique index partiel order_item + product_supplier', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'migrations', '225_purchase_orders_exact_supplier_identity.sql'), 'utf8'
    );
    expect(src).toMatch(/UNIQUE INDEX.*ux_purchase_orders_order_item_supplier_active/);
    expect(src).toMatch(/order_item_id, product_supplier_id/);
    expect(src).toMatch(/status <> 'cancelled'/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-19  Flow routing
// ═════════════════════════════════════════════════════════════════════════════

describe('P-19 — trigger_mode Allegro = manual', () => {
  test('P-19 — code route auto_order=false + platform≠whatsapp → manual', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'services', 'purchasing-trigger-service.js'), 'utf8'
    );
    expect(src).toMatch(/triggerMode\s*=\s*ps\.auto_order\s*\?\s*'auto'\s*:/);
    expect(src).toMatch(/ps\.platform\s*===\s*'whatsapp'\s*\?\s*'whatsapp'\s*:\s*'manual'/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P-20  Legacy fallback fail-closed
// ═════════════════════════════════════════════════════════════════════════════

describe('P-20 — Legacy fallback fail-closed', () => {
  const { _requireSupplierMoney: requireSupplierMoney } = require('../../services/purchasing-trigger-service');

  test('P-20 — legacy path supplier_price_aed=null → SUPPLIER_MONEY_UNAVAILABLE', () => {
    expect(() => requireSupplierMoney({ supplier_price_aed: null }))
      .toThrow('SUPPLIER_MONEY_UNAVAILABLE');
  });

  test('P-20b — legacy path supplier_price_aed=150 → accepte en AED', () => {
    expect(requireSupplierMoney({ supplier_price_aed: 150 }))
      .toEqual({ amount: 150, currency: 'AED' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// G-01..G-02  Governance — schema dump baseline safety
// ═════════════════════════════════════════════════════════════════════════════

describe('G-01..G-02 — railway-live-schema.sql baseline safety', () => {
  test('G-01 — le dump commit n\'est pas un commit de cette branche', () => {
    // Le dump commit doit rester cdea3f05 (la dernière vraie snapshot).
    // Si un commit de PR touche le dump, il déplace la baseline et casse
    // l'application des migrations Mode B en CI.
    const { execSync } = require('child_process');
    const dumpCommit = execSync(
      'git log --format="%H" -1 -- docs/db/railway-live-schema.sql',
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    const headCommit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    // Le dump commit ne doit PAS être le HEAD (sinon on a touché le dump)
    expect(dumpCommit).not.toBe(headCommit);
  });

  test('G-02 — migration 240 est post-snapshot (Mode B)', () => {
    const { execSync } = require('child_process');
    const dumpCommit = execSync(
      'git log --format="%H" -1 -- docs/db/railway-live-schema.sql',
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    const listing = execSync(
      `git ls-tree -r --name-only "${dumpCommit}" -- migrations/`,
      { cwd: ROOT, encoding: 'utf8' }
    );
    const baselineFiles = listing.split('\n').map(p => path.basename(p));
    // 240 must NOT be in the baseline — it should be applied as Mode B
    expect(baselineFiles.some(f => f.startsWith('240_'))).toBe(false);
  });
});
