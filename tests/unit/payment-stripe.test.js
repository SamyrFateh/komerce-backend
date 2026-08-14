/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : payment-stripe (R5)
 *
 * Couvre createStripeIntent et handleStripePaymentFailed.
 * Les chemins de handleStripeSucceeded sont déjà couverts par
 * tests/unit/payments-webhook.test.js.
 *
 * Run : npx jest tests/unit/payment-stripe.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
  cacheCodeForReveal: jest.fn().mockResolvedValue(undefined),
}));

const mockConfirmPaymentCycle = jest.fn();
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: (...args) => mockConfirmPaymentCycle(...args),
}));

const mockHandleOrderConfirmed = jest.fn().mockResolvedValue({ skipped: true });
jest.mock('../../services/loyalty-service', () => ({
  handleOrderConfirmed: (...args) => mockHandleOrderConfirmed(...args),
}));

const mockNotifyPaymentConfirmed = jest.fn().mockResolvedValue({ invoice: null });
jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: (...args) => mockNotifyPaymentConfirmed(...args),
}));

// O7.2 (Cycle A) : voir docs/O7_2_CYCLE_ANALYSIS.md.
const mockIssueInvoice = jest.fn().mockResolvedValue({ pdf_content: Buffer.from('%PDF') });
jest.mock('../../services/invoice-service', () => ({
  issueInvoice: (...args) => mockIssueInvoice(...args),
}));

const { makeClient } = require('../integration/test-harness/mock-db');

const {
  createStripeIntent,
  handleStripeSucceeded,
  handleStripePaymentFailed,
  markStripeEventProcessed,
} = require('../../services/payment-stripe');

describe('createStripeIntent', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  test('réutilise un PaymentIntent existant si statut réutilisable', async () => {
    const order = {
      id: 'order-1',
      reference: 'KMC-001',
      total_eur: '49.90',
      stripe_payment_id: 'pi_existing',
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_existing',
          status: 'requires_payment_method',
          client_secret: 'secret_existing',
          amount: 4990,
        }),
        create: jest.fn(),
      },
    };

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(result.reused).toBe(true);
    expect(result.client_secret).toBe('secret_existing');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('crée un nouvel intent si aucun stripe_payment_id existant', async () => {
    const order = {
      id: 'order-2',
      reference: 'KMC-002',
      total_eur: '10.00',
      stripe_payment_id: null,
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'pi_new',
          client_secret: 'secret_new',
        }),
      },
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, currency: 'eur' }),
      expect.objectContaining({ idempotencyKey: 'order_pi_order-2' })
    );
    expect(mockDbQuery).toHaveBeenCalledWith(
      'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
      ['pi_new', 'order-2']
    );
    expect(result.client_secret).toBe('secret_new');
    expect(result.reused).toBeUndefined();
  });

  test('crée un nouvel intent si retrieve échoue', async () => {
    const order = {
      id: 'order-3',
      reference: 'KMC-003',
      total_eur: '20.00',
      stripe_payment_id: 'pi_broken',
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockRejectedValue(new Error('not found')),
        create: jest.fn().mockResolvedValue({
          id: 'pi_new2',
          client_secret: 'secret_new2',
        }),
      },
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(stripe.paymentIntents.create).toHaveBeenCalled();
    expect(result.client_secret).toBe('secret_new2');
  });

  test('crée un nouvel intent si le PaymentIntent existant n\'est plus réutilisable (statut non éligible)', async () => {
    const order = {
      id: 'order-4',
      reference: 'KMC-004',
      total_eur: '30.00',
      stripe_payment_id: 'pi_stale',
    };

    const stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_stale',
          status: 'succeeded', // pas dans REUSABLE → log.warn ligne 73, fallthrough
          client_secret: 'secret_stale',
          amount: 3000,
        }),
        create: jest.fn().mockResolvedValue({
          id: 'pi_new4',
          client_secret: 'secret_new4',
        }),
      },
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await createStripeIntent(order, stripe, { query: mockDbQuery });

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_stale');
    expect(stripe.paymentIntents.create).toHaveBeenCalled();
    expect(result.client_secret).toBe('secret_new4');
    expect(result.reused).toBeUndefined();
  });
});

describe('handleStripePaymentFailed — guard ne pas dégrader paid → failed', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  test('UPDATE conditionnel appliqué si payment_status = pending', async () => {
    const event = { id: 'evt_1', type: 'payment_intent.payment_failed' };
    const intent = { id: 'pi_1', metadata: { order_id: 'order-1', order_reference: 'KMC-001' } };

    mockDbQuery
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE orders
      .mockResolvedValueOnce({ rows: [] });   // markStripeEventProcessed insert

    await handleStripePaymentFailed(event, intent, { query: mockDbQuery });

    expect(mockDbQuery).toHaveBeenNthCalledWith(1,
      `UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1 AND payment_status = 'pending'`,
      ['order-1']
    );
  });

  test('ignoré si order_id absent des métadonnées', async () => {
    const event = { id: 'evt_2', type: 'payment_intent.payment_failed' };
    const intent = { id: 'pi_2', metadata: {} };

    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // markStripeEventProcessed insert

    await handleStripePaymentFailed(event, intent, { query: mockDbQuery });

    // Une seule query : markStripeEventProcessed (pas d'UPDATE orders)
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  test('rowCount=0 si déjà paid : pas de dégradation', async () => {
    const event = { id: 'evt_3', type: 'payment_intent.payment_failed' };
    const intent = { id: 'pi_3', metadata: { order_id: 'order-9', order_reference: 'KMC-009' } };

    mockDbQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE orders — aucune ligne (déjà paid)
      .mockResolvedValueOnce({ rows: [] });   // markStripeEventProcessed

    await handleStripePaymentFailed(event, intent, { query: mockDbQuery });

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// handleStripeSucceeded — chemins non couverts par tests/unit/payments-webhook
// (celui-ci teste la route ; ici on teste le service directement avec un
// vrai client transactionnel scripté, pour couvrir : stockBlocked (chemin 6),
// génération du code de retrait (succès/échec), extraction des infos de
// charge Stripe, hook fidélité, notifications post-commit, et
// triggerPurchasing (succès/échec + insertion d'alerte).
// ══════════════════════════════════════════════════════════════════════════
describe('handleStripeSucceeded — chemins 1-4 : guards précoces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('chemin 1 : PI sans order_id metadata → ignored, markStripeEventProcessed appelé', async () => {
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // markStripeEventProcessed insert

    const event  = { id: 'evt_no_meta', type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_no_meta', metadata: {} };

    const result = await handleStripeSucceeded(event, intent, db);

    expect(result).toEqual({ received: true, ignored: true });
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stripe_events_processed'),
      expect.arrayContaining(['evt_no_meta'])
    );
  });

  test('chemin 2 : order_id introuvable en DB → ignored', async () => {
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query
      .mockResolvedValueOnce({ rows: [] })            // SELECT payment_status → aucune ligne
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // markStripeEventProcessed

    const event  = { id: 'evt_missing_order', type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_missing_order', metadata: { order_id: 'order-ghost' } };

    const result = await handleStripeSucceeded(event, intent, db);

    expect(result).toEqual({ received: true, ignored: true });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('chemin 3 : commande déjà payée → idempotent', async () => {
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query
      .mockResolvedValueOnce({ rows: [{ payment_status: 'paid' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // markStripeEventProcessed

    const event  = { id: 'evt_already_paid', type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_already_paid', metadata: { order_id: 'order-paid' } };

    const result = await handleStripeSucceeded(event, intent, db);

    expect(result).toEqual({ received: true, idempotent: true });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('chemin 4 : confirmPaymentCycle noop → commit + idempotent', async () => {
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // markStripeEventProcessed (après commit)

    const client = makeClient([
      { rows: [], rowCount: 1 }, // BEGIN
      { rows: [], rowCount: 1 }, // COMMIT
    ]);
    db.pool.connect.mockResolvedValue(client);
    mockConfirmPaymentCycle.mockResolvedValueOnce({ noop: true });

    const event  = { id: 'evt_noop', type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_noop', metadata: { order_id: 'order-noop' } };

    const result = await handleStripeSucceeded(event, intent, db);

    expect(result).toEqual({ received: true, idempotent: true });
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });
});

describe('handleStripeSucceeded — chemin 6 : stockBlocked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function baseEventIntent(overrides = {}) {
    return {
      event: { id: 'evt_sb_1', type: 'payment_intent.succeeded', ...overrides.event },
      intent: {
        id: 'pi_sb_1',
        receipt_email: null,
        metadata: { order_id: 'order-sb-1', order_reference: 'KOM-SB-1' },
        ...overrides.intent,
      },
    };
  }

  test('notes ajoutées, alerte critique insérée, code généré, commit — processedOk=false (pas de notif/loyalty/purchasing)', async () => {
    const { event, intent } = baseEventIntent();
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });

    const client = makeClient([
      { rows: [], rowCount: 1 }, // UPDATE orders SET notes
      { rows: [], rowCount: 1 }, // SAVEPOINT alert_stock_blocked
      { rows: [{ id: 'alert-1' }] }, // INSERT INTO alerts (createAlert, current schema)
      { rows: [], rowCount: 1 }, // RELEASE SAVEPOINT alert_stock_blocked
      { rows: [{ relais_id: 'relais-001' }] }, // SELECT relais_id
      { rows: [], rowCount: 1 }, // INSERT stripe_events_processed
    ]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success: true, noop: false, stockBlocked: true,
      insufficientItems: [{ product_name: 'Sac à dos', available: 0, needed: 2 }],
    });

    const triggerPurchasing = jest.fn();
    const result = await handleStripeSucceeded(event, intent, db, triggerPurchasing);
    await new Promise(r => setTimeout(r, 10));

    expect(result).toEqual({ received: true });
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls.some(s => s.startsWith('UPDATE orders SET notes'))).toBe(true);
    expect(sqls.some(s => s.includes('INSERT INTO alerts'))).toBe(true);
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();

    // stockBlocked → processedOk=false → ni notif, ni loyalty, ni purchasing
    expect(mockNotifyPaymentConfirmed).not.toHaveBeenCalled();
    expect(mockHandleOrderConfirmed).not.toHaveBeenCalled();
    expect(triggerPurchasing).not.toHaveBeenCalled();
    // Le code de retrait est quand même généré et mis en cache (post-commit)
    const { cacheCodeForReveal } = require('../../services/pickup-secret-service');
    expect(cacheCodeForReveal).toHaveBeenCalledWith('order-sb-1', 'TEST-CODE');
  });

  test('cacheCodeForReveal échoue après commit → catch non-bloquant (le code n\'est pas remis en cache mais le flux continue)', async () => {
    const { event, intent } = baseEventIntent({ event: { id: 'evt_sb_cache_fail' } });
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });

    const client = makeClient([
      { rows: [], rowCount: 1 }, // UPDATE orders SET notes
      { rows: [], rowCount: 1 }, // SAVEPOINT alert_stock_blocked
      { rows: [{ id: 'alert-1' }] }, // INSERT INTO alerts (createAlert, current schema)
      { rows: [], rowCount: 1 }, // RELEASE SAVEPOINT alert_stock_blocked
      { rows: [{ relais_id: 'relais-001' }] }, // SELECT relais_id
      { rows: [], rowCount: 1 }, // INSERT stripe_events_processed
    ]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success: true, noop: false, stockBlocked: true,
      insufficientItems: [{ product_name: 'Sac à dos', available: 0, needed: 2 }],
    });

    const { cacheCodeForReveal } = require('../../services/pickup-secret-service');
    cacheCodeForReveal.mockRejectedValueOnce(new Error('cache indisponible'));

    const result = await handleStripeSucceeded(event, intent, db);
    await new Promise(r => setTimeout(r, 10));

    expect(result).toEqual({ received: true });
    expect(cacheCodeForReveal).toHaveBeenCalled();

    cacheCodeForReveal.mockResolvedValue(undefined); // restore pour tests suivants
  });

  test('insertion alerte "critical" échoue → catch alertErr non-bloquant, transaction commit quand même', async () => {
    const { event, intent } = baseEventIntent({ event: { id: 'evt_sb_2' } });
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });

    const client = makeClient([
      { rows: [], rowCount: 1 }, // UPDATE orders SET notes
      { rows: [], rowCount: 1 }, // SAVEPOINT alert_stock_blocked
      { error: new Error('insert alerts failed') }, // INSERT INTO alerts (createAlert) → throw
      { rows: [], rowCount: 1 }, // ROLLBACK TO SAVEPOINT alert_stock_blocked (non-bloquant)
      { rows: [{ relais_id: null }] }, // SELECT relais_id
      { rows: [], rowCount: 1 }, // INSERT stripe_events_processed
    ]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success: true, noop: false, stockBlocked: true,
      insufficientItems: [{ product_name: 'X', available: 0, needed: 1 }],
    });

    const result = await handleStripeSucceeded(event, intent, db, jest.fn());

    expect(result).toEqual({ received: true });
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  test('extrait billing_name / card last4 / email depuis intent.latest_charge (objet complet)', async () => {
    const { event, intent } = baseEventIntent({
      event: { id: 'evt_sb_3' },
      intent: {
        latest_charge: {
          billing_details: { name: 'Ali Hassan', email: 'ali@example.com' },
          payment_method_details: { card: { last4: '4242' } },
        },
      },
    });
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });

    const client = makeClient([
      { rows: [], rowCount: 1 }, // UPDATE orders SET notes
      { rows: [], rowCount: 1 }, // SAVEPOINT alert_stock_blocked
      { rows: [{ id: 'alert-1' }] }, // INSERT INTO alerts (createAlert)
      { rows: [], rowCount: 1 }, // RELEASE SAVEPOINT alert_stock_blocked
      { rows: [{ relais_id: 'relais-002' }] }, // SELECT relais_id
      { rows: [], rowCount: 1 }, // INSERT stripe_events_processed
    ]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success: true, noop: false, stockBlocked: true,
      insufficientItems: [{ product_name: 'Y', available: 0, needed: 1 }],
    });

    const { generateAndStoreSecret } = require('../../services/pickup-secret-service');
    generateAndStoreSecret.mockClear();

    await handleStripeSucceeded(event, intent, db, jest.fn());

    expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
      extraUpdates: expect.objectContaining({
        stripe_billing_name: 'Ali Hassan',
        stripe_card_last4: '4242',
        stripe_receipt_email: 'ali@example.com',
      }),
    }));
  });

  test('génération du code échoue (genErr) → revealCode reste null, pas de cacheCodeForReveal', async () => {
    const { event, intent } = baseEventIntent({ event: { id: 'evt_sb_4' } });
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });

    const client = makeClient([
      { rows: [], rowCount: 1 }, // UPDATE orders SET notes
      { rows: [], rowCount: 1 }, // SAVEPOINT alert_stock_blocked
      { rows: [{ id: 'alert-1' }] }, // INSERT INTO alerts (createAlert)
      { rows: [], rowCount: 1 }, // RELEASE SAVEPOINT alert_stock_blocked
      { rows: [{ relais_id: 'relais-003' }] }, // SELECT relais_id
      { rows: [], rowCount: 1 }, // INSERT stripe_events_processed
    ]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success: true, noop: false, stockBlocked: true,
      insufficientItems: [{ product_name: 'Z', available: 0, needed: 1 }],
    });

    const { generateAndStoreSecret, cacheCodeForReveal } = require('../../services/pickup-secret-service');
    generateAndStoreSecret.mockRejectedValueOnce(new Error('gen failed'));
    cacheCodeForReveal.mockClear();

    await handleStripeSucceeded(event, intent, db, jest.fn());

    expect(cacheCodeForReveal).not.toHaveBeenCalled();
    generateAndStoreSecret.mockResolvedValue({ code: 'TEST-CODE' }); // restore pour tests suivants
  });
});

describe('handleStripeSucceeded — chemin 7 : nominal (processedOk=true)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { generateAndStoreSecret, cacheCodeForReveal } = require('../../services/pickup-secret-service');
    generateAndStoreSecret.mockResolvedValue({ code: 'TEST-CODE' });
    cacheCodeForReveal.mockResolvedValue(undefined);
  });

  function setupNominal(eventId) {
    const event = { id: eventId, type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_nom', receipt_email: null, metadata: { order_id: 'order-nom-1', order_reference: 'KOM-NOM-1' } };
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });
    const client = makeClient([
      { rows: [{ relais_id: 'relais-nom' }] }, // SELECT relais_id
      { rows: [], rowCount: 1 },               // INSERT stripe_events_processed
    ]);
    db.pool.connect.mockResolvedValueOnce(client);
    mockConfirmPaymentCycle.mockResolvedValueOnce({ success: true, noop: false, stockBlocked: false });
    return { event, intent, db, client };
  }

  test('commit + hook fidélité + notification + triggerPurchasing appelés (succès)', async () => {
    const { event, intent, db } = setupNominal('evt_nom_1');
    mockHandleOrderConfirmed.mockResolvedValueOnce({ skipped: false });
    mockNotifyPaymentConfirmed.mockResolvedValueOnce({ invoice: null });

    const triggerPurchasing = jest.fn().mockResolvedValue({ ok: true });
    const result = await handleStripeSucceeded(event, intent, db, triggerPurchasing);
    await new Promise(r => setTimeout(r, 20));

    expect(result).toEqual({ received: true });
    expect(mockHandleOrderConfirmed).toHaveBeenCalledWith({ orderId: 'order-nom-1' });
    expect(mockNotifyPaymentConfirmed).toHaveBeenCalledWith('order-nom-1', 'KOM-NOM-1');
    expect(triggerPurchasing).toHaveBeenCalledWith('order-nom-1');
  });

  test('triggerPurchasing échoue → alerte "elevated" insérée via db.query', async () => {
    const { event, intent, db } = setupNominal('evt_nom_2');

    const triggerPurchasing = jest.fn().mockRejectedValue(new Error('purchasing down'));
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT INTO alerts (elevated)

    await handleStripeSucceeded(event, intent, db, triggerPurchasing);
    await new Promise(r => setTimeout(r, 20));

    const alertCall = db.query.mock.calls.find(c =>
      String(c[0]).includes('INSERT INTO alerts') && (c[1] || []).includes('purchasing_trigger_failed')
    );
    expect(alertCall).toBeDefined();
  });

  test('triggerPurchasing échoue ET l\'insertion d\'alerte échoue aussi → catch non-bloquant', async () => {
    const { event, intent, db } = setupNominal('evt_nom_3');

    const triggerPurchasing = jest.fn().mockRejectedValue(new Error('purchasing down'));
    db.query.mockRejectedValueOnce(new Error('alert insert also failed'));

    await expect(handleStripeSucceeded(event, intent, db, triggerPurchasing)).resolves.toEqual({ received: true });
    await new Promise(r => setTimeout(r, 20));
    // Pas d'assertion supplémentaire : on vérifie juste l'absence de rejet non catché
  });

  test('loyalty hook rejette → catch non-bloquant (branche .catch de la promesse fire-and-forget)', async () => {
    const { event, intent, db } = setupNominal('evt_nom_4');
    mockHandleOrderConfirmed.mockRejectedValueOnce(new Error('loyalty down'));

    await expect(handleStripeSucceeded(event, intent, db, jest.fn().mockResolvedValue({ ok: true })))
      .resolves.toEqual({ received: true });
    await new Promise(r => setTimeout(r, 20));
  });

  test('notification post-paiement rejette → catch non-bloquant', async () => {
    const { event, intent, db } = setupNominal('evt_nom_5');
    mockNotifyPaymentConfirmed.mockRejectedValueOnce(new Error('notif down'));

    await expect(handleStripeSucceeded(event, intent, db, jest.fn().mockResolvedValue({ ok: true })))
      .resolves.toEqual({ received: true });
    await new Promise(r => setTimeout(r, 20));
  });

  test('sans triggerPurchasing fourni (undefined) → pas d\'appel, pas d\'erreur', async () => {
    const { event, intent, db } = setupNominal('evt_nom_6');
    await expect(handleStripeSucceeded(event, intent, db, undefined)).resolves.toEqual({ received: true });
  });
});

describe('handleStripeSucceeded — cycle non réussi (rollback)', () => {
  test('cycleResult.success=false → ROLLBACK + rejected:true, throw propagé si erreur DB', async () => {
    const event = { id: 'evt_rej_1', type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_rej', metadata: { order_id: 'order-rej-1', order_reference: 'KOM-REJ-1' } };
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // markStripeEventProcessed (rejected)

    const client = makeClient([]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockResolvedValueOnce({ success: false, noop: false, error: 'stock invariant violated' });

    const result = await handleStripeSucceeded(event, intent, db, jest.fn());

    expect(result).toEqual({ received: true, rejected: true });
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  test('erreur inattendue pendant la transaction → ROLLBACK puis throw propagé, client relâché', async () => {
    const event = { id: 'evt_err_1', type: 'payment_intent.succeeded' };
    const intent = { id: 'pi_err', metadata: { order_id: 'order-err-1', order_reference: 'KOM-ERR-1' } };
    const db = { query: jest.fn(), pool: { connect: jest.fn() } };
    db.query.mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] });

    const client = makeClient([]);
    db.pool.connect.mockResolvedValueOnce(client);

    mockConfirmPaymentCycle.mockRejectedValueOnce(new Error('unexpected boom'));

    await expect(handleStripeSucceeded(event, intent, db, jest.fn())).rejects.toThrow('unexpected boom');
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('markStripeEventProcessed', () => {
  test('insère normalement sans lever', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await expect(markStripeEventProcessed({ id: 'evt_x', type: 'payment_intent.succeeded' }, { foo: 'bar' }, db))
      .resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stripe_events_processed'),
      ['evt_x', 'payment_intent.succeeded', JSON.stringify({ foo: 'bar' })]
    );
  });

  test('échec DB → catché, ne relève pas (non-bloquant)', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(markStripeEventProcessed({ id: 'evt_y', type: 'payment_intent.succeeded' }, {}, db))
      .resolves.toBeUndefined();
  });

  test('payloadSummary absent → sérialisé comme objet vide', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await markStripeEventProcessed({ id: 'evt_z', type: 'x' }, undefined, db);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['evt_z', 'x', '{}']);
  });
});
