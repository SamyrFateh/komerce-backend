'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/qr-collection-core-emission.test.js
 *
 * Couvre services/qr-collection-core.js :: issueOrRotateQrToken (P5 §4.6)
 *
 * `resolveQrCollection` (consommation) est déjà couvert de bout en bout via
 * tests/unit/verify-qr-collection.test.js et tests/unit/scan-operations.test.js
 * (les deux appelants n'y mockent pas qr-collection-core.js). Cette suite
 * comble le trou symétrique côté émission/rotation : jusqu'ici
 * `issueOrRotateQrToken` n'était exercé qu'à travers un mock dans
 * tests/unit/qr.test.js (routes/orders/qr.js), jamais dans sa propre logique
 * réelle (verrou de ligne, distinction rotated true/false, preWriteCheck,
 * garde de statut).
 */

const crypto = require('crypto');
const { makeClient } = require('../integration/test-harness/mock-db');

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const { issueOrRotateQrToken } = require('../../services/qr-collection-core');

function baseOrder(overrides = {}) {
  return {
    id: 'order-1',
    reference: 'CMD-1',
    status: 'available',
    qr_token: null,
    qr_expires_at: null,
    relais_id: 'relais-A',
    relais_name: 'Relais Moroni',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('issueOrRotateQrToken — verrou de ligne', () => {
  it('exécute un SELECT ... FOR UPDATE OF o sur la commande avant toute décision', async () => {
    const client = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    await issueOrRotateQrToken({ client, orderId: 'order-1' });

    const selectCall = client.calls.find(c => /SELECT/i.test(c.sql));
    expect(selectCall.sql).toMatch(/FOR UPDATE OF o/);
    expect(selectCall.params).toEqual(['order-1']);
  });
});

describe('issueOrRotateQrToken — commande introuvable', () => {
  it('ROLLBACK + 404 si aucune commande ne matche l\'id', async () => {
    const client = makeClient([{ rows: [] }]);
    const result = await issueOrRotateQrToken({ client, orderId: 'order-x' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(404);
    expect(client.calls.map(c => c.sql.trim())).toContain('ROLLBACK');
  });
});

describe('issueOrRotateQrToken — preWriteCheck (autorisation)', () => {
  it('appelle preWriteCheck avec la ligne verrouillée AVANT le contrôle de statut', async () => {
    const order = baseOrder({ status: 'shipped' }); // statut incompatible — ne doit jamais être atteint
    const client = makeClient([{ rows: [order] }]);
    const preWriteCheck = jest.fn(() => ({
      ok: false,
      response: { status: 403, body: { error: "Cette commande n'appartient pas à votre relais" } },
    }));

    const result = await issueOrRotateQrToken({ client, orderId: 'order-1', preWriteCheck });

    expect(preWriteCheck).toHaveBeenCalledWith(order);
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
    expect(client.calls.map(c => c.sql.trim())).toContain('ROLLBACK');
  });

  it('preWriteCheck ok:true → poursuit vers le contrôle de statut et l\'écriture', async () => {
    const order = baseOrder();
    const client = makeClient([{ rows: [order] }, { rows: [] }]);
    const preWriteCheck = jest.fn(() => ({ ok: true }));

    const result = await issueOrRotateQrToken({ client, orderId: 'order-1', preWriteCheck });

    expect(result.ok).toBe(true);
  });

  it('sans preWriteCheck fourni (ex. admin) → aucune vérification supplémentaire, poursuit normalement', async () => {
    const client = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    const result = await issueOrRotateQrToken({ client, orderId: 'order-1' });
    expect(result.ok).toBe(true);
  });
});

describe('issueOrRotateQrToken — garde de statut', () => {
  it('statut != available → ROLLBACK + 422 avec le statut courant', async () => {
    const client = makeClient([{ rows: [baseOrder({ status: 'shipped' })] }]);
    const result = await issueOrRotateQrToken({ client, orderId: 'order-1' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(422);
    expect(result.response.body.current_status).toBe('shipped');
    expect(client.calls.map(c => c.sql.trim())).toContain('ROLLBACK');
  });
});

describe('issueOrRotateQrToken — première émission (rotated:false)', () => {
  it('qr_token NULL avant écriture → rotated:false, token + expiration écrits atomiquement', async () => {
    const order = baseOrder({ qr_token: null });
    const client = makeClient([{ rows: [order] }, { rows: [] }]);

    const result = await issueOrRotateQrToken({ client, orderId: 'order-1', expirationHours: 48 });

    expect(result.ok).toBe(true);
    expect(result.rotated).toBe(false);
    expect(result.token).toMatch(/^[0-9a-f]{48}$/);

    const updateCall = client.calls.find(c => /UPDATE orders SET qr_token/i.test(c.sql));
    expect(updateCall.params[0]).toBe(result.token);
    expect(updateCall.params[2]).toBe('order-1');

    const expiresAt = updateCall.params[1];
    const deltaHours = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
    expect(deltaHours).toBeGreaterThan(47.9);
    expect(deltaHours).toBeLessThan(48.1);
  });
});

describe('issueOrRotateQrToken — rotation (rotated:true)', () => {
  it('qr_token déjà présent → rotated:true, ancien token remplacé par un nouveau', async () => {
    const order = baseOrder({ qr_token: 'ancien-token-existant' });
    const client = makeClient([{ rows: [order] }, { rows: [] }]);

    const result = await issueOrRotateQrToken({ client, orderId: 'order-1' });

    expect(result.ok).toBe(true);
    expect(result.rotated).toBe(true);
    expect(result.token).not.toBe('ancien-token-existant');

    const updateCall = client.calls.find(c => /UPDATE orders SET qr_token/i.test(c.sql));
    expect(updateCall.params[0]).toBe(result.token);
  });
});

describe('issueOrRotateQrToken — TOK-01 (entropie du token)', () => {
  it('génère un token CSPRNG différent à chaque appel (non déterministe)', async () => {
    const client1 = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    const r1 = await issueOrRotateQrToken({ client: client1, orderId: 'order-1' });

    const client2 = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    const r2 = await issueOrRotateQrToken({ client: client2, orderId: 'order-1' });

    expect(r1.token).not.toBe(r2.token);
  });

  it('le token ne dépend pas de QR_SECRET au runtime', async () => {
    const previousSecret = process.env.QR_SECRET;
    process.env.QR_SECRET = 'secret-A';
    const clientA = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    const rA = await issueOrRotateQrToken({ client: clientA, orderId: 'order-1' });

    process.env.QR_SECRET = 'secret-B-totalement-different';
    const clientB = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    const rB = await issueOrRotateQrToken({ client: clientB, orderId: 'order-1' });

    // Deux tokens indépendants de QR_SECRET : aucune corrélation déterministe
    // attendue entre eux au-delà du hasard cryptographique (longueur/format).
    expect(rA.token).toMatch(/^[0-9a-f]{48}$/);
    expect(rB.token).toMatch(/^[0-9a-f]{48}$/);
    expect(rA.token).not.toBe(rB.token);

    process.env.QR_SECRET = previousSecret;
  });
});

describe('issueOrRotateQrToken — expirationHours par défaut', () => {
  it('sans expirationHours fourni → 48h par défaut', async () => {
    const client = makeClient([{ rows: [baseOrder()] }, { rows: [] }]);
    const result = await issueOrRotateQrToken({ client, orderId: 'order-1' });

    const deltaHours = (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
    expect(deltaHours).toBeGreaterThan(47.9);
    expect(deltaHours).toBeLessThan(48.1);
  });
});
