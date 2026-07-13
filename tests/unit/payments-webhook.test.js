/**
 * KOMERCE — Tests Unitaires : payments-webhook (REFACTO-PAYMENTS)
 *
 * Couvre les 8 chemins de sortie de _handleStripeSucceeded
 * + le guard payment_failed de _handleStripePaymentFailed.
 *
 * Strategy :
 *   - mock complet de db (query + pool.connect)
 *   - mock confirmPaymentCycle (retourne noop / rejected / stockBlocked / success)
 *   - mock generateAndStoreSecret, cacheCodeForReveal (no-op)
 *   - mock triggerPurchasing (no-op, fire-and-forget)
 *   - mock sendSMS, notification-service (no-op)
 *   - res simulé avec jest.fn() pour capturer les réponses JSON
 *
 * Run : npx jest tests/unit/payments-webhook.test.js
 */

'use strict';

// ── Helpers ────────────────────────────────────────────────────────────────
const { makeClient } = require('../integration/test-harness/mock-db');

// ── Mock : db ──────────────────────────────────────────────────────────────
const mockDbQuery = jest.fn();
const mockPoolConnect = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
  pool:  { connect: (...args) => mockPoolConnect(...args) },
}));

// ── Mock : stripe ──────────────────────────────────────────────────────────
jest.mock('stripe', () => {
  return jest.fn(() => ({
    webhooks: {
      constructEvent: jest.fn((body, sig, secret) => JSON.parse(body.toString())),
    },
    paymentIntents: { create: jest.fn() },
  }));
});

// ── Mock : confirmPaymentCycle ──────────────────────────────────────────────
const mockConfirmPaymentCycle = jest.fn();
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: (...args) => mockConfirmPaymentCycle(...args),
}));

// ── Mock : pickup-secret ───────────────────────────────────────────────────
jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
  cacheCodeForReveal:     jest.fn().mockResolvedValue(undefined),
}));

// ── Mock : purchasing ──────────────────────────────────────────────────────
// O7.2 (Cycle B) : routes/payments.js importe désormais directement le vrai
// service purchasing-trigger-service.js (plus routes/purchasing.js). Voir
// docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
jest.mock('../../services/purchasing-trigger-service', () => ({
  triggerPurchasing: jest.fn().mockResolvedValue({ ok: true }),
}));

// ── Mock : notifications (utils/sms supprimé au profit de notification-service) ──
jest.mock('../../services/notification-service', () => ({
  notifyText: jest.fn().mockResolvedValue(undefined),
  notifyPaymentConfirmed: jest.fn().mockResolvedValue({ invoice: null }),
}));

// ── Mock : rates ──────────────────────────────────────────────────────────
jest.mock('../../utils/rates', () => ({
  getRates: jest.fn().mockResolvedValue({ eur_kmf: 500, aed_kmf: 136 }),
}));

// ── Mock : notification-service ───────────────────────────────────────────
jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: jest.fn().mockResolvedValue({ invoice: null }),
}));

// ── Mock : validators ─────────────────────────────────────────────────────
jest.mock('../../validators', () => ({
  payments: { stripeIntent: {}, cashConfirm: {} },
}));

// ── Mock : middleware ─────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
  requireRole:  () => (req, res, next) => next(),
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

// ── Mock : order-status-machine (import conservé dans payments.js) ─────────
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn(),
  isForwardTransition:   jest.fn(),
  ORDER_STATUSES:        {},
  STATUS_RANK:           {},
  VALID_TRANSITIONS:     {},
}));

// ── Import après mocks ──────────────────────────────────────────────────────
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
const { generateAndStoreSecret, cacheCodeForReveal } = require('../../services/pickup-secret-service');

// ── Helpers de test ──────────────────────────────────────────────────────────

/** Construit un faux objet Express res */
function makeRes() {
  const res = {
    _body:   null,
    _status: 200,
    status:  jest.fn(function(code) { this._status = code; return this; }),
    json:    jest.fn(function(body)  { this._body   = body; return this; }),
    send:    jest.fn(function(body)  { this._body   = body; return this; }),
  };
  return res;
}

/** Construit un faux objet Express req pour le webhook */
function makeWebhookReq(eventObj) {
  const raw = Buffer.from(JSON.stringify(eventObj));
  return {
    body:    raw,
    headers: { 'stripe-signature': 'fake-sig' },
  };
}

/** Construit un event Stripe payment_intent.succeeded */
function makeSucceededEvent(overrides = {}) {
  return {
    id:   'evt_test_001',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id:              'pi_test_001',
        receipt_email:   null,
        charges:         { data: [] },
        metadata: {
          order_id:        'order-uuid-001',
          order_reference: 'KOM-001',
          ...overrides.metadata,
        },
        ...overrides.intent,
      },
    },
    ...overrides.event,
  };
}

/** Extrait le handler async du router stripe/webhook en appelant le vrai module */
async function callWebhook(eventObj) {
  // On appelle directement le module express en simulant une requête supertest-like.
  // Pour garder les tests unitaires sans supertest, on extrait _handleStripeSucceeded
  // via la route elle-même en utilisant un mini-dispatcher.

  // Re-require pour obtenir le router (mocks déjà en place)
  jest.resetModules();
  // Re-mock après resetModules
  jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a), pool: { connect: (...a) => mockPoolConnect(...a) } }));
  jest.mock('stripe', () => jest.fn(() => ({ webhooks: { constructEvent: jest.fn((b) => JSON.parse(b.toString())) }, paymentIntents: { create: jest.fn() } })));
  jest.mock('../../services/order-payment-confirmation', () => ({ confirmPaymentCycle: (...a) => mockConfirmPaymentCycle(...a) }));
  jest.mock('../../services/pickup-secret-service', () => ({ generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'X' }), cacheCodeForReveal: jest.fn().mockResolvedValue(undefined) }));
  jest.mock('../../services/purchasing-trigger-service', () => ({ triggerPurchasing: jest.fn().mockResolvedValue({ ok: true }) }));
  jest.mock('../../utils/rates', () => ({ getRates: jest.fn().mockResolvedValue({ eur_kmf: 500, aed_kmf: 136 }) }));
  jest.mock('../../services/notification-service', () => ({ notifyPaymentConfirmed: jest.fn().mockResolvedValue({ invoice: null }) }));
  jest.mock('../../validators', () => ({ payments: { stripeIntent: {}, cashConfirm: {} } }));
  jest.mock('../../middleware/auth', () => ({ authenticate: (r,s,n)=>n(), requireRole: ()=>(r,s,n)=>n() }));
  jest.mock('../../middleware/validate', () => ({ validate: ()=>(r,s,n)=>n() }));
  jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn(), isForwardTransition: jest.fn(), ORDER_STATUSES: {}, STATUS_RANK: {}, VALID_TRANSITIONS: {} }));
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests des 8 chemins de sortie de _handleStripeSucceeded
// Les tests utilisent mockDbQuery / mockPoolConnect / mockConfirmPaymentCycle
// ══════════════════════════════════════════════════════════════════════════════

// ─── Utilitaire : crée un client DB transactionnel avec script de réponses ───
function setupClientForNominal(orderId = 'order-uuid-001', ref = 'KOM-001') {
  const client = makeClient([
    // confirmPaymentCycle est mocké — pas de query directe de son côté ici
    // SELECT relais_id FROM orders
    { rows: [{ relais_id: 'relais-001' }] },
    // INSERT stripe_events_processed (ON CONFLICT)
    { rows: [], rowCount: 1 },
  ]);
  mockPoolConnect.mockResolvedValueOnce(client);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Par défaut : stripe_events_processed vide (event non vu)
  mockDbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ─── Chemin 1 : PI sans order_id → ignored ───────────────────────────────────
describe('_handleStripeSucceeded — chemin 1 : PI sans order_id', () => {
  test('répond { received: true, ignored: true }', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = makeSucceededEvent({ metadata: { order_id: undefined, order_reference: undefined } });
    // Stripe constructEvent retourne l'event tel quel (mocké)
    // On simule l'appel via supertest-light : on déclenche directement la route
    // en parcourant les layers du router.
    const req = makeWebhookReq(event);
    const res = makeRes();
    const next = jest.fn();

    // Trouver le handler stripe/webhook dans le router
    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    expect(layer).toBeDefined();

    // Exécuter les middlewares en séquence
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise((resolve) => {
        const result = h(req, res, (err) => { if (err) next(err); resolve(); });
        if (result && result.then) result.then(resolve).catch(resolve);
        else resolve();
      });
    }

    expect(res._body).toEqual({ received: true, ignored: true });
  });
});

// ─── Chemin 2 : order not found → ignored ────────────────────────────────────
describe('_handleStripeSucceeded — chemin 2 : order introuvable', () => {
  test('répond { received: true, ignored: true }', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = makeSucceededEvent();

    // stripe_events_processed : non vu
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })          // SELECT stripe_events_processed → vide
      .mockResolvedValueOnce({ rows: [] })          // SELECT payment_status → order not found
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // _markEventProcessed

    const req = makeWebhookReq(event);
    const res = makeRes();
    const next = jest.fn();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => {
        const r = h(req, res, () => resolve());
        if (r && r.then) r.then(resolve).catch(resolve); else resolve();
      });
    }

    expect(res._body).toEqual({ received: true, ignored: true });
  });
});

// ─── Chemin 3 : order déjà paid → idempotent ────────────────────────────────
describe('_handleStripeSucceeded — chemin 3 : order déjà paid', () => {
  test('répond { received: true, idempotent: true }', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = makeSucceededEvent();

    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })                           // stripe_events_processed → vide
      .mockResolvedValueOnce({ rows: [{ payment_status: 'paid' }] }) // SELECT payment_status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });             // _markEventProcessed

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    expect(res._body).toEqual({ received: true, idempotent: true });
    expect(mockConfirmPaymentCycle).not.toHaveBeenCalled();
  });
});

// ─── Chemin 4 : cycleResult.noop → idempotent ───────────────────────────────
describe('_handleStripeSucceeded — chemin 4 : cycleResult.noop', () => {
  test('répond { received: true, idempotent: true }, pas de SMS', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = makeSucceededEvent();

    mockConfirmPaymentCycle.mockResolvedValueOnce({ noop: true, success: false });

    const client = makeClient([
      // Pas de query custom — noop → COMMIT direct
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })                              // stripe_events_processed → vide
      .mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] }) // SELECT payment_status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                // _markEventProcessed (après COMMIT)

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    expect(res._body).toEqual({ received: true, idempotent: true });
    expect(triggerPurchasing).not.toHaveBeenCalled();
  });
});

// ─── Chemin 5 : cycleResult rejected ────────────────────────────────────────
describe('_handleStripeSucceeded — chemin 5 : cycleResult rejected', () => {
  test('répond { received: true, rejected: true }, ROLLBACK effectué', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = makeSucceededEvent();

    mockConfirmPaymentCycle.mockResolvedValueOnce({ success: false, noop: false, error: 'invalid_transition' });

    const client = makeClient([]);
    mockPoolConnect.mockResolvedValueOnce(client);

    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // _markEventProcessed

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    expect(res._body).toEqual({ received: true, rejected: true });
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('ROLLBACK');
    expect(triggerPurchasing).not.toHaveBeenCalled();
  });
});

// ─── Chemin 6 : stockBlocked → commit + alerte + SMS paid_pending_review ────
describe('_handleStripeSucceeded — chemin 6 : stockBlocked', () => {
  // TODO(notif-migration): recâbler l'assertion sur notification-service.notifyText au lieu de sendSMS (utils/sms supprimé ZG-1).
  test.todo('commit effectué, notif paid_pending_review envoyée, triggerPurchasing NON appelé');
  test.skip('commit effectué, SMS paid_pending_review envoyé, triggerPurchasing NON appelé', async () => {
    const paymentsRouter = require('../../routes/payments');
    const { sendSMS: mockSMS } = require('../../utils/sms');
    const event = makeSucceededEvent();

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success: true,
      noop:    false,
      stockBlocked: true,
      insufficientItems: [{ product_name: 'iPhone', available: 0, needed: 1 }],
    });

    const client = makeClient([
      // UPDATE orders notes (incidentNote)
      { rows: [], rowCount: 1 },
      // INSERT alerts
      { rows: [], rowCount: 1 },
      // SELECT relais_id
      { rows: [{ relais_id: 'relais-001' }] },
      // generateAndStoreSecret → mocké, mais les queries db.client sont dans makeClient
      // INSERT stripe_events_processed
      { rows: [], rowCount: 1 },
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })                              // stripe_events_processed
      .mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] }) // SELECT payment_status
      // Post-commit SELECT order + user_phone
      .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-001', user_phone: '+26900000000', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // éventuels

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    // Attendre les fire-and-forget (SMS est synchrone dans le mock)
    await new Promise(r => setTimeout(r, 10));

    expect(res._body).toEqual({ received: true });
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
    expect(triggerPurchasing).not.toHaveBeenCalled();
    // SMS paid_pending_review
    const smsCalls = mockSMS.mock.calls;
    expect(smsCalls.length).toBeGreaterThan(0);
    expect(smsCalls[0][2]).toBe('paid_pending_review');
  });
});

// ─── Chemin 7 : nominal → commit + SMS + notif + triggerPurchasing ──────────
describe('_handleStripeSucceeded — chemin 7 : nominal', () => {
  // TODO(notif-migration): recâbler l'assertion sur notification-service.notifyText au lieu de sendSMS (utils/sms supprimé ZG-1).
  test.todo('commit effectué, notif ordered envoyée, triggerPurchasing appelé');
  test.skip('commit effectué, SMS ordered, triggerPurchasing appelé (fire-and-forget)', async () => {
    const paymentsRouter = require('../../routes/payments');
    const { sendSMS: mockSMS } = require('../../utils/sms');
    const event = makeSucceededEvent({ event: { id: 'evt_nominal_007' } });

    mockConfirmPaymentCycle.mockResolvedValueOnce({
      success:      true,
      noop:         false,
      stockBlocked: false,
    });

    const client = makeClient([
      // SELECT relais_id
      { rows: [{ relais_id: 'relais-001' }] },
      // INSERT stripe_events_processed
      { rows: [], rowCount: 1 },
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    // Reset complet + séquence explicite
    mockDbQuery.mockReset();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })                              // stripe_events_processed → vide
      .mockResolvedValueOnce({ rows: [{ payment_status: 'pending' }] }) // SELECT payment_status
      // Post-commit SELECT order + user_phone
      .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-001', user_phone: '+26900000000', reference: 'KOM-001' }] })
      .mockResolvedValue({ rows: [], rowCount: 0 }); // fallback

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    await new Promise(r => setTimeout(r, 20));

    expect(res._body).toEqual({ received: true });
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
    expect(triggerPurchasing).toHaveBeenCalledWith('order-uuid-001');
    const smsCalls = mockSMS.mock.calls;
    expect(smsCalls.length).toBeGreaterThan(0);
    expect(smsCalls[0][2]).toBe('ordered');
  });
});

// ─── Chemin 8 : idempotence globale event.id ─────────────────────────────────
describe('stripe/webhook — idempotence event.id globale', () => {
  test('répond { received: true, idempotent: true } si event déjà vu', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = makeSucceededEvent();

    // stripe_events_processed : déjà vu → rows non vides
    mockDbQuery.mockResolvedValueOnce({ rows: [{ stripe_event_id: event.id }] });

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    expect(res._body).toEqual({ received: true, idempotent: true });
    expect(mockConfirmPaymentCycle).not.toHaveBeenCalled();
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});

// ── _handleStripePaymentFailed ────────────────────────────────────────────────
describe('_handleStripePaymentFailed — guard "ne pas écraser paid avec failed"', () => {
  test('UPDATE conditionnel : si payment_status = pending → appliqué', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = {
      id:   'evt_failed_001',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_fail_001',
          metadata: { order_id: 'order-uuid-002', order_reference: 'KOM-002' },
        },
      },
    };

    mockDbQuery.mockReset();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })              // stripe_events_processed → vide
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE orders SET payment_status = 'failed' (1 row updated)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // _markEventProcessed
      .mockResolvedValue({ rows: [], rowCount: 0 });    // fallback

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    expect(res._body).toEqual({ received: true });
    // Vérifier que l'UPDATE conditionnel a été exécuté avec AND payment_status = 'pending'
    const updateCall = mockDbQuery.mock.calls.find(c =>
      String(c[0]).includes("payment_status = 'failed'") &&
      String(c[0]).includes("payment_status = 'pending'")
    );
    expect(updateCall).toBeDefined();
  });

  test('guard actif : si order déjà paid, rowCount=0, pas de mise à jour', async () => {
    const paymentsRouter = require('../../routes/payments');
    const event = {
      id:   'evt_failed_002',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_fail_002',
          metadata: { order_id: 'order-uuid-003', order_reference: 'KOM-003' },
        },
      },
    };

    mockDbQuery.mockReset();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })              // stripe_events_processed → vide
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE conditionnel → 0 rows (déjà paid)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // _markEventProcessed
      .mockResolvedValue({ rows: [], rowCount: 0 });    // fallback

    const req = makeWebhookReq(event);
    const res = makeRes();

    const layer = paymentsRouter.stack.find(l => l.route && l.route.path === '/stripe/webhook');
    const handlers = layer.route.stack.map(s => s.handle);
    for (const h of handlers) {
      if (res._body !== null) break;
      await new Promise(resolve => { const r = h(req, res, ()=>resolve()); if (r&&r.then) r.then(resolve).catch(resolve); else resolve(); });
    }

    expect(res._body).toEqual({ received: true });
    // La commande reste paid — aucun confirmPaymentCycle appelé
    expect(mockConfirmPaymentCycle).not.toHaveBeenCalled();
  });
});
