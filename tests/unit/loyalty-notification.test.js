'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/loyalty-notification.test.js
 *
 * Tests du module services/notifications/loyalty.js — notifyLoyaltyEarned()
 *
 * NOTE — bug corrigé avant l'écriture de ces tests :
 * `firstName` était utilisé (ligne 33) mais jamais importé depuis './internals'
 * dans loyalty.js. Tout appel à notifyLoyaltyEarned() avec un téléphone non-vide
 * levait un ReferenceError non catché (hors du try/catch) — aucune notification
 * de fidélité n'a dû partir depuis le dernier refactor. Corrigé en ajoutant
 * `firstName` à la destructuration de require('./internals').
 *
 * Code mort supprimé (2026-07-04, doctrine "complétion au contact") :
 * le bloc `notifyText()` ("ZG-1 FIX") référençait `callAuthKeyText` et
 * `_alertNotificationFailure`, ni importés ni exportés par ce module, et
 * n'était lui-même pas exporté dans module.exports — code inatteignable et
 * cassé s'il l'avait été. Le vrai `notifyText` utilisé partout ailleurs vit
 * dans services/notifications/misc.js (testé séparément). Supprimé plutôt
 * que testé : tester du code mort et cassé n'aurait eu aucune valeur.
 *
 * Couverture :
 *   ✓ pas de téléphone → skip, pas d'appel provider
 *   ✓ succès : callAuthKey + logNotification 'sent' + log.info
 *   ✓ échec provider (result.ok=false) : logNotification 'failed' + log.warn
 *   ✓ exception (callAuthKey rejette) : log.error + logNotification 'failed' + pas de throw
 *   ✓ firstName appliqué correctement au nom (plusieurs mots / vide / undefined)
 */

const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();
const mockLogError = jest.fn();
const mockCallAuthKey = jest.fn();
const mockLogNotification = jest.fn();

jest.mock('../../services/notifications/internals', () => ({
  log: {
    warn: (...a) => mockLogWarn(...a),
    info: (...a) => mockLogInfo(...a),
    error: (...a) => mockLogError(...a),
  },
  callAuthKey: (...a) => mockCallAuthKey(...a),
  WID: 'wid-generic-test',
  logNotification: (...a) => mockLogNotification(...a),
  firstName: (fullName) => {
    if (!fullName) return 'Client';
    return String(fullName).trim().split(/\s+/)[0];
  },
}));

const { notifyLoyaltyEarned } = require('../../services/notifications/loyalty');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('notifyLoyaltyEarned — garde-fou téléphone', () => {
  it('skip et ne fait aucun appel provider si phone est absent', async () => {
    const result = await notifyLoyaltyEarned({
      userId: 'u1', userName: 'Jean Dupont', phone: null, orderRef: 'CMD-1', basketCount: 5,
    });

    expect(result).toEqual({ success: false, reason: 'no_phone' });
    expect(mockCallAuthKey).not.toHaveBeenCalled();
    expect(mockLogNotification).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', order_ref: 'CMD-1', basket_count: 5 }),
      expect.stringContaining('no phone')
    );
  });

  it("skip aussi si phone est une chaîne vide", async () => {
    const result = await notifyLoyaltyEarned({ userId: 'u1', userName: 'Jean', phone: '', basketCount: 3 });
    expect(result.success).toBe(false);
    expect(mockCallAuthKey).not.toHaveBeenCalled();
  });
});

describe('notifyLoyaltyEarned — succès', () => {
  it('appelle callAuthKey avec le WID générique et le message formaté, puis logNotification "sent"', async () => {
    mockCallAuthKey.mockResolvedValueOnce({ ok: true });
    mockLogNotification.mockResolvedValueOnce(undefined);

    const result = await notifyLoyaltyEarned({
      userId: 'u1', userName: 'Jean Dupont', phone: '+33699272526', orderRef: 'CMD-1', basketCount: 5,
    });

    expect(result).toEqual({ success: true });
    expect(mockCallAuthKey).toHaveBeenCalledWith(expect.objectContaining({
      wid: 'wid-generic-test',
      phone: '+33699272526',
      text: expect.stringContaining('Jean'),
    }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      orderRef: 'CMD-1',
      channel: 'whatsapp',
      event: 'loyalty_earned',
      recipient: '+33699272526',
      status: 'sent',
      detail: { basketCount: 5, userId: 'u1' },
    }));
    expect(mockLogInfo).toHaveBeenCalled();
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it('utilise firstName() pour extraire le prénom depuis un nom complet', async () => {
    mockCallAuthKey.mockResolvedValueOnce({ ok: true });

    await notifyLoyaltyEarned({ userId: 'u1', userName: 'Marie Claire Dubois', phone: '+33600000000', basketCount: 2 });

    expect(mockCallAuthKey).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Bravo Marie'),
    }));
  });

  it("utilise 'Client' en repli si userName est vide/undefined", async () => {
    mockCallAuthKey.mockResolvedValueOnce({ ok: true });

    await notifyLoyaltyEarned({ userId: 'u1', userName: undefined, phone: '+33600000000', basketCount: 2 });

    expect(mockCallAuthKey).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Bravo Client'),
    }));
  });
});

describe('notifyLoyaltyEarned — échec provider (result.ok=false)', () => {
  it('logNotification "failed" + log.warn, mais success=false sans exception', async () => {
    mockCallAuthKey.mockResolvedValueOnce({ ok: false, error: 'invalid_number' });

    const result = await notifyLoyaltyEarned({
      userId: 'u1', userName: 'Jean', phone: '+33699272526', orderRef: 'CMD-2', basketCount: 4,
    });

    expect(result).toEqual({ success: false });
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_number' }),
      expect.stringContaining('rejected by provider')
    );
    expect(mockLogInfo).not.toHaveBeenCalled();
  });
});

describe('notifyLoyaltyEarned — exception (callAuthKey rejette)', () => {
  it("catch l'exception, journalise en error, insère une row failed, et ne relance pas", async () => {
    mockCallAuthKey.mockRejectedValueOnce(new Error('provider down'));
    mockLogNotification.mockResolvedValueOnce(undefined);

    const result = await notifyLoyaltyEarned({
      userId: 'u1', userName: 'Jean', phone: '+33699272526', orderRef: 'CMD-3', basketCount: 6,
    });

    expect(result).toEqual({ success: false, error: 'provider down' });
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), phone: '+33699272526' }),
      expect.stringContaining('failed')
    );
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      detail: expect.objectContaining({ error: 'provider down' }),
    }));
  });
});
