'use strict';

const fs = require('fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.writeFileSync(file, content);
}

function replaceOnce(file, before, after) {
  let source = read(file);
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Expected reconciliation marker missing in ${file}: ${before.slice(0, 100)}`);
  }
  source = source.replace(before, after);
  write(file, source);
}

const modalTest = 'tests/unit/modal-mobile-canonical.test.js';
replaceOnce(
  modalTest,
  "const CANONICAL_CSS_PATH = path.join(\n",
  "const PRODUCT_FIELDS_PATH = path.join(\n  __dirname,\n  '../../public/boutique/js/b-modal-product-fields.js'\n);\n\nconst CANONICAL_CSS_PATH = path.join(\n"
);
replaceOnce(
  modalTest,
  "  test('imports only getCurrentPrice from buybox-shared', () => {\n    expect(source).toMatch(/import\\s*\\{\\s*getCurrentPrice\\s*\\}\\s*from\\s*['\"]\\.\\/b-modal-buybox-shared/);\n  });",
  "  test('delegates scalar fields to product-fields and keeps only the buy-now wiring locally', () => {\n    expect(source).toMatch(/import\\s*\\{\\s*paintDetailFields\\s*\\}\\s*from\\s*['\"]\\.\\/b-modal-product-fields/);\n    expect(source).toMatch(/import\\s*\\{\\s*wireBuyNowButton\\s*\\}\\s*from\\s*['\"]\\.\\/b-modal-buybox-shared/);\n    expect(source).not.toMatch(/getCurrentPrice/);\n  });"
);
replaceOnce(
  modalTest,
  "  test('old_price only when contract provides it (not reconstructed from promo_pct)', () => {\n    const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');\n    // Should check detail.pricing.old_price_kmf != null\n    expect(source).toMatch(/old_price_kmf\\s*!=\\s*null/);\n    // Should NOT multiply or compute old price\n    expect(source).not.toMatch(/price_kmf\\s*\\*\\s*\\(/);\n    expect(source).not.toMatch(/price_kmf\\s*\\/\\s*\\(/);\n  });\n\n  test('promo badge uses promo_pct from contract', () => {\n    const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');\n    expect(source).toMatch(/pricing\\.promo_pct/);\n  });",
  "  test('old_price only when contract provides it (not reconstructed from promo_pct)', () => {\n    const fieldsSource = fs.readFileSync(PRODUCT_FIELDS_PATH, 'utf8');\n    // Scalar fields are owned once for desktop and mobile by paintDetailFields().\n    expect(fieldsSource).toMatch(/old_price_kmf/);\n    expect(fieldsSource).toMatch(/oldPrice\\s*!=\\s*null/);\n    expect(fieldsSource).not.toMatch(/price_kmf\\s*\\*\\s*\\(/);\n    expect(fieldsSource).not.toMatch(/price_kmf\\s*\\/\\s*\\(/);\n  });\n\n  test('promo badge uses promo_pct from contract through the scalar-fields owner', () => {\n    const fieldsSource = fs.readFileSync(PRODUCT_FIELDS_PATH, 'utf8');\n    expect(fieldsSource).toMatch(/pricing\\.promo_pct/);\n    expect(source).toMatch(/paintDetailFields\\(detail, selection\\)/);\n  });"
);
replaceOnce(
  modalTest,
  "    // 1. options (axes) → 2. selection message → 3. info strip → 4. below fold\n    // → 5. identity → 6. actions → 7. media",
  "    // 1. info strip → 2. options (axes) → 3. selection message → 4. below fold\n    // → 5. identity → 6. actions → 7. media"
);
replaceOnce(
  modalTest,
  "    expect(axisPos).toBeLessThan(msgPos);\n    expect(msgPos).toBeLessThan(stripPos);\n    expect(stripPos).toBeLessThan(foldPos);",
  "    expect(stripPos).toBeLessThan(axisPos);\n    expect(axisPos).toBeLessThan(msgPos);\n    expect(msgPos).toBeLessThan(foldPos);"
);

replaceOnce(
  'public/boutique/js/b-modal-mobile-product.js',
  " *   1. Options (axes) — rendered into #k-modal-variants container\n *   2. Selection message\n *   3. Info strip (availability + delivery chips)\n *   4. Below-fold content (description)",
  " *   1. Info strip (availability + delivery chips)\n *   2. Options (axes) — rendered into #k-modal-variants container\n *   3. Selection message\n *   4. Below-fold content (description)"
);

const catalogTest = 'tests/unit/catalog-product-detail.test.js';
replaceOnce(
  catalogTest,
  "  test('AIR_EXPRESS apparaît automatiquement quand logistics le rend commercial', () => {",
  "  test('AIR_EXPRESS apparaît quand logistics le rend commercial et le produit est éligible', () => {"
);
replaceOnce(
  catalogTest,
  "    expect(_buildDeliveryOptions().map((option) => [option.code, option.label])).toEqual([",
  "    expect(_buildDeliveryOptions({ air_eligibility_status: 'ELIGIBLE' })\n      .map((option) => [option.code, option.label])).toEqual(["
);

const loyaltyTest = 'tests/unit/post-o8-loyalty-seams.test.js';
replaceOnce(
  loyaltyTest,
  "    const TIER_LABEL = 'itest-post-o8-tier';",
  "    const TIER_LABEL = `itest-post-o8-tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;"
);
replaceOnce(
  loyaltyTest,
  "    let tierId;\n    let user;",
  "    let tierId;\n    let relaisId;\n    let user;"
);
replaceOnce(
  loyaltyTest,
  "      tierId = tier.id;\n      user = await createUser({ role: 'client' });",
  "      tierId = tier.id;\n      const { rows: [relais] } = await db.query(\n        `INSERT INTO relais (name, agent_name, phone, address, island)\n         VALUES ($1, 'ITest Loyalty', $2, 'Adresse test loyalty', 'Anjouan')\n         RETURNING id`,\n        [`ITest Loyalty ${Date.now()}`, `+2693${Math.floor(1000000 + Math.random() * 8999999)}`]\n      );\n      relaisId = relais.id;\n      user = await createUser({ role: 'client' });"
);
replaceOnce(
  loyaltyTest,
  "        `INSERT INTO orders (reference, user_id, total_kmf, total_eur, payment_mode, payment_status, status)\n         VALUES ($1, $2, 10000, 20, 'cash_relais', 'paid', 'collected')`,\n        [`ITEST-LOYALTY-${Date.now()}`, user.id]",
  "        `INSERT INTO orders (reference, user_id, relais_id, total_kmf, total_eur, payment_mode, payment_status, status)\n         VALUES ($1, $2, $3, 10000, 20, 'cash_relais', 'paid', 'collected')`,\n        [`ITEST-LOYALTY-${Date.now()}`, user.id, relaisId]"
);
replaceOnce(
  loyaltyTest,
  "      await db.query(`DELETE FROM orders WHERE user_id = $1`, [user.id]).catch(() => {});\n      await cleanup();\n      await db.query(`DELETE FROM loyalty_tiers WHERE id = $1`, [tierId]).catch(() => {});",
  "      if (user?.id) await db.query(`DELETE FROM orders WHERE user_id = $1`, [user.id]).catch(() => {});\n      await cleanup();\n      if (relaisId) await db.query(`DELETE FROM relais WHERE id = $1`, [relaisId]).catch(() => {});\n      if (tierId) await db.query(`DELETE FROM loyalty_tiers WHERE id = $1`, [tierId]).catch(() => {});"
);

console.log('Final test-governance reconciliation applied.');
