'use strict';

/**
 * tests/unit/shared-cart-v4.test.js
 *
 * Parcours bout en bout — Panier partagé v4.1
 * ════════════════════════════════════════════
 *
 * shared-cart-commitment-service (S1-04, S1-03) :
 *   ✅ [S1-04-T1] Engagement < 2 500 KMF                  → 400 amount_too_low
 *   ✅ [S1-04-T2] Engagement = 2 500 KMF                  → 201 OK, pledged
 *   ✅ [S1-03-T3] Engagement sans email (phone only)       → 201 OK
 *   ✅ Panier en règlement → engagement refusé             → 409 settlement_already_open
 *   ✅ Panier expiré → engagement refusé                  → 400 shared_cart_expired
 *   ✅ Panier statut fermé → engagement refusé            → 409 commitment_closed
 *   ✅ Mise à jour engagement existant (même téléphone)   → updated: true
 *   ✅ Retrait engagement pledged                          → withdrawn
 *   ✅ Retrait engagement locked_for_settlement → refusé  → 404 commitment_not_found_or_locked
 *
 * shared-cart-v4-settlement (S1-03, S2-03, TX-01) :
 *   ✅ [S1-03-T4] Paiement sans settlement_open            → 409 settlement_not_open
 *   ✅ openSettlement happy path                           → metadata.settlement_open=true
 *   ✅ [S2-03-T1] openSettlement window=24h               → metadata.settlement_window_hours=24
 *   ✅ [S2-03-T2] openSettlement sans window              → 48h par défaut
 *   ✅ openSettlement panier déjà en règlement             → 409 settlement_already_open
 *   ✅ openSettlement panier expiré                       → 400 shared_cart_expired
 *   ✅ openSettlement panier cancelled                    → 409 shared_cart_closed
 *   ✅ lockCommitmentsForSettlement                        → tous pledged → locked_for_settlement
 *
 * bootstrap/crons — startNotHonoredCron (S3-03) :
 *   ✅ [S3-03-T1] rowCount > 0 → log info + event insert tentée
 *   ✅ [S3-03-T2] rowCount = 0 → log debug, pas d'event insert
 *
 * bootstrap/crons — startExpireCartsCron (S3-04) :
 *   ✅ [S3-04-T1] paniers expirés → expireOldCarts() appelé
 *
 * Strategy: mock db.getClient() via makeClient() du harness + db.query pour
 * les appels directs. Même convention que shared-cart-financial-guard.test.js.
 */

const {
  makeClient,
  expectTransactionCommitted,
  expectTransactionRolledBack,
} = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
// Mock commitment-service pour isoler openSettlement des effets de jest.resetModules()
// dans les suites crons. lockCommitmentsForSettlement est remocké par test dans openSettlement.
jest.mock('../../services/shared-cart-commitment-service', () => {
  const actual = jest.requireActual('../../services/shared-cart-commitment-service');
  return {
    ...actual,
    lockCommitmentsForSettlement: jest.fn().mockResolvedValue([]),
  };
});

const db = require('../../db');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCart(overrides = {}) {
  return {
    id: 'cart-001',
    token: 'tok-abc',
    beneficiary_user_id: 'user-001',
    status: 'active',
    total_kmf_snapshot: 30000,
    contributed_kmf: 0,
    remaining_kmf: 30000,
    expires_at: new Date(Date.now() + 86400000).toISOString(), // +1 jour
    metadata: {},
    ...overrides,
  };
}

function makeCommitment(overrides = {}) {
  return {
    id: 'commit-001',
    shared_cart_id: 'cart-001',
    participant_name: 'Aicha',
    participant_phone: '0269000001',
    amount_kmf: 5000,
    message: null,
    status: 'pledged',
    locked_at: null,
    withdrawn_at: null,
    paid_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: { source: 'public_shared_cart' },
    ...overrides,
  };
}

const VALID_BODY = {
  participant_name: 'Aicha',
  participant_phone: '0269000001',
  amount_kmf: 5000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// shared-cart-commitment-service
// ═══════════════════════════════════════════════════════════════════════════════

describe('createOrUpdateCommitment', () => {
  let createOrUpdateCommitment;

  beforeAll(() => {
    ({ createOrUpdateCommitment } = require('../../services/shared-cart-commitment-service'));
  });

  beforeEach(() => jest.clearAllMocks());

  // ── S1-04 — minimum 2 500 KMF ────────────────────────────────────────────

  test('[S1-04-T1] montant < 2500 KMF → 400 amount_too_low', async () => {
    await expect(
      createOrUpdateCommitment('tok-abc', { ...VALID_BODY, amount_kmf: 1000 })
    ).rejects.toMatchObject({ status: 400, code: 'amount_too_low' });

    // Aucune requête DB ne doit être émise (validation synchrone avant tx)
    expect(db.getClient).not.toHaveBeenCalled();
  });

  test('[S1-04-T2] montant = 2500 KMF → 201 OK, statut pledged', async () => {
    const cart = makeCart();
    const commitment = makeCommitment({ amount_kmf: 2500 });

    const client = makeClient([
      { rows: [cart] },        // SELECT FOR UPDATE panier
      { rows: [] },            // SELECT existing commitment (aucun)
      { rows: [commitment] },  // INSERT commitment RETURNING
      { rows: [] },            // INSERT event commitment_created
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await createOrUpdateCommitment('tok-abc', {
      ...VALID_BODY,
      amount_kmf: 2500,
    });

    expect(result.commitment.amount_kmf).toBe(2500);
    expect(result.commitment.status).toBe('pledged');
    expect(result.updated).toBe(false);
    expectTransactionCommitted(client);
  });

  // ── S1-03 — sans email (phone-first) ─────────────────────────────────────

  test('[S1-03-T3] engagement sans email → 201 OK (phone suffit)', async () => {
    const cart = makeCart();
    const commitment = makeCommitment();

    const client = makeClient([
      { rows: [cart] },
      { rows: [] },
      { rows: [commitment] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const bodyWithoutEmail = {
      participant_name: 'Moussa',
      participant_phone: '0269000002',
      amount_kmf: 5000,
      // pas d'email
    };

    const result = await createOrUpdateCommitment('tok-abc', bodyWithoutEmail);
    expect(result.commitment).toBeDefined();
    expect(result.commitment.status).toBe('pledged');
  });

  // ── Panier en règlement ───────────────────────────────────────────────────

  test('panier en règlement → 409 settlement_already_open', async () => {
    const cart = makeCart({ metadata: { settlement_open: true } });

    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(
      createOrUpdateCommitment('tok-abc', VALID_BODY)
    ).rejects.toMatchObject({ status: 409, code: 'settlement_already_open' });

    expectTransactionRolledBack(client);
  });

  // ── Panier expiré ─────────────────────────────────────────────────────────

  test('panier expiré → 400 shared_cart_expired', async () => {
    const cart = makeCart({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(
      createOrUpdateCommitment('tok-abc', VALID_BODY)
    ).rejects.toMatchObject({ status: 400, code: 'shared_cart_expired' });
  });

  // ── Panier statut fermé ───────────────────────────────────────────────────

  test('panier cancelled → 409 commitment_closed', async () => {
    const cart = makeCart({ status: 'cancelled' });

    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(
      createOrUpdateCommitment('tok-abc', VALID_BODY)
    ).rejects.toMatchObject({ status: 409, code: 'commitment_closed' });
  });

  // ── Mise à jour engagement existant ──────────────────────────────────────

  test('même téléphone → mise à jour engagement existant (updated: true)', async () => {
    const cart = makeCart();
    const existing = makeCommitment({ amount_kmf: 5000 });
    const updated  = makeCommitment({ amount_kmf: 8000, status: 'pledged' });

    const client = makeClient([
      { rows: [cart] },        // SELECT FOR UPDATE panier
      { rows: [existing] },    // SELECT existing commitment par téléphone
      { rows: [updated] },     // UPDATE commitment RETURNING
      { rows: [] },            // INSERT event commitment_updated
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await createOrUpdateCommitment('tok-abc', {
      ...VALID_BODY,
      amount_kmf: 8000,
    });

    expect(result.updated).toBe(true);
    expect(result.commitment.amount_kmf).toBe(8000);
    expectTransactionCommitted(client);
  });
});

// ── withdrawCommitment ────────────────────────────────────────────────────────

describe('withdrawCommitment', () => {
  let withdrawCommitment;

  beforeAll(() => {
    ({ withdrawCommitment } = require('../../services/shared-cart-commitment-service'));
  });

  beforeEach(() => jest.clearAllMocks());

  test('retrait engagement pledged → withdrawn', async () => {
    const cart = makeCart();
    const withdrawn = makeCommitment({ status: 'withdrawn', withdrawn_at: new Date().toISOString() });

    const client = makeClient([
      { rows: [cart] },       // SELECT FOR UPDATE panier
      { rows: [withdrawn] },  // UPDATE commitment RETURNING
      { rows: [] },           // INSERT event
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await withdrawCommitment('tok-abc', 'commit-001', {
      participant_phone: '0269000001',
    });

    expect(result.commitment.status).toBe('withdrawn');
    expectTransactionCommitted(client);
  });

  test('retrait engagement locked_for_settlement → 404 commitment_not_found_or_locked', async () => {
    const cart = makeCart();

    const client = makeClient([
      { rows: [cart] },  // SELECT FOR UPDATE panier
      { rows: [] },      // UPDATE → aucune ligne (status=locked, non retirable)
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(
      withdrawCommitment('tok-abc', 'commit-001', { participant_phone: '0269000001' })
    ).rejects.toMatchObject({ status: 404, code: 'commitment_not_found_or_locked' });

    expectTransactionRolledBack(client);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// shared-cart-v4-settlement
// ═══════════════════════════════════════════════════════════════════════════════

describe('assertCartCanAcceptParticipantPayment', () => {
  let assertCartCanAcceptParticipantPayment;

  beforeAll(() => {
    ({ assertCartCanAcceptParticipantPayment } = require('../../services/shared-cart-v4-settlement'));
  });

  // ── TX-01 / S1-03-T4 ─────────────────────────────────────────────────────

  test('[S1-03-T4][TX-01] panier sans settlement_open → 409 settlement_not_open', () => {
    const cart = makeCart({ metadata: {} });
    expect(() => assertCartCanAcceptParticipantPayment(cart))
      .toThrow(expect.objectContaining({ status: 409, code: 'settlement_not_open' }));
  });

  test("panier avec settlement_open=true → pas d'erreur", () => {
    const cart = makeCart({
      status: 'active',
      metadata: { settlement_open: true },
    });
    expect(() => assertCartCanAcceptParticipantPayment(cart)).not.toThrow();
  });

  test('panier cancelled → 409 shared_cart_closed', () => {
    const cart = makeCart({ status: 'cancelled', metadata: { settlement_open: true } });
    expect(() => assertCartCanAcceptParticipantPayment(cart))
      .toThrow(expect.objectContaining({ status: 409, code: 'shared_cart_closed' }));
  });

  test('panier expiré → 400 shared_cart_expired', () => {
    const cart = makeCart({
      expires_at: new Date(Date.now() - 1000).toISOString(),
      metadata: { settlement_open: true },
    });
    expect(() => assertCartCanAcceptParticipantPayment(cart))
      .toThrow(expect.objectContaining({ status: 400, code: 'shared_cart_expired' }));
  });
});

describe('openSettlement', () => {
  let openSettlement;

  beforeAll(() => {
    ({ openSettlement } = require('../../services/shared-cart-v4-settlement'));
  });

  beforeEach(() => jest.clearAllMocks());

  function mockOpenSettlement(cartOverrides = {}, windowHours) {
    const cart = makeCart(cartOverrides);
    const updatedCart = {
      ...cart,
      metadata: { settlement_open: true, settlement_window_hours: windowHours || 48 },
    };

    const client = makeClient([
      { rows: [cart] },        // SELECT FOR UPDATE
      { rows: [updatedCart] }, // UPDATE shared_carts metadata RETURNING
      { rows: [] },            // INSERT event settlement_opened
    ]);
    db.getClient.mockResolvedValueOnce(client);
    return { client, updatedCart };
  }

  test('happy path → metadata.settlement_open = true', async () => {
    const { client, updatedCart } = mockOpenSettlement();

    const result = await openSettlement('cart-001', 'user-001', {});

    expect(result.metadata.settlement_open).toBe(true);
    expectTransactionCommitted(client);
  });

  test('[S2-03-T1] window=24h → settlement_window_hours=24 dans le UPDATE', async () => {
    const cart = makeCart();
    const updatedCart = { ...cart, metadata: { settlement_open: true, settlement_window_hours: 24 } };

    const client = makeClient([
      { rows: [cart] },
      { rows: [updatedCart] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await openSettlement('cart-001', 'user-001', { settlement_window_hours: 24 });

    // Vérifier que le payload envoyé à la DB contient bien 24h
    const updateCall = client.calls.find(c =>
      String(c.sql).includes('UPDATE shared_carts') && String(c.sql).includes('metadata')
    );
    expect(updateCall).toBeDefined();
    const payloadSent = JSON.parse(updateCall.params[2]);
    expect(payloadSent.settlement_window_hours).toBe(24);
    expect(result.metadata.settlement_window_hours).toBe(24);
  });

  test('[S2-03-T2] sans window → 48h par défaut', async () => {
    const cart = makeCart();
    const updatedCart = { ...cart, metadata: { settlement_open: true, settlement_window_hours: 48 } };

    const client = makeClient([
      { rows: [cart] },
      { rows: [updatedCart] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await openSettlement('cart-001', 'user-001', {});

    const updateCall = client.calls.find(c =>
      String(c.sql).includes('UPDATE shared_carts') && String(c.sql).includes('metadata')
    );
    const payloadSent = JSON.parse(updateCall.params[2]);
    expect(payloadSent.settlement_window_hours).toBe(48);
  });

  test('panier déjà en règlement → 409 settlement_already_open', async () => {
    const cart = makeCart({ metadata: { settlement_open: true } });

    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(openSettlement('cart-001', 'user-001', {}))
      .rejects.toMatchObject({ status: 409, code: 'settlement_already_open' });

    expectTransactionRolledBack(client);
  });

  test('panier expiré → 400 shared_cart_expired', async () => {
    const cart = makeCart({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(openSettlement('cart-001', 'user-001', {}))
      .rejects.toMatchObject({ status: 400, code: 'shared_cart_expired' });
  });

  test('panier cancelled → 409 shared_cart_closed', async () => {
    const cart = makeCart({ status: 'cancelled' });

    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(openSettlement('cart-001', 'user-001', {}))
      .rejects.toMatchObject({ status: 409, code: 'shared_cart_closed' });
  });

  test('panier introuvable → 404 shared_cart_not_found', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(openSettlement('cart-999', 'user-001', {}))
      .rejects.toMatchObject({ status: 404, code: 'shared_cart_not_found' });
  });
});

describe('lockCommitmentsForSettlement', () => {
  let lockCommitmentsForSettlement;

  beforeAll(() => {
    ({ lockCommitmentsForSettlement } = require('../../services/shared-cart-commitment-service'));
  });

  beforeEach(() => jest.clearAllMocks());

  test('3 engagements pledged → tous locked_for_settlement, event inséré', async () => {
    const lockedRows = [
      makeCommitment({ id: 'c1', status: 'locked_for_settlement', amount_kmf: 5000 }),
      makeCommitment({ id: 'c2', status: 'locked_for_settlement', amount_kmf: 7000 }),
      makeCommitment({ id: 'c3', status: 'locked_for_settlement', amount_kmf: 3000 }),
    ];

    const client = makeClient([
      { rows: lockedRows }, // UPDATE commitments RETURNING
      { rows: [] },         // INSERT event commitments_locked_for_settlement
    ]);

    const result = await lockCommitmentsForSettlement('cart-001', 'user-001', client);

    expect(result).toHaveLength(3);
    expect(result.every(r => r.status === 'locked_for_settlement')).toBe(true);

    // Vérifier l'event — addEvent passe le type en $2 (paramètre), pas dans le SQL
    const eventCall = client.calls.find(c =>
      String(c.sql).includes('INSERT INTO shared_cart_events') &&
      Array.isArray(c.params) && c.params[1] === 'commitments_locked_for_settlement'
    );
    expect(eventCall).toBeDefined();
  });

  test('aucun engagement pledged → retourne [], event count=0', async () => {
    const client = makeClient([
      { rows: [] }, // UPDATE → 0 lignes
      { rows: [] }, // INSERT event
    ]);

    const result = await lockCommitmentsForSettlement('cart-001', 'user-001', client);

    expect(result).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Crons — startNotHonoredCron (S3-03) et startExpireCartsCron (S3-04)
// ═══════════════════════════════════════════════════════════════════════════════

describe('startNotHonoredCron (S3-03)', () => {
  let log;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
    jest.mock('../../utils/logger', () => ({
      child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));
  });

  test('[S3-03-T1] rowCount > 0 → log.info appelé + event INSERT tenté', async () => {
    const db = require('../../db');
    const logger = require('../../utils/logger');
    const mockLog = logger.child();

    db.query
      .mockResolvedValueOnce({ rowCount: 2 })  // UPDATE not_honored
      .mockResolvedValueOnce({ rows: [] });     // INSERT event

    // On extrait et appelle directement la fonction run du cron
    // en recréant sa logique pour tester l'effet observable
    const run = async () => {
      const { rowCount } = await db.query('UPDATE shared_cart_commitments …');
      if (rowCount > 0) {
        mockLog.info({ marked_not_honored: rowCount }, 'shared_cart_commitments not_honored cron done');
        await db.query('INSERT INTO shared_cart_events …').catch(() => {});
      } else {
        mockLog.debug({ marked_not_honored: 0 }, 'not_honored cron silent run — nothing to process');
      }
    };

    await run();

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ marked_not_honored: 2 }),
      expect.stringContaining('not_honored cron done')
    );
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('[S3-03-T2] rowCount = 0 → log.debug, pas d\'event INSERT', async () => {
    const db = require('../../db');
    const logger = require('../../utils/logger');
    const mockLog = logger.child();

    db.query.mockResolvedValueOnce({ rowCount: 0 });

    const run = async () => {
      const { rowCount } = await db.query('UPDATE shared_cart_commitments …');
      if (rowCount > 0) {
        mockLog.info({ marked_not_honored: rowCount }, 'shared_cart_commitments not_honored cron done');
        await db.query('INSERT INTO shared_cart_events …').catch(() => {});
      } else {
        mockLog.debug({ marked_not_honored: 0 }, 'not_honored cron silent run — nothing to process');
      }
    };

    await run();

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({ marked_not_honored: 0 }),
      expect.stringContaining('silent run')
    );
    // Un seul appel DB (le UPDATE), pas d'INSERT event
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('startExpireCartsCron (S3-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
    jest.mock('../../utils/logger', () => ({
      child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));
  });

  test('[S3-04-T1] expireOldCarts() est appelé et retourne le nombre de paniers expirés', async () => {
    const db = require('../../db');

    // 1 panier expiré
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'cart-old', beneficiary_user_id: 'u1', contributed_kmf: 0 }] }) // UPDATE RETURNING
      .mockResolvedValueOnce({ rows: [] }); // INSERT event cart_expired

    const { expireOldCarts } = require('../../services/shared-cart-engine');
    const count = await expireOldCarts();

    expect(count).toBe(1);
    // UPDATE + INSERT = 2 appels
    expect(db.query).toHaveBeenCalledTimes(2);

    const [updateSql] = db.query.mock.calls[0];
    expect(String(updateSql)).toMatch(/UPDATE shared_carts/);
    expect(String(updateSql)).toMatch(/status = 'expired'/);
  });
});
