'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief PR 5 — purchasing-engagement-service : validations, garde-fous et branches (db scriptée). Le comportement SQL réel est prouvé par tests/integration/purchase-lines-engagement-postgres.test.js.
 */

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
const mockOpenShortage = jest.fn().mockResolvedValue({});
jest.mock('../../services/supplier-shortage-service', () => ({ openSupplierShortage: (...a) => mockOpenShortage(...a) }));
jest.mock('../../services/hub-authorization-service', () => ({ assertCommitmentAuthorized: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/logger', () => {
  const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
  return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
const mockNotifyText = jest.fn();
jest.mock('../../services/notification-service', () => ({ notifyText: (...a) => mockNotifyText(...a) }));
const mockReadiness = jest.fn();
jest.mock('../../services/suppliers/canonical-unit-purchasing-gate', () => ({
  evaluateCanonicalProcurementReadiness: (...a) => mockReadiness(...a),
}));
const mockRegistry = {};
jest.mock('../../services/suppliers/execution-adapter-registry', () => ({ EXECUTION_ADAPTER_REGISTRY: mockRegistry }));
const mockVerify = jest.fn();
jest.mock('../../services/suppliers/purchase-order-confirmation-boundary', () => ({
  COMMITMENT_VERDICT: { COMMITTED: 'committed', REJECTED: 'rejected' },
  verifyProviderEvidenceForConfirmation: (...a) => mockVerify(...a),
}));
jest.mock('../../services/purchase-line-snapshot', () => ({
  loadExactSoldSku: jest.fn(),
  resolveExactSkuProcurementReadiness: jest.fn(),
  buildPurchaseTarget: jest.fn(),
  insertOpenPurchaseLine: jest.fn(),
  procurementHubLabel: jest.fn((hub) => (hub === 'DXB' ? 'Dubai' : hub)),
}));

const db = require('../../db');
const snapshot = require('../../services/purchase-line-snapshot');
const engagement = require('../../services/purchasing-engagement-service');

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const PO = uuid(1);
const L1 = uuid(11);
const L2 = uuid(12);

/** Client scripté : le premier gestionnaire dont le motif correspond répond ; sinon { rows: [] }. */
function scripted(handlers) {
  const calls = [];
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      for (const [pattern, reply] of handlers) {
        if (pattern.test(sql)) return typeof reply === 'function' ? reply(sql, params) : reply;
      }
      return { rows: [] };
    }),
  };
  db.getClient.mockResolvedValue(client);
  return { client, calls };
}

const poRow = (extra = {}) => ({ id: PO, order_id: null, status: 'draft', supplier_id: uuid(3), procurement_hub_ref: 'DXB', trigger_mode: 'auto', ...extra });
const submitLine = (extra = {}) => ({
  id: L1, product_sku_id: uuid(5), supplier_sku: 'SKU', supplier_unit_ref: 'U1',
  supplier_order_identity: { provider: 'noon', version: 1, payload: { a: 1 } },
  quantity: 2, supplier_unit_price: '10.0000', supplier_currency: 'USD', product_name: null, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockRegistry)) delete mockRegistry[key];
  db.query.mockResolvedValue({ rows: [] });
});
afterEach(() => { delete process.env.ADMIN_PHONE; });

describe('summarizeCommitmentByMarket', () => {
  const line = (market, code, qty, price, currency = 'USD', cancelled = false) => ({
    market_id: market, market_code: code, market_name: `M ${code}`, effective_quantity: qty,
    confirmed_unit_price: price, expected_unit_price: 7, supplier_currency: currency, cancelled,
  });

  it('agrège quantités, reliquats et montants par marché, ignore les lignes annulées, trie par code', () => {
    const out = engagement.summarizeCommitmentByMarket(
      [line('m2', 'KM', 3, 12.5), line('m2', 'KM', 1, null), line('m1', 'CG', 2, 5, 'EUR'), line('m3', 'CM', 9, 1, 'USD', true)],
      [{ market_id: 'm2', market_code: 'KM', market_name: 'M KM', quantity: 4 }, { market_id: 'm4', market_code: 'AA', market_name: 'M AA', quantity: 1 }]
    );
    expect(out.multi_market).toBe(true);
    expect(out.markets.map((m) => m.market_code)).toEqual(['AA', 'CG', 'KM']);
    expect(out.markets.find((m) => m.market_code === 'KM')).toMatchObject({
      lines: 2, confirmed_quantity: 4, remnant_quantity: 4, confirmed_amounts: [{ currency: 'USD', amount: 44.5 }],
    });
    expect(out.markets.find((m) => m.market_code === 'AA')).toMatchObject({ lines: 0, remnant_quantity: 1, confirmed_amounts: [] });
  });

  it('une ligne sans prix ni devise n\'ajoute aucun montant ; un seul marché → multi_market=false', () => {
    const out = engagement.summarizeCommitmentByMarket([
      { market_id: 'm', market_code: 'KM', market_name: 'x', effective_quantity: 2, confirmed_unit_price: null, expected_unit_price: null, supplier_currency: 'USD', cancelled: false },
      { market_id: 'm', market_code: 'KM', market_name: 'x', effective_quantity: 1, confirmed_unit_price: 3, expected_unit_price: null, supplier_currency: null, cancelled: false },
    ]);
    expect(out.markets[0].confirmed_amounts).toEqual([]);
    expect(out.multi_market).toBe(false);
    expect(engagement.summarizeCommitmentByMarket([]).markets).toEqual([]);
  });
});

describe('garde-fous communs', () => {
  it('identifiants invalides → 400, sans ouvrir de transaction', async () => {
    await expect(engagement.submitPurchaseOrder('x')).rejects.toMatchObject({ status: 400 });
    await expect(engagement.confirmGroupedPurchaseOrder('x', { lines: [] })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.settleLine('x', {})).rejects.toMatchObject({ status: 400 });
    expect(db.getClient).not.toHaveBeenCalled();
  });
});

describe('submitPurchaseOrder', () => {
  it('PO simulée : ni notification admin, ni URL WhatsApp fournisseur', async () => {
    process.env.ADMIN_PHONE = '+225111111111';
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ trigger_mode: 'whatsapp' })] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({ simulation_scope: 'E2E-HUB-V1', supplier_order_identity: { provider: 'whatsapp', version: 1, payload: { supplier_sku: 'FAKE-1' } } })] }],
      [/FROM suppliers/, { rows: [{ name: 'Fictif', platform: 'whatsapp', contact_phone: '+971500000000' }] }],
      [/SELECT trigger_mode/, { rows: [{ trigger_mode: 'whatsapp' }] }],
    ]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'notified' }] } : { rows: [] }));
    const out = await engagement.submitPurchaseOrder(PO);
    expect(out.notification).toMatchObject({ channel: 'simulation_no_notification', wa_url: null });
    expect(mockNotifyText).not.toHaveBeenCalled();
    expect(mockReadiness).not.toHaveBeenCalled();
  });

  it('PO manuelle Hub : la référence vendeur reste à renseigner dans le flux standard', async () => {
    process.env.ADMIN_PHONE = '+225111111111';
    mockNotifyText.mockResolvedValue(undefined);
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ supplier_id: 'hub-id', trigger_mode: 'manual' })] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({
        product_name: 'Sac manuel', product_sku_id: 'komerce-sku', supplier_sku: null,
        supplier_unit_ref: null, supplier_order_identity: null,
        supplier_unit_price: null, supplier_currency: null,
      })] }],
      [/FROM suppliers/, { rows: [{ name: 'Fournisseur central Hub', platform: 'local', contact_phone: null }] }],
      [/SELECT trigger_mode/, { rows: [{ trigger_mode: 'manual' }] }],
    ]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'notified' }] } : { rows: [] }));

    const out = await engagement.submitPurchaseOrder(PO);

    expect(out.notification.channel).toBe('admin_manual');
    expect(mockNotifyText.mock.calls[0][1]).toContain('Référence Komerce ; référence fournisseur à renseigner par le Hub');
    expect(mockNotifyText.mock.calls[0][1]).not.toContain('Ref : null');
  });

  it('une PO mélangeant simulation et réel est refusée avant tout envoi', async () => {
    const { calls } = scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ trigger_mode: 'manual' })] }],
      [/FROM purchase_lines pl/, { rows: [
        submitLine({ id: L1, simulation_scope: 'E2E-HUB-V1' }),
        submitLine({ id: L2, simulation_scope: null }),
      ] }],
    ]);
    await expect(engagement.submitPurchaseOrder(PO)).rejects.toMatchObject({
      status: 409, code: 'PURCHASE_ORDER_SIMULATION_SCOPE_MIXED',
    });
    expect(calls.some(c => /UPDATE purchase_orders SET status/.test(c.sql))).toBe(false);
    expect(mockNotifyText).not.toHaveBeenCalled();
  });

  it('aucun provider auto sur une PO simulée, même si readiness paraît positive', async () => {
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ trigger_mode: 'auto' })] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({ simulation_scope: 'RCT1' })] }],
    ]);
    await expect(engagement.submitPurchaseOrder(PO)).rejects.toMatchObject({
      status: 409, code: 'SIMULATED_PO_AUTO_ORDER_FORBIDDEN',
    });
    expect(mockReadiness).not.toHaveBeenCalled();
    expect(mockNotifyText).not.toHaveBeenCalled();
  });

  it('readiness absente → verdict UNKNOWN refusé ; provider sans buildOrderPayload ignoré ; ROLLBACK, jamais de notification', async () => {
    mockReadiness.mockResolvedValue(null);
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow()] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({ supplier_order_identity: { provider: 'unknown_provider', version: 1, payload: { a: 1 } } })] }],
    ]);
    await expect(engagement.submitPurchaseOrder(PO)).rejects.toMatchObject({
      status: 409, code: 'PURCHASE_ORDER_SUBMIT_REFUSED', verdicts: [expect.objectContaining({ ready: false, status: 'UNKNOWN' })],
    });
    expect(mockNotifyText).not.toHaveBeenCalled();
  });

  it('provider à préparation distante prêt mais sans buildOrderPayload : la soumission passe', async () => {
    mockRegistry.allegro = { provider: 'allegro', evaluate: jest.fn() };
    mockReadiness.mockResolvedValue({ ready: true, status: 'FULFILLMENT_READY' });
    const now = { status: 'notified' };
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow()] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({ supplier_order_identity: { provider: 'allegro', version: 1, payload: { a: 1 } }, product_name: 'Produit' })] }],
      [/FROM suppliers/, { rows: [{ name: 'F', platform: null, contact_phone: null }] }],
      [/SELECT trigger_mode/, { rows: [{ trigger_mode: 'manual' }] }],
    ]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, ...now }] } : { rows: [] }));
    const out = await engagement.submitPurchaseOrder(PO);
    expect(out.preflights[0]).toMatchObject({ ready: true, status: 'FULFILLMENT_READY' });
    expect(out.purchase_order.status).toBe('notified');
  });

  it('décision 4 : une PO automatique soumise pose la preuve d\'envoi (canal api) ; une PO manuelle non', async () => {
    mockRegistry.allegro = { provider: 'allegro', evaluate: jest.fn() };
    mockReadiness.mockResolvedValue({ ready: true, status: 'FULFILLMENT_READY' });
    const run = async (mode) => {
      const { calls } = scripted([
        [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ trigger_mode: mode })] }],
        [/FROM purchase_lines pl/, { rows: [submitLine({ supplier_order_identity: { provider: 'allegro', version: 1, payload: { a: 1 } }, product_name: 'Produit' })] }],
        [/FROM suppliers/, { rows: [{ name: 'F', platform: null, contact_phone: null }] }],
        [/SELECT trigger_mode/, { rows: [{ trigger_mode: mode }] }],
      ]);
      db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'notified' }] } : { rows: [] }));
      await engagement.submitPurchaseOrder(PO, { actor: { id: uuid(42) } });
      return calls.find((c) => /UPDATE purchase_orders SET status = 'notified'/.test(c.sql));
    };
    const auto = await run('auto');
    expect(auto.sql).toMatch(/sent_at = NOW\(\), sent_channel = 'api'/);
    expect(auto.params).toEqual([PO, uuid(42)]);
    const manual = await run('manual');
    expect(manual.sql).not.toMatch(/sent_at/);
  });

  it('buildOrderPayload appelé avec items[] et preflights[] ; une exception non-Error est rendue en texte', async () => {
    const buildOrderPayload = jest.fn().mockRejectedValue('refus brut');
    mockRegistry.allegro = { provider: 'allegro', evaluate: jest.fn(), buildOrderPayload };
    mockReadiness.mockResolvedValue({ ready: true, status: 'FULFILLMENT_READY', preflight: { ready: true } });
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow()] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({ supplier_order_identity: { provider: 'allegro', version: 1, payload: { a: 1 } } })] }],
    ]);
    await expect(engagement.submitPurchaseOrder(PO, { context: { k: 1 } })).rejects.toMatchObject({
      verdicts: [expect.objectContaining({ status: 'BUILD_ORDER_PAYLOAD_REFUSED', reason: 'refus brut' })],
    });
    expect(buildOrderPayload).toHaveBeenCalledWith({
      items: [{ identity: expect.objectContaining({ provider: 'allegro' }), supplier_unit_ref: 'U1', supplier_sku: 'SKU', quantity: 2 }],
      preflights: [{ ready: true }],
      context: { k: 1 },
    });
  });

  it('message admin : fournisseur WhatsApp sans téléphone retombe sur le canal admin ; échec de notification journalisé', async () => {
    process.env.ADMIN_PHONE = '+225';
    mockNotifyText.mockRejectedValue(new Error('down'));
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow()] }],
      [/FROM purchase_lines pl/, { rows: [submitLine({ supplier_unit_price: null, supplier_currency: null, product_name: null })] }],
      [/FROM suppliers/, { rows: [{ name: 'F', platform: 'whatsapp', contact_phone: null }] }],
      [/SELECT trigger_mode/, { rows: [{ trigger_mode: 'whatsapp' }] }],
    ]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'notified' }] } : { rows: [] }));
    const out = await engagement.submitPurchaseOrder(PO);
    expect(out.notification.channel).toBe('admin_manual');
    expect(mockNotifyText.mock.calls[0][1]).toContain('SKU');
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('confirmGroupedPurchaseOrder — garde-fous', () => {
  const okLines = [{ purchase_line_id: L1, confirmed_quantity: 1 }];

  it('corps invalide : entrée non objet, id invalide, quantité invalide → 400', async () => {
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: [null] })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: [{ purchase_line_id: 'x', confirmed_quantity: 1 }] })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: [{ purchase_line_id: L1, confirmed_quantity: 'a' }] })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: [{ purchase_line_id: L1, confirmed_quantity: 1, confirmed_unit_price: 'abc' }] })).rejects.toMatchObject({ status: 400 });
  });

  it('PO introuvable → 404 ; PO historique → 409 PURCHASE_ORDER_NOT_GROUPED', async () => {
    scripted([[/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [] }]]);
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: okLines })).rejects.toMatchObject({ status: 404 });
    scripted([[/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ order_id: uuid(9) })] }]]);
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: okLines })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_GROUPED' });
  });

  it('achat manuel : une quantité positive exige une preuve, sans affecter le mode API', async () => {
    scripted([[/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status: 'notified', trigger_mode: 'manual' })] }]]);
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: okLines }))
      .rejects.toMatchObject({ status: 400, code: 'MANUAL_PURCHASE_PROOF_REQUIRED' });
  });

  it('HB-05 : confirmation inférieure à la quantité déjà reçue → 409 CONFIRMED_QUANTITY_BELOW_RECEIVED, sans écriture', async () => {
    const { calls } = scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status: 'notified' })] }],
      [/FROM purchase_lines\s+WHERE purchase_order_id/, { rows: [{ id: L1, quantity: 5, supplier_order_identity: null }] }],
      [/purchase_line_received_quantity/, { rows: [{ received: 3 }] }],
    ]);
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: [{ purchase_line_id: L1, confirmed_quantity: 2 }] }))
      .rejects.toMatchObject({ status: 409, code: 'CONFIRMED_QUANTITY_BELOW_RECEIVED', received_quantity: 3 });
    expect(calls.some((c) => /UPDATE purchase_lines/.test(c.sql))).toBe(false);
  });

  it('tout à zéro : aucune vérification de preuve fournisseur ; texte libre (notes, suivi) sans valeur → null', async () => {
    const { calls } = scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status: 'notified' })] }],
      [/FROM purchase_lines\s+WHERE purchase_order_id/, { rows: [{ id: L1, quantity: 2, supplier_order_identity: null }] }],
      [/INSERT INTO purchase_lines/, { rows: [{ id: uuid(99) }] }],
    ]);
    db.query.mockResolvedValue({ rows: [{ id: PO, status: 'cancelled' }] });
    const out = await engagement.confirmGroupedPurchaseOrder(
      PO, { lines: [{ purchase_line_id: L1, confirmed_quantity: 0 }], notes: '  ', tracking_url: undefined }, { actor: { id: 'pas-un-uuid' } }
    );
    expect(out.purchase_order.status).toBe('cancelled');
    expect(mockVerify).not.toHaveBeenCalled();
    const insert = calls.find((c) => /INSERT INTO purchase_lines/.test(c.sql));
    expect(insert.params[11]).toBe(L1);
    expect(insert.params[12]).toBeNull(); // acteur non-uuid : created_by ignoré
  });

  it('preuve fournisseur : lignes sans identité ignorées, quantités sommées par supplier_unit_ref, référence vérifiée snapshotée', async () => {
    const identity = { provider: 'allegro', version: 1, payload: { offer_id: '1' } };
    mockVerify.mockResolvedValue({ required: true, commitment_verdict: 'committed', external_ref: 'VERIFIED' });
    const { calls } = scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status: 'notified' })] }],
      [/FROM purchase_lines\s+WHERE purchase_order_id/, { rows: [
        { id: L1, quantity: 2, supplier_unit_ref: 'U1', supplier_sku: 'S', supplier_unit_price: 10, supplier_order_identity: identity },
        { id: L2, quantity: 3, supplier_unit_ref: 'U1', supplier_sku: 'S', supplier_unit_price: 10, supplier_order_identity: identity },
        { id: uuid(13), quantity: 1, supplier_unit_ref: 'U9', supplier_sku: 'S', supplier_unit_price: 10, supplier_order_identity: null },
        { id: uuid(14), quantity: 1, supplier_unit_ref: 'U8', supplier_sku: 'S', supplier_unit_price: 10, supplier_order_identity: identity },
      ] }],
      [/INSERT INTO purchase_lines/, { rows: [{ id: uuid(97) }] }],
    ]);
    db.query.mockResolvedValue({ rows: [{ id: PO, status: 'confirmed' }] });
    await engagement.confirmGroupedPurchaseOrder(PO, {
      supplier_order_id: 'RAW',
      lines: [
        { purchase_line_id: L1, confirmed_quantity: 2 }, { purchase_line_id: L2, confirmed_quantity: 3 },
        { purchase_line_id: uuid(13), confirmed_quantity: 1 }, { purchase_line_id: uuid(14), confirmed_quantity: 0 },
      ],
    }, { context: { c: 1 } });
    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
      externalRef: 'RAW', context: { c: 1 },
      items: [expect.objectContaining({ supplier_unit_ref: 'U1', quantity: 5 })],
    }));
    const update = calls.find((c) => /SET status = 'confirmed'/.test(c.sql));
    expect(update.params[1]).toBe('VERIFIED');
  });

  it('preuve non requise → la référence de l\'opérateur est conservée', async () => {
    mockVerify.mockResolvedValue({ required: false, provider: 'noon' });
    const { calls } = scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status: 'notified' })] }],
      [/FROM purchase_lines\s+WHERE purchase_order_id/, { rows: [{ id: L1, quantity: 1, supplier_unit_ref: 'U1', supplier_sku: 'S', supplier_unit_price: 10, supplier_order_identity: { provider: 'noon' } }] }],
    ]);
    db.query.mockResolvedValue({ rows: [{ id: PO, status: 'confirmed' }] });
    await engagement.confirmGroupedPurchaseOrder(PO, { supplier_order_id: 'RAW', notes: 'ok', lines: okLines });
    expect(calls.find((c) => /SET status = 'confirmed'/.test(c.sql)).params[1]).toBe('RAW');
  });

  it('preuve rejetée sans raison → message générique', async () => {
    mockVerify.mockResolvedValue({ required: true, provider: 'allegro', commitment_verdict: 'rejected' });
    scripted([
      [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status: 'notified' })] }],
      [/FROM purchase_lines\s+WHERE purchase_order_id/, { rows: [{ id: L1, quantity: 1, supplier_unit_ref: 'U1', supplier_sku: 'S', supplier_unit_price: 10, supplier_order_identity: { provider: 'allegro' } }] }],
    ]);
    await expect(engagement.confirmGroupedPurchaseOrder(PO, { lines: okLines })).rejects.toThrow(/raison inconnue/);
  });
});

describe('settleLine — garde-fous', () => {
  const peek = (po = PO) => [/SELECT id, purchase_order_id FROM purchase_lines WHERE id/, { rows: [{ id: L1, purchase_order_id: po }] }];
  const poLock = (status = 'confirmed') => [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [poRow({ status })] }];
  const lineRow = (extra = {}) => ({
    id: L1, purchase_order_id: PO, order_item_id: uuid(7), supplier_id: uuid(3), product_supplier_id: null, product_sku_id: null,
    supplier_sku: 'S', supplier_unit_ref: 'U1', supplier_order_identity: null, quantity: 6, supplier_unit_price: 10,
    supplier_currency: 'USD', procurement_hub_ref: 'DXB', confirmed_quantity: 6, settled_at: null, cancelled_at: null, ...extra,
  });
  const lineLock = (extra) => [/FROM purchase_lines WHERE id = \$1 FOR UPDATE/, { rows: [lineRow(extra)] }];
  const shaped = { rows: [{ line_id: L1, market_id: 'm', market_code: 'KM', effective_quantity: 4, cancelled: false }] };

  it('refuse au-delà de ce que le Hub a reçu, et à effectif ou plus', async () => {
    scripted([peek(), poLock(), lineLock(), [/v_purchase_line_progress/, { rows: [{ received_quantity: '3' }] }]]);
    await expect(engagement.settleLine(L1, { settled_quantity: 4, reason: 'x' })).rejects.toMatchObject({
      status: 409, code: 'PURCHASE_LINE_SETTLE_ABOVE_RECEIVED', received_quantity: 3,
    });
    scripted([peek(), poLock(), lineLock()]);
    await expect(engagement.settleLine(L1, { settled_quantity: 6, reason: 'x' })).rejects.toMatchObject({ status: 400, confirmed_quantity: 6 });
  });

  it('sans ligne de progression, le reçu vaut 0 : seule une clôture à 0 passe ; reliquat et acteur uuid transmis', async () => {
    const { calls } = scripted([
      peek(), poLock(), lineLock(),
      [/v_purchase_line_progress\s+WHERE line_id/, { rows: [] }],
      [/INSERT INTO purchase_lines/, { rows: [{ id: uuid(98) }] }],
      [/FROM v_purchase_line_progress\s+WHERE purchase_order_id/, { rows: [{ effective_quantity: 0, received_quantity: 0 }, { effective_quantity: 2, received_quantity: 1 }] }],
    ]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'confirmed' }] } : shaped));
    const out = await engagement.settleLine(L1, { settled_quantity: 0, reason: 'x', reopen_remainder: true }, { actor: { id: uuid(50) } });
    expect(out.unsettled_quantity).toBe(6);
    expect(calls.find((c) => /INSERT INTO purchase_lines/.test(c.sql)).params[12]).toBe(uuid(50));
    expect(calls.some((c) => /SET status = 'hub_received'/.test(c.sql))).toBe(false);
  });

  it('H1 : clôture SANS reliquat → incident de rupture fournisseur (acteur + ligne en preuve) ; avec reliquat → aucun', async () => {
    mockOpenShortage.mockClear();
    scripted([peek(), poLock(), lineLock(), [/v_purchase_line_progress\s+WHERE line_id/, { rows: [{ received_quantity: 2 }] }], [/FROM v_purchase_line_progress\s+WHERE purchase_order_id/, { rows: [] }]]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'confirmed' }] } : shaped));
    await engagement.settleLine(L1, { settled_quantity: 2, reason: 'rupture', reopen_remainder: false }, { actor: { id: uuid(50) } });
    expect(mockOpenShortage).toHaveBeenCalledWith(expect.anything(), {
      purchaseLineId: L1, orderItemId: uuid(7), missingQuantity: 4, receivedQuantity: 2, reason: 'rupture', actorId: uuid(50),
    });

    mockOpenShortage.mockClear();
    scripted([peek(), poLock(), lineLock(), [/v_purchase_line_progress\s+WHERE line_id/, { rows: [{ received_quantity: 2 }] }], [/INSERT INTO purchase_lines/, { rows: [{ id: uuid(98) }] }], [/FROM v_purchase_line_progress\s+WHERE purchase_order_id/, { rows: [] }]]);
    await engagement.settleLine(L1, { settled_quantity: 2, reason: 'x', reopen_remainder: true });
    expect(mockOpenShortage).not.toHaveBeenCalled();
  });

  it('PO sans autre ligne active → pas de clôture ; toutes soldées → hub_received', async () => {
    const none = scripted([peek(), poLock(), lineLock(), [/v_purchase_line_progress\s+WHERE line_id/, { rows: [{ received_quantity: 2 }] }], [/FROM v_purchase_line_progress\s+WHERE purchase_order_id/, { rows: [] }]]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'confirmed' }] } : shaped));
    await engagement.settleLine(L1, { settled_quantity: 2, reason: 'x' });
    expect(none.calls.some((c) => /SET status = 'hub_received'/.test(c.sql))).toBe(false);

    const all = scripted([peek(), poLock(), lineLock(), [/v_purchase_line_progress\s+WHERE line_id/, { rows: [{ received_quantity: 2 }] }], [/FROM v_purchase_line_progress\s+WHERE purchase_order_id/, { rows: [{ effective_quantity: 2, received_quantity: 2 }] }]]);
    db.query.mockImplementation(async (sql) => (/FROM purchase_orders WHERE id/.test(sql) ? { rows: [{ id: PO, status: 'hub_received' }] } : shaped));
    const out = await engagement.settleLine(L1, { settled_quantity: 2, reason: 'x' });
    expect(all.calls.some((c) => /SET status = 'hub_received'/.test(c.sql))).toBe(true);
    expect(out.purchase_order.status).toBe('hub_received');
    expect(out.remnant).toBeNull();
  });

  it('ligne annulée, soldée, non confirmée, qui change de PO, ouverte ; PO non confirmée ; ligne introuvable → 409/404', async () => {
    scripted([peek(), poLock(), lineLock({ cancelled_at: new Date() })]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_ALREADY_CANCELLED' });
    scripted([peek(), poLock(), lineLock({ settled_at: new Date() })]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_ALREADY_SETTLED' });
    scripted([peek(), poLock(), lineLock({ purchase_order_id: uuid(77) })]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_CONCURRENT_CHANGE' });
    scripted([peek(), poLock(), lineLock({ confirmed_quantity: null })]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_NOT_CONFIRMED' });
    scripted([peek(), poLock('cancelled')]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_NOT_SETTLEABLE', current_status: 'cancelled' });
    scripted([peek(null)]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_NOT_SETTLEABLE' });
    scripted([]);
    await expect(engagement.settleLine(L1, { settled_quantity: 1, reason: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(engagement.settleLine(L1, { settled_quantity: 1 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('createManualLine', () => {
  const body = { order_item_id: uuid(20), product_supplier_id: uuid(21), quantity: 2, execution_mode: 'api' };
  const item = { id: uuid(20), product_id: uuid(22), sku_id: uuid(23), fulfillment_source: 'IMPORT', order_status: 'confirmed' };
  const ps = { id: uuid(21), supplier_id: uuid(3), platform: 'Noon' };
  const handlers = (over = {}) => [
    [/FROM order_items oi/, { rows: [over.item === undefined ? item : over.item] }],
    [/FROM product_suppliers ps/, { rows: [over.ps === undefined ? ps : over.ps] }],
  ];

  beforeEach(() => {
    snapshot.loadExactSoldSku.mockResolvedValue({ id: uuid(23), supplier_order_identity: { provider: 'noon' } });
    snapshot.resolveExactSkuProcurementReadiness.mockResolvedValue({ unit_price: 10 });
    snapshot.buildPurchaseTarget.mockReturnValue({ purchaseTarget: {}, money: { amount: 10, currency: 'USD' } });
    snapshot.insertOpenPurchaseLine.mockResolvedValue({ id: uuid(60) });
    db.query.mockResolvedValue({ rows: [] });
  });

  it('validation des entrées → 400', async () => {
    await expect(engagement.createManualLine({ ...body, order_item_id: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.createManualLine({ ...body, product_supplier_id: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.createManualLine({ ...body, quantity: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(engagement.createManualLine({ ...body, quantity: 1.5 })).rejects.toMatchObject({ status: 400 });
  });

  it('article introuvable, stock local, commande annulée, mapping introuvable → 404/409', async () => {
    scripted(handlers({ item: undefined }).map(([p]) => [p, { rows: [] }]));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 404, code: 'ORDER_ITEM_NOT_FOUND' });
    scripted(handlers({ item: { ...item, fulfillment_source: 'LOCAL_STOCK' } }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 409, code: 'ORDER_ITEM_LOCAL_STOCK' });
    scripted(handlers({ item: { ...item, order_status: 'cancelled' } }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 409, code: 'ORDER_CANCELLED' });
    scripted([[/FROM order_items oi/, { rows: [item] }], [/FROM product_suppliers ps/, { rows: [] }]]);
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 404, code: 'PRODUCT_SUPPLIER_NOT_FOUND' });
  });

  it('SKU non exact → 409 EXACT_IDENTITY_REQUIRED ; provider différent → 409 SUPPLIER_PROVIDER_MISMATCH', async () => {
    scripted(handlers());
    snapshot.loadExactSoldSku.mockResolvedValueOnce(null);
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 409, code: 'EXACT_IDENTITY_REQUIRED' });
    scripted(handlers({ ps: { ...ps, platform: 'allegro' } }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 409, code: 'SUPPLIER_PROVIDER_MISMATCH' });
    scripted(handlers({ ps: { ...ps, platform: null } }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ code: 'SUPPLIER_PROVIDER_MISMATCH' });
  });

  it('identité bloquée → 409 BLOCKED_SUPPLIER_IDENTITY avec détails ; autre erreur relancée telle quelle', async () => {
    scripted(handlers());
    snapshot.resolveExactSkuProcurementReadiness.mockRejectedValueOnce(Object.assign(new Error('BLOCKED_SUPPLIER_IDENTITY: stock'), { code: 'BLOCKED_SUPPLIER_IDENTITY', details: { x: 1 } }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 409, code: 'BLOCKED_SUPPLIER_IDENTITY', details: { x: 1 } });
    snapshot.resolveExactSkuProcurementReadiness.mockRejectedValueOnce(Object.assign(new Error('BLOCKED_SUPPLIER_IDENTITY: nu'), { code: 'BLOCKED_SUPPLIER_IDENTITY' }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ details: {} });
    snapshot.resolveExactSkuProcurementReadiness.mockRejectedValueOnce(new Error('boom'));
    await expect(engagement.createManualLine(body)).rejects.toThrow('boom');
  });

  it('sur-engagement refusé par I1 (base) → 409 PURCHASE_LINE_OVERCOMMITTED', async () => {
    scripted(handlers());
    snapshot.insertOpenPurchaseLine.mockRejectedValueOnce(Object.assign(new Error('purchase_line_overcommitted: besoin 2'), { code: '23514' }));
    await expect(engagement.createManualLine(body)).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_OVERCOMMITTED' });
  });

  it('succès : ligne ouverte créée, created_by renseigné seulement pour un acteur uuid', async () => {
    const { calls } = scripted(handlers());
    db.query.mockResolvedValue({ rows: [{ line_id: uuid(60), market_id: 'm', market_code: 'KM', effective_quantity: 2, cancelled: false }] });
    const out = await engagement.createManualLine(body, { actor: { id: uuid(50) }, context: { c: 1 } });
    expect(out.line.line_id).toBe(uuid(60));
    expect(out.multi_market).toBe(false);
    expect(calls.some((c) => /SET created_by/.test(c.sql))).toBe(true);
    expect(snapshot.resolveExactSkuProcurementReadiness).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2, { c: 1 });

    const second = scripted(handlers());
    await engagement.createManualLine(body, { actor: { id: 'pas-un-uuid' } });
    await engagement.createManualLine(body);
    expect(second.calls.some((c) => /SET created_by/.test(c.sql))).toBe(false);
  });
});
