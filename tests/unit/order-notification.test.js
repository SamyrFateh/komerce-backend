'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/order-notification.test.js
 *
 * Tests du module services/notifications/order.js
 *
 * NOTE — bug corrigé avant l'écriture de ces tests :
 * notifyPaymentConfirmed() appelait notifyText(phone, msg, 'invoice_ready', orderId)
 * ligne 151, mais `notifyText` n'était importée nulle part dans ce fichier (et
 * n'existait de toute façon pas de façon exportable ailleurs — cf. loyalty.js,
 * même bug de la même famille). Effet réel : à CHAQUE paiement confirmé, le
 * catch avalait un ReferenceError, journalisait un faux "génération de facture
 * impossible" (alors que la facture avait été générée avec succès juste avant),
 * et déclenchait une fausse alerte radar à chaque paiement. Le lien facture
 * n'était jamais envoyé par ce canal.
 * Correctif : `notifyText` a été centralisée dans internals.js (partagée,
 * exportée — cf. notification-internals.test.js) et importée ici.
 *
 * O7.2 (Cycle A, 2026-07) : le bloc "lien facture post-paiement" a été retiré
 * de notifyPaymentConfirmed() et déplacé vers services/invoice-service.js
 * (orders) — voir tests/unit/invoice-service.test.js pour sa couverture, et
 * docs/O7_2_CYCLE_ANALYSIS.md pour le rationale (cassait le cycle runtime
 * notifications<->orders). notifyPaymentConfirmed() n'envoie plus désormais
 * que la notification "paiement confirmé" — son périmètre d'origine.
 *
 * Couverture :
 *   notifyOrderCreated :
 *     ✓ envoie à chaque destinataire (payeur + bénéficiaire), log 'sent'
 *     ✓ fallback sur smsPhones (array ou string) si pickRecipients ne trouve rien
 *     ✓ skip + log 'skipped' si aucun destinataire ni fallback
 *     ✓ échec provider (result.ok=false) → log 'failed', pas de throw
 *     ✓ exception par destinataire catchée individuellement, n'interrompt pas la boucle
 *   notifyPaymentConfirmed :
 *     ✓ order introuvable en DB → skip silencieux
 *     ✓ pas de téléphone → log 'skipped'
 *     ✓ succès : notif paiement envoyée, aucun appel invoice-service (O7.2)
 *     ✓ exception globale (db.query rejette) → catch général, alerte radar
 *   notifyStatusChange :
 *     ✓ statut non mappé (paid, processing...) → no-op silencieux
 *     ✓ shipped/delivered/collected → relayPoint ajouté aux params
 *     ✓ aucun destinataire → log 'skipped'
 *     ✓ échec provider par destinataire → log 'failed'
 *     ✓ exception par destinataire catchée individuellement
 *   notifyCancellation :
 *     ✓ succès : appelle waOrderCancelled + log 'sent' avec refund info
 *     ✓ pas de téléphone → log 'skipped'
 *     ✓ échec provider → log 'failed'
 *     ✓ exception → log 'failed' + alerte radar
 *
 * Gap connu (non testé) : ligne 210, la condition
 * `newStatus === 'shipped' || 'delivered' || 'collected'` est structurellement
 * toujours vraie dans ce contexte — `entry` ne peut exister que si `newStatus`
 * est déjà l'une de ces trois clés du `mapping` (ligne 178-182). La branche
 * "false" est donc du code mort/redondant, inatteignable par construction.
 */

const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
const mockDbQuery = jest.fn();
const mockWaOrderCreated = jest.fn();
const mockWaPaymentConfirmed = jest.fn();
const mockWaOrderShipped = jest.fn();
const mockWaOrderDelivered = jest.fn();
const mockWaOrderCancelled = jest.fn();
const mockNotifyText = jest.fn();
const mockAlertNotificationFailure = jest.fn();
const mockLogNotification = jest.fn();
const mockFirstName = jest.fn((n) => (n ? String(n).split(' ')[0] : 'Client'));
const mockFormatAmount = jest.fn((n) => String(n));
const mockPickPhone = jest.fn();
const mockPickRecipients = jest.fn();

jest.mock('../../services/notifications/internals', () => ({
  db: { query: (...a) => mockDbQuery(...a) },
  log: mockLog,
  waOrderCreated: (...a) => mockWaOrderCreated(...a),
  waPaymentConfirmed: (...a) => mockWaPaymentConfirmed(...a),
  waOrderShipped: (...a) => mockWaOrderShipped(...a),
  waOrderDelivered: (...a) => mockWaOrderDelivered(...a),
  waOrderCancelled: (...a) => mockWaOrderCancelled(...a),
  callAuthKey: jest.fn(),
  callAuthKeyText: jest.fn(),
  notifyText: (...a) => mockNotifyText(...a),
  _alertNotificationFailure: (...a) => mockAlertNotificationFailure(...a),
  logNotification: (...a) => mockLogNotification(...a),
  firstName: (...a) => mockFirstName(...a),
  formatAmount: (...a) => mockFormatAmount(...a),
  pickPhone: (...a) => mockPickPhone(...a),
  pickRecipients: (...a) => mockPickRecipients(...a),
}));

const mockGetOrCreateInvoice = jest.fn();
jest.mock('../../services/notifications/invoice-service', () => ({
  getOrCreateInvoice: (...a) => mockGetOrCreateInvoice(...a),
}), { virtual: true });

const {
  notifyOrderCreated, notifyPaymentConfirmed, notifyStatusChange, notifyCancellation,
} = require('../../services/notifications/order');

beforeEach(() => {
  jest.clearAllMocks();
  mockFirstName.mockImplementation((n) => (n ? String(n).split(' ')[0] : 'Client'));
  mockFormatAmount.mockImplementation((n) => String(n));
});

// ═══════════════════════════════════════════════════════════════════════
describe('notifyOrderCreated', () => {
  const order = { reference: 'CMD-1', recipient_name: 'Jean Dupont', total_kmf: 50000 };

  it('envoie à chaque destinataire (payeur + bénéficiaire) et journalise "sent"', async () => {
    mockPickRecipients.mockReturnValueOnce([
      { phone: '+269111', role: 'payer' },
      { phone: '+269222', role: 'beneficiary' },
    ]);
    mockWaOrderCreated.mockResolvedValue({ ok: true, messageId: 'm1' });

    await notifyOrderCreated(order, null, null, null, null, null);

    expect(mockWaOrderCreated).toHaveBeenCalledTimes(2);
    expect(mockWaOrderCreated).toHaveBeenCalledWith(expect.objectContaining({ mobile: '+269111', orderRef: 'CMD-1' }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient: '+269111', status: 'sent', detail: { messageId: 'm1', role: 'payer' },
    }));
  });

  it('utilise smsPhones (array) en fallback si pickRecipients ne trouve rien', async () => {
    mockPickRecipients.mockReturnValueOnce([]);
    mockWaOrderCreated.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyOrderCreated(order, ['+269999', '+269888'], null, null, null, null);

    expect(mockWaOrderCreated).toHaveBeenCalledWith(expect.objectContaining({ mobile: '+269999' }));
  });

  it('utilise smsPhones (string) en fallback si pickRecipients ne trouve rien', async () => {
    mockPickRecipients.mockReturnValueOnce([]);
    mockWaOrderCreated.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyOrderCreated(order, '+269999', null, null, null, null);

    expect(mockWaOrderCreated).toHaveBeenCalledWith(expect.objectContaining({ mobile: '+269999' }));
  });

  it('skip et journalise "skipped" si aucun destinataire ni fallback', async () => {
    mockPickRecipients.mockReturnValueOnce([]);

    await notifyOrderCreated(order, null, null, null, null, null);

    expect(mockWaOrderCreated).not.toHaveBeenCalled();
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', detail: 'no_phone' }));
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('journalise "failed" (sans exception) si le provider répond ok:false', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderCreated.mockResolvedValueOnce({ ok: false, error: 'invalid_number' });

    await notifyOrderCreated(order, null, null, null, null, null);

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', detail: { error: 'invalid_number', role: 'payer' },
    }));
  });

  it('catch une exception par destinataire sans interrompre les autres', async () => {
    mockPickRecipients.mockReturnValueOnce([
      { phone: '+269111', role: 'payer' },
      { phone: '+269222', role: 'beneficiary' },
    ]);
    mockWaOrderCreated
      .mockRejectedValueOnce(new Error('provider crash'))
      .mockResolvedValueOnce({ ok: true, messageId: 'm2' });

    await notifyOrderCreated(order, null, null, null, null, null);

    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient: '+269111', status: 'failed', detail: { error: 'provider crash', role: 'payer' },
    }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient: '+269222', status: 'sent',
    }));
  });

  it("utilise user_full_name pour firstName() si recipient_name est absent", async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderCreated.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyOrderCreated({ reference: 'CMD-2', user_full_name: 'Marie Claire' }, null, null, null, null, null);

    expect(mockFirstName).toHaveBeenCalledWith('Marie Claire');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('notifyPaymentConfirmed', () => {
  const orderRow = {
    id: 'order-1', reference: 'CMD-1', tracking_phone: '+269111',
    user_full_name: 'Jean Dupont', payment_mode: 'stripe_eur',
  };

  it('skip silencieusement si order introuvable en DB', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await notifyPaymentConfirmed('order-1', 'CMD-1');

    expect(mockLog.warn).toHaveBeenCalled();
    expect(mockWaPaymentConfirmed).not.toHaveBeenCalled();
  });

  it('journalise "skipped" si pickPhone ne trouve aucun téléphone', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [orderRow] });
    mockPickPhone.mockReturnValueOnce(null);

    await notifyPaymentConfirmed('order-1', 'CMD-1');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', detail: 'no_phone' }));
    expect(mockWaPaymentConfirmed).not.toHaveBeenCalled();
  });

  it('journalise "failed" (sans throw) si waPaymentConfirmed répond ok:false', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [orderRow] });
    mockPickPhone.mockReturnValueOnce('+269111');
    mockWaPaymentConfirmed.mockResolvedValueOnce({ ok: false, error: 'invalid_number' });

    await notifyPaymentConfirmed('order-1', 'CMD-1');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      event: 'payment_confirmed', status: 'failed', detail: { error: 'invalid_number' },
    }));
  });

  it('succès complet : notif paiement envoyée et journalisée "sent"', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [orderRow] });
    mockPickPhone.mockReturnValueOnce('+269111');
    mockWaPaymentConfirmed.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyPaymentConfirmed('order-1', 'CMD-1');

    expect(mockWaPaymentConfirmed).toHaveBeenCalledWith(expect.objectContaining({ mobile: '+269111', orderRef: 'CMD-1' }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment_confirmed', status: 'sent' }));
    expect(mockAlertNotificationFailure).not.toHaveBeenCalled();
    // O7.2 (Cycle A) : le lien facture n'est plus construit/envoyé ici — voir
    // tests/unit/invoice-service.test.js (services/invoice-service.js, orders).
    expect(mockNotifyText).not.toHaveBeenCalled();
    expect(mockGetOrCreateInvoice).not.toHaveBeenCalled();
  });

  it('exception globale (db.query rejette) → catch général, alerte radar, ne relance pas', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connexion refusée'));

    await expect(notifyPaymentConfirmed('order-1', 'CMD-1')).resolves.toBeUndefined();

    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.stringContaining('failed'));
    expect(mockAlertNotificationFailure).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment_confirmed' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('notifyStatusChange', () => {
  const order = { reference: 'CMD-1', recipient_name: 'Jean Dupont', relais_name: 'Relais Moroni' };

  it('no-op silencieux pour un statut non mappé (ex: "paid")', async () => {
    await notifyStatusChange(order, 'paid');
    expect(mockLogNotification).not.toHaveBeenCalled();
    expect(mockWaOrderShipped).not.toHaveBeenCalled();
  });

  it('ajoute relayPoint aux params pour "shipped"', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderShipped.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyStatusChange(order, 'shipped');

    expect(mockWaOrderShipped).toHaveBeenCalledWith(expect.objectContaining({ relayPoint: 'Relais Moroni' }));
  });

  it('utilise "votre point relais" si relais_name absent', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderDelivered.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyStatusChange({ reference: 'CMD-1' }, 'delivered');

    expect(mockWaOrderDelivered).toHaveBeenCalledWith(expect.objectContaining({ relayPoint: 'votre point relais' }));
  });

  it('"collected" utilise le même template (waOrderDelivered) que "delivered"', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'beneficiary' }]);
    mockWaOrderDelivered.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyStatusChange(order, 'collected');

    expect(mockWaOrderDelivered).toHaveBeenCalledWith(expect.objectContaining({ orderRef: 'CMD-1' }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'order_collected' }));
  });

  it('journalise "skipped" si aucun destinataire', async () => {
    mockPickRecipients.mockReturnValueOnce([]);

    await notifyStatusChange(order, 'shipped');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', detail: 'no_phone' }));
    expect(mockWaOrderShipped).not.toHaveBeenCalled();
  });

  it('journalise "failed" si le provider répond ok:false', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderShipped.mockResolvedValueOnce({ ok: false, error: 'invalid' });

    await notifyStatusChange(order, 'shipped');

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', detail: { error: 'invalid', role: 'payer' } }));
  });

  it('catch une exception par destinataire sans interrompre les autres', async () => {
    mockPickRecipients.mockReturnValueOnce([
      { phone: '+269111', role: 'payer' },
      { phone: '+269222', role: 'beneficiary' },
    ]);
    mockWaOrderShipped
      .mockRejectedValueOnce(new Error('crash'))
      .mockResolvedValueOnce({ ok: true, messageId: 'm2' });

    await notifyStatusChange(order, 'shipped');

    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ recipient: '+269111', status: 'failed' }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ recipient: '+269222', status: 'sent' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('notifyCancellation', () => {
  const order = { reference: 'CMD-1', recipient_name: 'Jean Dupont' };

  it('succès : appelle waOrderCancelled et journalise "sent" avec refund info', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderCancelled.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyCancellation(order, { amount: 5000 });

    expect(mockWaOrderCancelled).toHaveBeenCalledWith(expect.objectContaining({ mobile: '+269111', orderRef: 'CMD-1' }));
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent', detail: { messageId: 'm1', refund: { amount: 5000 } },
    }));
  });

  it('journalise "skipped" si aucun destinataire (recipients[0]?.phone undefined)', async () => {
    mockPickRecipients.mockReturnValueOnce([]);

    await notifyCancellation(order, null);

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', detail: 'no_phone' }));
    expect(mockWaOrderCancelled).not.toHaveBeenCalled();
  });

  it('journalise "failed" si le provider répond ok:false', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderCancelled.mockResolvedValueOnce({ ok: false, error: 'invalid' });

    await notifyCancellation(order, null);

    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', detail: { error: 'invalid' } }));
  });

  it('exception → journalise "failed" (detail=message brut) + alerte radar', async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderCancelled.mockRejectedValueOnce(new Error('provider crash'));

    await notifyCancellation(order, null);

    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLogNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', detail: 'provider crash' }));
    expect(mockAlertNotificationFailure).toHaveBeenCalledWith(expect.objectContaining({ event: 'order_cancelled' }));
  });

  it("utilise user_full_name pour firstName() si recipient_name est absent", async () => {
    mockPickRecipients.mockReturnValueOnce([{ phone: '+269111', role: 'payer' }]);
    mockWaOrderCancelled.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    await notifyCancellation({ reference: 'CMD-2', user_full_name: 'Marie Claire' }, null);

    expect(mockFirstName).toHaveBeenCalledWith('Marie Claire');
  });
});
