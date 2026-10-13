'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

// Projection amont de la Golden (niveau L0 : SQL simulé, aucun fait réel). Elle ne prouve jamais un produit staging.
jest.mock('../../services/sourcing-canonical-unit-product-sku-resolution', () => {
  const actual = jest.requireActual('../../services/sourcing-canonical-unit-product-sku-resolution');
  return { ...actual, resolveCanonicalUnitForProductSku: jest.fn() };
});

const unitResolver = require('../../services/sourcing-canonical-unit-product-sku-resolution');
const { projectUpstreamEvidence, deriveReadiness, GATE, STAGE } = require('../../services/golden-upstream-evidence');

const PID = '11111111-1111-4111-8111-111111111111';
const gateOf = (report, key) => report.gates.find((g) => g.key === key);

// Faits canoniques complets : chaque test en retire un seul.
function facts(overrides = {}) {
  return {
    candidate: [{
      id: 'c1', product_id: PID, candidate_ref: 'KSC-1', state: 'imported_to_catalog', supplier_name: 'cj', supplier_product_id: 'P-9',
      raw_payload: { present: true }, normalized_source_contract: { schema_version: '2' },
      scan_result: { sourcing_decision: 'READY' }, scan_at: '2026-10-01', komerce_category: 'maison',
      run_ref: 'KIR-7', run_source_ref: 'src-cj', observed_at: '2026-10-01', promotion_status: null,
    }],
    source: [{ source_id: 'src-cj' }],
    observation: [{ capture_id: 'cap-1', observation_id: 'obs-1', observed_at: '2026-10-01' }],
    enrichment: [{ status: 'ok', created_at: '2026-10-02' }],
    media: [{ n: 3 }],
    skuCount: [{ n: 1 }],
    product: [{ id: PID, lifecycle_status: 'active', is_active: true }],
    candidateState: [{ state: 'imported_to_catalog', run_ref: 'KIR-7' }],
    skus: [{ id: 's1', supplier_unit_ref: 'U-1' }],
    exposure: [{ commercial_exposure: 'ENABLED' }],
    price: [{ status: 'LOCAL_ACTIVE', amount: '50000', currency: 'XAF', market_currency: 'XAF' }],
    ...overrides,
  };
}

function dbWith(f) {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM sourcing_candidates sc\s+LEFT JOIN LATERAL[\s\S]*LIMIT 3/.test(sql)) return { rows: f.candidate };
      if (/SELECT source_id FROM sourcing_sources/.test(sql)) return { rows: f.source };
      if (/FROM sourcing_observations/.test(sql)) return { rows: f.observation };
      if (/scan_at, komerce_category/.test(sql)) return { rows: f.candidate };
      if (/FROM catalog_enrichment_runs/.test(sql)) return { rows: f.enrichment };
      if (/FROM catalog_media/.test(sql)) return { rows: f.media };
      if (/COUNT\(\*\)::int AS n FROM product_skus/.test(sql)) return { rows: f.skuCount };
      if (/FROM products WHERE id/.test(sql)) return { rows: f.product };
      if (/SELECT state, run\.run_ref/.test(sql)) return { rows: f.candidateState };
      if (/SELECT id, supplier_unit_ref FROM product_skus/.test(sql)) return { rows: f.skus };
      if (/FROM product_market_exposure/.test(sql)) return { rows: f.exposure };
      if (/FROM product_market_price_drafts/.test(sql)) return { rows: f.price };
      if (/FROM orders WHERE reference/.test(sql)) return { rows: f.order || [] };
      if (/FROM order_items oi\s+LEFT JOIN product_skus/.test(sql)) return { rows: f.items || [] };
      if (/FROM purchase_lines pl/.test(sql)) { if (f.linesError) throw new Error('boom'); return { rows: f.lines || [] }; }
      throw new Error(`SQL inattendu : ${sql.slice(0, 60)}`);
    }),
  };
}

const okFetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: PID, purchasable: true, price_kmf: 37500, has_variants: false }) }));
const run = (f, extra = {}) => projectUpstreamEvidence(dbWith(f), { productId: PID, marketCode: 'KM', storefrontBaseUrl: 'https://staging.example', fetchImpl: okFetch, ...extra });

beforeEach(() => {
  unitResolver.resolveCanonicalUnitForProductSku.mockReset();
  unitResolver.resolveCanonicalUnitForProductSku.mockResolvedValue({ status: unitResolver.STATUS.RESOLVED, supplier_unit_ref: 'U-1' });
});

describe('projection amont de la Golden', () => {
  test('toutes les preuves canoniques → PRÊT POUR RECETTE, mais jamais certifiée', async () => {
    const report = await run(facts());
    expect(report.gates.map((g) => g.status)).toEqual([GATE.PROVED, GATE.PROVED, GATE.PROVED, GATE.PROVED]);
    expect(report.stage).toBe(STAGE.PRET);
    expect(report.certification).toBe('NON CERTIFIÉE');
    expect(report.ids).toMatchObject({ product_id: PID, market_code: 'KM' });
    expect(gateOf(report, 'SOURCE_PROVED').evidence).toMatchObject({ run_ref: 'KIR-7', capture_id: 'cap-1', observation_id: 'obs-1' });
  });

  test('1 · source/capture absente → refus', async () => {
    const noCandidate = await run(facts({ candidate: [] }));
    expect(gateOf(noCandidate, 'SOURCE_PROVED').status).toBe(GATE.NON_PROUVE);
    const noCapture = await run(facts({ observation: [] }));
    const gate = gateOf(noCapture, 'SOURCE_PROVED');
    expect(gate.status).toBe(GATE.NON_PROUVE);
    expect(gate.checks.find((c) => c.key === 'capture_observation').ok).toBe(false);
    expect(noCapture.stage).not.toBe(STAGE.PRET);
  });

  test('2 · raffinerie non validée → refus', async () => {
    const report = await run(facts({ enrichment: [], media: [{ n: 0 }] }));
    const gate = gateOf(report, 'REFINERY_PROVED');
    expect(gate.status).toBe(GATE.NON_PROUVE);
    expect(gate.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(['content_fr_enrichment_ok', 'media_present']);
    expect(report.stage).toBe(STAGE.PREUVE_MANQUANTE);
  });

  test('3 · catalogue non publié → refus', async () => {
    const report = await run(facts({ product: [{ id: PID, lifecycle_status: 'candidate', is_active: false }], exposure: [], price: [] }));
    const gate = gateOf(report, 'CATALOG_RELEASE_PROVED');
    expect(gate.status).toBe(GATE.NON_PROUVE);
    expect(gate.checks.find((c) => c.key === 'product_published').ok).toBe(false);
    expect(gate.checks.find((c) => c.key === 'market_exposure_enabled').ok).toBe(false);
    expect(gate.checks.find((c) => c.key === 'local_price_active').ok).toBe(false);
  });

  test('4 · SKU/SOI divergent → anomalie, jamais vert', async () => {
    unitResolver.resolveCanonicalUnitForProductSku.mockResolvedValue({ status: unitResolver.STATUS.AMBIGUOUS_UNIT });
    const report = await run(facts());
    const gate = gateOf(report, 'CATALOG_RELEASE_PROVED');
    expect(gate.status).toBe(GATE.ANOMALIE);
    expect(gate.anomalies[0]).toMatch(/SKU\/SOI divergent/);
    expect(report.stage).toBe(STAGE.ANOMALIE);
  });

  test('5 · API boutique indisponible → non prouvé', async () => {
    const down = await run(facts(), { fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    expect(gateOf(down, 'STOREFRONT_PROVED').status).toBe(GATE.NON_PROUVE);
    expect(down.stage).not.toBe(STAGE.PRET);
    const http500 = await run(facts(), { fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 503 }) });
    expect(gateOf(http500, 'STOREFRONT_PROVED').status).toBe(GATE.NON_PROUVE);
    const noUrl = await run(facts(), { storefrontBaseUrl: null });
    expect(gateOf(noUrl, 'STOREFRONT_PROVED').checks[0].key).toBe('storefront_url_unconfigured');
  });

  test('boutique 404 alors que le catalogue affirme la remise → anomalie', async () => {
    const report = await run(facts(), { fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 404 }) });
    expect(gateOf(report, 'STOREFRONT_PROVED').status).toBe(GATE.ANOMALIE);
  });

  test('base illisible → non prouvé (jamais une valeur par défaut verte)', async () => {
    const report = await projectUpstreamEvidence({ query: jest.fn().mockRejectedValue(Object.assign(new Error('down'), { code: 'ECONNRESET' })) },
      { productId: PID, marketCode: 'KM', fetchImpl: okFetch, storefrontBaseUrl: 'https://staging.example' });
    expect(report.gates.slice(0, 3).every((g) => g.status === GATE.NON_PROUVE)).toBe(true);
    expect(report.stage).not.toBe(STAGE.PRET);
  });

  test('aucun produit → NON DÉMARRÉ, aucune requête', async () => {
    const db = { query: jest.fn() };
    const report = await projectUpstreamEvidence(db, {});
    expect(report.stage).toBe(STAGE.NON_DEMARRE);
    expect(report.gates).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('projection strictement en lecture', async () => {
    const f = facts();
    const db = dbWith(f);
    await projectUpstreamEvidence(db, { productId: PID, marketCode: 'KM', fetchImpl: okFetch, storefrontBaseUrl: 'https://staging.example' });
    expect(db.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });
});

describe('étape du cockpit déduite des seules preuves automatiques', () => {
  const g = (...statuses) => statuses.map((status) => ({ status }));
  test('états', () => {
    expect(deriveReadiness({})).toBe(STAGE.NON_DEMARRE);
    expect(deriveReadiness({ productId: PID, gates: g('PROVED', 'NON_PROUVE', 'NON_PROUVE', 'NON_PROUVE') })).toBe(STAGE.EN_PREPARATION);
    expect(deriveReadiness({ productId: PID, gates: g('NON_PROUVE', 'PROVED', 'NON_PROUVE', 'NON_PROUVE') })).toBe(STAGE.PREUVE_MANQUANTE);
    expect(deriveReadiness({ productId: PID, gates: g('PROVED', 'ANOMALIE', 'NON_PROUVE', 'NON_PROUVE') })).toBe(STAGE.ANOMALIE);
    expect(deriveReadiness({ productId: PID, gates: g('PROVED', 'PROVED', 'PROVED', 'PROVED') })).toBe(STAGE.PRET);
    expect(deriveReadiness({ orderReference: 'K-GOLDEN-1', gates: [] })).toBe(STAGE.PREUVE_MANQUANTE);
  });
});

describe('CUSTOMER_ORDER_PROVED — commande → achat fournisseur exact (P0b)', () => {
  const REF = 'K-1042';
  const orderFacts = (over = {}) => facts({
    order: [{ id: 'o1', reference: REF, status: 'ordered', payment_status: 'paid' }],
    items: [{ order_item_id: 'oi1', quantity: 2, sku_id: 's1', product_id: PID, sku_product_id: PID, sku_unit_ref: 'U-1', sku_soi_unit_ref: 'U-1' }],
    lines: [{ order_item_id: 'oi1', product_sku_id: 's1', supplier_unit_ref: 'U-1', quantity: 2, purchase_order_id: 'po1', soi_unit_ref: 'U-1', po_status: 'confirmed' }],
    ...over,
  });
  const runOrder = (f) => run(f, { orderReference: REF });
  const orderGate = (r) => gateOf(r, 'CUSTOMER_ORDER_PROVED');

  test('filiation exacte → 5 portes prouvées, PRÊT POUR RECETTE, dossier avec empreinte', async () => {
    const report = await runOrder(orderFacts());
    expect(report.gates).toHaveLength(5);
    expect(orderGate(report).status).toBe(GATE.PROVED);
    expect(report.stage).toBe(STAGE.PRET);
    expect(report.dossier.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.dossier.provenance).toBe('ORDER_ORIGIN_NOT_PROVED');
    expect(report.dossier.complete).toBe(false);
    expect(report.dossier.incomplete_reasons.join(' ')).toContain('Origine du checkout non prouvée');
  });

  test('empreinte stable pour des faits identiques, différente si un fait change', async () => {
    const a = await runOrder(orderFacts());
    const b = await runOrder(orderFacts());
    const c = await runOrder(orderFacts({ lines: [] }));
    expect(a.dossier.sha256).toBe(b.dossier.sha256);
    expect(a.dossier.sha256).not.toBe(c.dossier.sha256);
  });

  test('commande synthétique golden-create → dossier jamais complet', async () => {
    const f = orderFacts({ order: [{ id: 'o1', reference: 'K-GOLDEN-X', status: 'ordered', payment_status: 'paid' }] });
    const report = await run(f, { orderReference: 'K-GOLDEN-X' });
    expect(report.dossier.provenance).toBe('SYNTHETIC_GOLDEN_CREATE');
    expect(report.dossier.complete).toBe(false);
  });

  test('substitution de SKU similaire → ANOMALIE', async () => {
    const report = await runOrder(orderFacts({ lines: [{ order_item_id: 'oi1', product_sku_id: 's-similar', supplier_unit_ref: 'U-1', quantity: 2, purchase_order_id: 'po1' }] }));
    expect(orderGate(report).status).toBe(GATE.ANOMALIE);
    expect(orderGate(report).anomalies).toContain('SKU_SUBSTITUTION:oi1');
    expect(report.stage).toBe(STAGE.ANOMALIE);
  });

  test('unité fournisseur ou SOI divergente → ANOMALIE', async () => {
    const unit = await runOrder(orderFacts({ lines: [{ order_item_id: 'oi1', product_sku_id: 's1', supplier_unit_ref: 'U-2', quantity: 2, purchase_order_id: 'po1' }] }));
    expect(orderGate(unit).anomalies).toContain('SUPPLIER_UNIT_MISMATCH:oi1');
    const soi = await runOrder(orderFacts({ lines: [{ order_item_id: 'oi1', product_sku_id: 's1', supplier_unit_ref: 'U-1', soi_unit_ref: 'U-9', quantity: 2, purchase_order_id: 'po1' }] }));
    expect(orderGate(soi).anomalies).toContain('SUPPLIER_UNIT_MISMATCH:oi1');
  });

  test('achat partiel, absent ou sans PO → NON_PROUVE ; sur-achat → ANOMALIE', async () => {
    const partial = await runOrder(orderFacts({ lines: [{ order_item_id: 'oi1', product_sku_id: 's1', supplier_unit_ref: 'U-1', quantity: 1, purchase_order_id: 'po1' }] }));
    expect(orderGate(partial).status).toBe(GATE.NON_PROUVE);
    expect(orderGate(partial).checks.find((c) => c.key === 'quantity_exactly_covered:oi1').ok).toBe(false);
    expect(orderGate(await runOrder(orderFacts({ lines: [] }))).status).toBe(GATE.NON_PROUVE);
    const noPo = await runOrder(orderFacts({ lines: [{ order_item_id: 'oi1', product_sku_id: 's1', supplier_unit_ref: 'U-1', quantity: 2, purchase_order_id: null }] }));
    expect(orderGate(noPo).checks.find((c) => c.key === 'purchase_attached_to_po:oi1').ok).toBe(false);
    const over = await runOrder(orderFacts({ lines: [{ order_item_id: 'oi1', product_sku_id: 's1', supplier_unit_ref: 'U-1', quantity: 3, purchase_order_id: 'po1' }] }));
    expect(orderGate(over).anomalies).toContain('PURCHASE_OVER_QUANTITY:oi1');
  });

  test('commande inconnue, sans ligne du produit, SKU d’un autre produit ou lecture en erreur → jamais vert', async () => {
    expect(orderGate(await runOrder(orderFacts({ order: [] }))).status).toBe(GATE.NON_PROUVE);
    expect(orderGate(await runOrder(orderFacts({ items: [] }))).status).toBe(GATE.NON_PROUVE);
    const foreign = await runOrder(orderFacts({ items: [{ order_item_id: 'oi1', quantity: 2, sku_id: 's1', product_id: PID, sku_product_id: 'autre', sku_unit_ref: 'U-1' }] }));
    expect(orderGate(foreign).status).toBe(GATE.NON_PROUVE);
    expect(orderGate(await runOrder(orderFacts({ linesError: true }))).status).toBe(GATE.NON_PROUVE);
    expect(orderGate(await runOrder(orderFacts({ items: [{ order_item_id: 'oi1', quantity: 2, sku_id: 's1', product_id: PID, sku_product_id: PID, sku_unit_ref: null }] }))).status).toBe(GATE.NON_PROUVE);
  });

  test('la 5e porte est exigée dès qu’une commande est fournie', () => {
    const g = (...statuses) => statuses.map((status) => ({ status }));
    expect(deriveReadiness({ productId: PID, orderReference: 'K-1', gates: g('PROVED', 'PROVED', 'PROVED', 'PROVED') })).not.toBe(STAGE.PRET);
    expect(deriveReadiness({ productId: PID, orderReference: 'K-1', gates: g('PROVED', 'PROVED', 'PROVED', 'PROVED', 'PROVED') })).toBe(STAGE.PRET);
  });

  test('sans référence de commande côté porte directe → NON_PROUVE (lecture seule)', async () => {
    const db = dbWith(orderFacts());
    const report = await projectUpstreamEvidence(db, { productId: PID, marketCode: 'KM', fetchImpl: okFetch, storefrontBaseUrl: 'https://staging.example', orderReference: REF });
    expect(db.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
    expect(report.gates[4].key).toBe('CUSTOMER_ORDER_PROVED');
  });
});
