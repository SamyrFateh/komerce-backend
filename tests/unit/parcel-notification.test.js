'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-notification.test.js
 *
 * Tests du module services/notifications/parcel.js
 *
 * NOTE — bug corrigé avant l'écriture de ces tests :
 * notifyParcelScan() appelait notifyStatusChange(order, orderStatus) ligne 114,
 * mais cette fonction vit dans order.js et n'était ni importée ni requise ici.
 * Effet réel : CHAQUE scan de colis déclenchant un changement de statut
 * (in_transit/shipped/available) plantait avec un ReferenceError non catché
 * (pas de try/catch autour de cet appel) — notifications de suivi colis
 * totalement cassées en production.
 * Correctif : `const { notifyStatusChange } = require('./order');` ajouté.
 * Vérifié : pas de dépendance circulaire (order.js ne require pas parcel.js).
 *
 * NOTE — nettoyage effectué en parallèle (validé) :
 * `sendOtpMessage` (95 lignes) était définie dans ce fichier mais jamais
 * exportée ni appelée nulle part — un doublon orphelin de la vraie
 * implémentation utilisée en production, `otp-auth.js` (exportée via
 * notification-service.js, consommée par routes/otp.js). Supprimée avec ses
 * imports devenus inutiles (callAuthKey, callAuthKeyText, WID, firstName,
 * _alertNotificationFailure, pickRecipients — plus aucun usage dans ce
 * fichier après suppression).
 *
 * Couverture :
 *   _loadOrderFromParcel :
 *     ✓ renvoie la ligne trouvée
 *     ✓ renvoie null si aucune ligne
 *     ✓ catch une exception DB → log.error + renvoie null (pas de throw)
 *   notifyParcelScan :
 *     ✓ skip si parcelId ou parcelStatus manquant
 *     ✓ skip si le statut colis n'est pas mappé (statusMap)
 *     ✓ skip + log 'skipped' si order introuvable
 *     ✓ délègue à notifyStatusChange avec le statut order mappé (in_transit/shipped→shipped, available→delivered)
 *   notifyParcelCreated :
 *     ✓ skip si orderId manquant
 *     ✓ skip + log si order introuvable
 *     ✓ succès : log 'logged' avec pickPhone ou fallback 'system'
 *     ✓ exception (db.query rejette) → catch, log 'failed', pas de throw
 */

const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
const mockDbQuery = jest.fn();
const mockLogNotification = jest.fn();
const mockPickPhone = jest.fn();
const mockNotifyStatusChange = jest.fn();

jest.mock('../../services/notifications/internals', () => ({
  db: { query: (...a) => mockDbQuery(...a) },
  log: mockLog,
  logNotification: (...a) => mockLogNotification(...a),
  pickPhone: (...a) => mockPickPhone(...a),
}));

jest.mock('../../services/notifications/order', () => ({
  notifyStatusChange: (...a) => mockNotifyStatusChange(...a),
}));

const {
  _loadOrderFromParcel, notifyParcelScan, notifyParcelCreated,
} = require('../../services/notifications/parcel');

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════
describe('_loadOrderFromParcel', () => {
  it('renvoie la ligne trouvée', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', reference: 'CMD-1' }] });

    const result = await _loadOrderFromParcel('parcel-1');

    expect(result).toEqual({ id: 'order-1', reference: 'CMD-1' });
  });

  it('renvoie null si aucune ligne', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await _loadOrderFromParcel('parcel-1');

    expect(result).toBeNull();
  });

  it('catch une exception DB et renvoie null sans throw', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));

    const result = await _loadOrderFromParcel('parcel-1');

    expect(result).toBeNull();
    expect(mockLog.error).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('notifyParcelScan', () => {
  it('skip si parcelId manquant', async () => {
    await notifyParcelScan(null, 'REF-1', 'in_transit');
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('skip si parcelStatus manquant', async () => {
    await notifyParcelScan('parcel-1', 'REF-1', null);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('skip si le statut colis n\'est pas mappé (ex: "lost")', async () => {
    await notifyParcelScan('parcel-1', 'REF-1', 'lost');
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockNotifyStatusChange).not.toHaveBeenCalled();
  });

  it('skip et journalise "skipped" si order introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await notifyParcelScan('parcel-1', 'REF-1', 'in_transit');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      parcelRef: 'REF-1', status: 'skipped', detail: { reason: 'order_not_found', parcelId: 'parcel-1' },
    }));
    expect(mockNotifyStatusChange).not.toHaveBeenCalled();
  });

  it.each([
    ['in_transit', 'shipped'],
    ['shipped', 'shipped'],
    ['available', 'delivered'],
  ])('mappe parcelStatus=%s vers orderStatus=%s et délègue à notifyStatusChange', async (parcelStatus, orderStatus) => {
    const order = { id: 'order-1', reference: 'CMD-1' };
    mockDbQuery.mockResolvedValueOnce({ rows: [order] });
    mockNotifyStatusChange.mockResolvedValueOnce(undefined);

    await notifyParcelScan('parcel-1', 'REF-1', parcelStatus);

    expect(mockNotifyStatusChange).toHaveBeenCalledWith(order, orderStatus);
    expect(mockLog.info).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('notifyParcelCreated', () => {
  it('skip si orderId manquant', async () => {
    await notifyParcelCreated('P-1', null, 'CMD-1');
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('skip + log si order introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await notifyParcelCreated('P-1', 'order-1', 'CMD-1');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped', detail: { reason: 'order_not_found' },
    }));
  });

  it('succès : log "logged" avec le téléphone de pickPhone', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', reference: 'CMD-1' }] });
    mockPickPhone.mockReturnValueOnce('+269111');

    const result = await notifyParcelCreated('P-1', 'order-1', 'CMD-1');

    expect(result).toEqual({ success: true, logged_only: true });
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient: '+269111', status: 'logged',
    }));
  });

  it('utilise "system" comme recipient de repli si pickPhone renvoie null', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', reference: 'CMD-1' }] });
    mockPickPhone.mockReturnValueOnce(null);

    await notifyParcelCreated('P-1', 'order-1', 'CMD-1');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'system' }));
  });

  it('exception (db.query rejette) → catch, log "failed", pas de throw', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));

    await expect(notifyParcelCreated('P-1', 'order-1', 'CMD-1')).resolves.toBeUndefined();

    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', detail: { error: 'db down' } }));
  });
});
