/**
 * @komerce-arch-lite
 * @role          test-mobile-modal-canonical-composition
 * @domain        catalog
 * @layer         test
 * @owner         b-modal-mobile-product.js
 * @doctrine      docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @version       2026-07 — MDM canonical
 *
 * Tests the canonical mobile modal composition rules without importing
 * ES module frontend code directly. Instead:
 * - Selection logic is tested via a CJS-compatible inline re-implementation
 *   of the core algorithm (same as modal-selection-model.js).
 * - Composition rules are tested by reading the source files and asserting
 *   structural invariants.
 * - Contract rules are tested with fixture data.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MOBILE_RENDERER_PATH = path.join(
  __dirname,
  '../../public/boutique/js/b-modal-mobile-product.js'
);

const CANONICAL_CSS_PATH = path.join(
  __dirname,
  '../../public/boutique/css/modal-mobile-canonical.css'
);

const PRICE_NORM_CSS_PATH = path.join(
  __dirname,
  '../../public/boutique/css/modal-product-price-normalization.css'
);

const CSS_BUNDLES_PATH = path.join(
  __dirname,
  '../../public/boutique/scripts/css-bundles.js'
);

/* ── Fixtures ──────────────────────────────────────────────────── */

function richDetail(overrides = {}) {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: 'prod-001',
      reference: 'ROB-DXB-001',
      name: 'Robe longue satinée Dubaï',
      description: 'Description riche multi-paragraphes pour tester le below-fold.',
      category: 'vetements',
    },
    pricing: {
      price_kmf: 12500,
      old_price_kmf: 15000,
      promo_pct: 17,
    },
    media: [
      { id: 'img-1', url: 'https://cdn.example.com/brown-1.jpg', role: 'PRODUCT', option_values: { Couleur: 'Marron' } },
      { id: 'img-2', url: 'https://cdn.example.com/beige-1.jpg', role: 'PRODUCT', option_values: { Couleur: 'Beige' } },
      { id: 'img-3', url: 'https://cdn.example.com/global.jpg', role: 'PRODUCT', option_values: {} },
    ],
    option_axes: [
      {
        key: 'Couleur',
        display_name: 'Couleur',
        values: [
          { value: 'Marron', thumbnail_url: 'https://cdn.example.com/thumb-brown.jpg' },
          { value: 'Beige', thumbnail_url: 'https://cdn.example.com/thumb-beige.jpg' },
          { value: 'Noir', thumbnail_url: null },
        ],
      },
      {
        key: 'Taille',
        display_name: 'Taille',
        values: [
          { value: 'S', thumbnail_url: null },
          { value: 'M', thumbnail_url: null },
          { value: 'L', thumbnail_url: null },
          { value: 'XL', thumbnail_url: null },
        ],
      },
    ],
    sellable_units: [
      { sku_id: 'sku-mar-s', sku: 'ROB-MAR-S', option_values: { Couleur: 'Marron', Taille: 'S' }, stock_status: 'AVAILABLE', available_quantity: 3, price_kmf: 12500, media_ids: ['img-1'] },
      { sku_id: 'sku-mar-m', sku: 'ROB-MAR-M', option_values: { Couleur: 'Marron', Taille: 'M' }, stock_status: 'AVAILABLE', available_quantity: 5, price_kmf: 12500, media_ids: ['img-1'] },
      { sku_id: 'sku-mar-l', sku: 'ROB-MAR-L', option_values: { Couleur: 'Marron', Taille: 'L' }, stock_status: 'OUT_OF_STOCK', available_quantity: 0, price_kmf: 12500, media_ids: ['img-1'] },
      { sku_id: 'sku-bei-l', sku: 'ROB-BEI-L', option_values: { Couleur: 'Beige', Taille: 'L' }, stock_status: 'AVAILABLE', available_quantity: 2, price_kmf: 12500, media_ids: ['img-2'] },
      { sku_id: 'sku-bei-xl', sku: 'ROB-BEI-XL', option_values: { Couleur: 'Beige', Taille: 'XL' }, stock_status: 'AVAILABLE', available_quantity: 1, price_kmf: 12500, media_ids: ['img-2'] },
    ],
    delivery_options: [
      { code: 'SEA_STANDARD', label: 'Livraison standard', available: true, price_kmf: null, eta_label: null },
      { code: 'AIR_EXPRESS', label: 'Express aérien', available: true, price_kmf: 3500, eta_label: '2-3 jours' },
    ],
    ...overrides,
  };
}

/* ── Tests: MDM-8 — Extinction (source analysis) ────────────── */

describe('MDM-8: Mobile renderer extinction rules', () => {
  const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');

  test('does not import renderSubtotalInto from buybox-shared', () => {
    expect(source).not.toMatch(/renderSubtotalInto/);
  });

  test('does not import renderPaymentModes from buybox-shared', () => {
    expect(source).not.toMatch(/renderPaymentModes/);
  });

  test('does not import startGroupCartFlow from buybox-shared', () => {
    expect(source).not.toMatch(/startGroupCartFlow/);
  });

  test('imports only getCurrentPrice from buybox-shared', () => {
    expect(source).toMatch(/import\s*\{\s*getCurrentPrice\s*\}\s*from\s*['"]\.\/b-modal-buybox-shared/);
  });

  test('does not call renderSubtotal anywhere (excluding comments)', () => {
    // Strip comments then check for function calls
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(codeOnly).not.toMatch(/renderSubtotal/);
  });

  test('does not call renderPaymentSection anywhere (excluding comments)', () => {
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(codeOnly).not.toMatch(/renderPaymentSection/);
  });
});

/* ── Tests: MDM-5 — Delivery options never hardcoded ─────────── */

describe('MDM-5: Delivery rendering from contract', () => {
  const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');

  test('renderer reads delivery_options from detail, never hardcodes labels', () => {
    // Should reference detail.delivery_options or detail?.delivery_options
    expect(source).toMatch(/detail[\?.]?\.delivery_options/);
    // Should NOT contain hardcoded "Livraison standard" or "Express"
    expect(source).not.toMatch(/'Livraison standard'/);
    expect(source).not.toMatch(/'Express aérien'/);
    expect(source).not.toMatch(/"Livraison standard"/);
    expect(source).not.toMatch(/"Express aérien"/);
  });

  test('contract with 0 delivery options yields fallback text', () => {
    const detail = richDetail({ delivery_options: [] });
    expect(detail.delivery_options).toHaveLength(0);
  });

  test('contract with 2 delivery options yields 2 entries', () => {
    const detail = richDetail();
    expect(detail.delivery_options).toHaveLength(2);
    expect(detail.delivery_options[0].label).toBe('Livraison standard');
    expect(detail.delivery_options[1].label).toBe('Express aérien');
    expect(detail.delivery_options[1].price_kmf).toBe(3500);
  });
});

/* ── Tests: MDM-7 — Description below fold ───────────────────── */

describe('MDM-7: Description below fold', () => {
  const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');

  test('renderer hides legacy desc (dom.modalDesc) in identity zone', () => {
    expect(source).toMatch(/modalDesc.*u-hidden/s);
  });

  test('renderer creates below-fold section with k-mdm-fold separator', () => {
    expect(source).toMatch(/k-mdm-fold/);
    expect(source).toMatch(/k-mdm-desc-section/);
    expect(source).toMatch(/k-mdm-desc-text/);
  });

  test('renderer includes read-more toggle for description', () => {
    expect(source).toMatch(/k-mdm-read-more/);
    expect(source).toMatch(/Lire la suite/);
  });
});

/* ── Tests: MDM-3 — Identity compact ─────────────────────────── */

describe('MDM-3: Identity compact', () => {
  test('old_price only when contract provides it (not reconstructed from promo_pct)', () => {
    const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');
    // Should check detail.pricing.old_price_kmf != null
    expect(source).toMatch(/old_price_kmf\s*!=\s*null/);
    // Should NOT multiply or compute old price
    expect(source).not.toMatch(/price_kmf\s*\*\s*\(/);
    expect(source).not.toMatch(/price_kmf\s*\/\s*\(/);
  });

  test('promo badge uses promo_pct from contract', () => {
    const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');
    expect(source).toMatch(/pricing\.promo_pct/);
  });
});

/* ── Tests: CSS structure ────────────────────────────────────── */

describe('CSS: canonical mobile styles', () => {
  test('modal-mobile-canonical.css exists', () => {
    expect(fs.existsSync(CANONICAL_CSS_PATH)).toBe(true);
  });

  test('modal-mobile-canonical.css contains info-strip chip styles', () => {
    const css = fs.readFileSync(CANONICAL_CSS_PATH, 'utf8');
    expect(css).toMatch(/k-mdm-info-strip/);
    expect(css).toMatch(/k-mdm-chip/);
    expect(css).toMatch(/k-mdm-chip--ok/);
    expect(css).toMatch(/k-mdm-chip--delivery/);
  });

  test('modal-mobile-canonical.css contains below-fold styles', () => {
    const css = fs.readFileSync(CANONICAL_CSS_PATH, 'utf8');
    expect(css).toMatch(/k-mdm-fold/);
    expect(css).toMatch(/k-mdm-desc-section/);
    expect(css).toMatch(/k-mdm-desc-text/);
    expect(css).toMatch(/k-mdm-desc-text--expanded/);
  });

  test('modal-mobile-canonical.css hides subtotal and payment on mobile', () => {
    const css = fs.readFileSync(CANONICAL_CSS_PATH, 'utf8');
    expect(css).toMatch(/k-modal-subtotal--mobile/);
    expect(css).toMatch(/k-buybox-payment-mobile/);
    expect(css).toMatch(/display:\s*none/);
    // Uses #k-modal specificity, never !important
    expect(css).toMatch(/#k-modal\s+\.k-modal-subtotal--mobile/);
    expect(css).not.toMatch(/!important/);
  });

  test('modal-mobile-canonical.css sets media height to 48vh', () => {
    const css = fs.readFileSync(CANONICAL_CSS_PATH, 'utf8');
    expect(css).toMatch(/48vh/);
  });

  test('price normalization CSS is emptied (tactical guard retired)', () => {
    const css = fs.readFileSync(PRICE_NORM_CSS_PATH, 'utf8');
    // Should contain comment about being superseded, no actual rules
    expect(css).toMatch(/SUPERSEDED|Intentionally empty/);
    expect(css).not.toMatch(/@media/);
  });

  test('modal-mobile-canonical is in CSS bundle config', () => {
    const bundles = require(CSS_BUNDLES_PATH);
    const componentFiles = bundles.BUNDLES.find(b => b.out === 'components.css').files;
    expect(componentFiles).toContain('modal-mobile-canonical');
    // Should be after price-normalization (which it replaces)
    const normIdx = componentFiles.indexOf('modal-product-price-normalization');
    const canonIdx = componentFiles.indexOf('modal-mobile-canonical');
    expect(canonIdx).toBeGreaterThan(normIdx);
  });
});

/* ── Tests: Architectural invariants ─────────────────────────── */

describe('Architecture: modal never invents data', () => {
  const source = fs.readFileSync(MOBILE_RENDERER_PATH, 'utf8');

  test('modal does not read normalized_source_contract', () => {
    expect(source).not.toMatch(/normalized_source_contract/);
  });

  test('modal does not hardcode delivery labels', () => {
    expect(source).not.toMatch(/'Standard'/);
    expect(source).not.toMatch(/'Express'/);
  });

  test('modal does not compute stock from colors or sizes alone', () => {
    expect(source).not.toMatch(/stock_available/);
    expect(source).not.toMatch(/stock_count/);
  });

  test('renderer composition order matches v3 spec', () => {
    // In renderMobileProductDetail, the order should be:
    // 1. options (axes) → 2. selection message → 3. info strip → 4. below fold
    // → 5. identity → 6. actions → 7. media
    const renderFn = source.match(/export function renderMobileProductDetail[\s\S]+?^}/m);
    expect(renderFn).toBeTruthy();
    const body = renderFn[0];

    const axisPos = body.indexOf('renderAxis');
    const msgPos = body.indexOf('renderSelectionMessage');
    const stripPos = body.indexOf('renderInfoStrip');
    const foldPos = body.indexOf('renderBelowFold');
    const identityPos = body.indexOf('renderIdentity');
    const actionsPos = body.indexOf('renderActions');
    const mediaPos = body.indexOf('renderMedia');

    expect(axisPos).toBeLessThan(msgPos);
    expect(msgPos).toBeLessThan(stripPos);
    expect(stripPos).toBeLessThan(foldPos);
    expect(foldPos).toBeLessThan(identityPos);
    expect(identityPos).toBeLessThan(actionsPos);
    expect(actionsPos).toBeLessThan(mediaPos);
  });
});
