'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));
jest.mock('../../services/authkey-client', () => ({
  notifyOrderCreated: jest.fn(),
  notifyPaymentConfirmed: jest.fn(),
  notifyOrderShipped: jest.fn(),
  notifyOrderDelivered: jest.fn(),
  notifyOrderCancelled: jest.fn(),
  callAuthKey: jest.fn(),
  callAuthKeyText: jest.fn(),
  WID: 'WID_DEFAULT',
}));

const mockNotificationOutcomeListener = jest.fn();

const db = require('../../db');
const internals = require('../../services/notifications/internals');

describe('notifications/internals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationOutcomeListener.mockReset().mockResolvedValue(undefined);
    internals.setNotificationOutcomeListener(mockNotificationOutcomeListener);
  });

  afterAll(() => internals.setNotificationOutcomeListener(null));

  it('firstName et formatAmount fournissent les fallbacks UI', () => {
    expect(internals.firstName()).toBe('Client');
    expect(internals.firstName('  Ali Ben  ')).toBe('Ali');
    expect(internals.formatAmount(null)).toBe('');
    expect(internals.formatAmount(1234567)).toMatch(/1.*234.*567/);
  });

  it('pickPhone garde la priorite historique tracking > recipient > payer > user > fallback', () => {
    expect(internals.pickPhone({ tracking_phone: '+1', recipient_phone: '+2', phone_payer: '+3', user_phone: '+4' }, '+5')).toBe('+1');
    expect(internals.pickPhone({ recipient_phone: '+2', phone_payer: '+3' }, '+5')).toBe('+2');
    expect(internals.pickPhone({ phone_payer: '+3' }, ['+5'])).toBe('+3');
    expect(internals.pickPhone({}, ['+5'])).toBe('+5');
  });

  it('pickPhone descend jusqu\'à user_phone, puis fallback non-tableau, puis null', () => {
    expect(internals.pickPhone({ user_phone: '+4' }, '+5')).toBe('+4');
    expect(internals.pickPhone({}, '+5')).toBe('+5');
    expect(internals.pickPhone({}, null)).toBeNull();
    expect(internals.pickPhone({}, [])).toBeNull(); // fallback[0] undefined sur tableau vide
  });

  it("pickRecipients renvoie le payeur comme unique destinataire, quel que soit l'événement (Lot 3 : plus de bénéficiaire distinct)", () => {
    const order = { tracking_phone: '+payer', recipient_phone: '+benef', user_phone: '+user' };

    expect(internals.pickRecipients(order, 'order_created')).toEqual([{ phone: '+payer', role: 'payer' }]);
    expect(internals.pickRecipients(order, 'payment_confirmed')).toEqual([{ phone: '+payer', role: 'payer' }]);
    expect(internals.pickRecipients(order, 'order_delivered')).toEqual([{ phone: '+payer', role: 'payer' }]);
    expect(internals.pickRecipients(order, 'order_collected')).toEqual([{ phone: '+payer', role: 'payer' }]);
  });

  it('pickRecipients retombe sur phone_payer et ignore recipient_phone', () => {
    expect(internals.pickRecipients({ phone_payer: '+payer', recipient_phone: '+benef' }, 'unknown_event')).toEqual([{ phone: '+payer', role: 'payer' }]);
  });

  it('logNotification insere un log avec detail stringifie', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await internals.logNotification({ orderRef: 'CMD-001', parcelRef: 'P-001', channel: 'whatsapp', event: 'paid', recipient: '+269', status: 'sent', detail: { ok: true } });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), [
      'CMD-001', 'P-001', 'whatsapp', 'paid', '+269', 'sent', JSON.stringify({ ok: true }),
    ]);
  });

  it('logNotification garde detail tel quel si déjà une chaîne (pas de double JSON.stringify)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await internals.logNotification({ channel: 'whatsapp', event: 'x', status: 'sent', detail: 'déjà une chaîne' });

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [
      null, null, 'whatsapp', 'x', 'system', 'sent', 'déjà une chaîne',
    ]);
  });

  it('logNotification met detail à null si non fourni, et recipient à "system" par défaut', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await internals.logNotification({ channel: 'whatsapp', event: 'x', status: 'skipped' });

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [
      null, null, 'whatsapp', 'x', 'system', 'skipped', null,
    ]);
  });

  it('logNotification ignore table absente et autres erreurs sans throw', async () => {
    db.query.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: '42P01' }));
    await expect(internals.logNotification({ channel: 'whatsapp', event: 'x', status: 'failed' })).resolves.toBeUndefined();

    db.query.mockRejectedValueOnce(new Error('db_down'));
    await expect(internals.logNotification({ channel: 'whatsapp', event: 'x', status: 'failed' })).resolves.toBeUndefined();
  });

  it('_alertNotificationFailure publie un fait neutre non bloquant', async () => {
    internals._alertNotificationFailure({
      event: 'paid',
      orderRef: 'CMD-001',
      orderId: 'order-001',
      error: new Error('boom'),
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNotificationOutcomeListener).toHaveBeenCalledWith({
      type: 'NotificationOutcomeRecorded',
      status: 'failed',
      event: 'paid',
      orderRef: 'CMD-001',
      orderId: 'order-001',
      error: 'Error: boom',
    });
  });

  it('_alertNotificationFailure normalise les références absentes à null', async () => {
    internals._alertNotificationFailure({ event: 'paid', error: 'boom' });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNotificationOutcomeListener).toHaveBeenCalledWith({
      type: 'NotificationOutcomeRecorded',
      status: 'failed',
      event: 'paid',
      orderRef: null,
      orderId: null,
      error: 'boom',
    });
  });

  it("_alertNotificationFailure n'interrompt pas le flux si le listener rejette", async () => {
    mockNotificationOutcomeListener.mockRejectedValueOnce(new Error('listener down'));

    expect(() => internals._alertNotificationFailure({
      event: 'paid',
      orderId: 'order-001',
      error: 'boom',
    })).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockNotificationOutcomeListener).toHaveBeenCalledTimes(1);
  });

  describe('notifyText', () => {
    const authkey = require('../../services/authkey-client');

    it('skip et renvoie ok:false si phone ou message manque', async () => {
      expect(await internals.notifyText(null, 'msg', 'evt')).toEqual({ ok: false, reason: 'no_phone_or_message' });
      expect(await internals.notifyText('+269', '', 'evt')).toEqual({ ok: false, reason: 'no_phone_or_message' });
      expect(authkey.callAuthKeyText).not.toHaveBeenCalled();
    });

    it('envoie via callAuthKeyText et logNotification "sent" en cas de succès', async () => {
      authkey.callAuthKeyText.mockResolvedValueOnce({ ok: true, messageId: 'msg-1' });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await internals.notifyText('+269321', 'Bonjour', 'invoice_ready', 'order-1');

      expect(result).toEqual({ ok: true, messageId: 'msg-1' });
      expect(authkey.callAuthKeyText).toHaveBeenCalledWith({ mobile: '+269321', message: 'Bonjour' });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), [
        'order-1', null, 'whatsapp', 'invoice_ready', '+269321', 'sent', JSON.stringify({ messageId: 'msg-1' }),
      ]);
    });

    it('utilise null pour orderRef si orderId non fourni', async () => {
      authkey.callAuthKeyText.mockResolvedValueOnce({ ok: true, messageId: 'msg-2' });
      db.query.mockResolvedValueOnce({ rows: [] });

      await internals.notifyText('+269321', 'Bonjour', 'evt');

      expect(db.query).toHaveBeenCalledWith(expect.any(String), [
        null, null, 'whatsapp', 'evt', '+269321', 'sent', JSON.stringify({ messageId: 'msg-2' }),
      ]);
    });

    it('logNotification "failed" + log.warn si result.ok=false, sans exception', async () => {
      authkey.callAuthKeyText.mockResolvedValueOnce({ ok: false, error: 'rejected_by_provider' });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await internals.notifyText('+269321', 'Bonjour', 'evt', 'order-2');

      expect(result).toEqual({ ok: false, error: 'rejected_by_provider' });
      expect(db.query).toHaveBeenCalledWith(expect.any(String), [
        'order-2', null, 'whatsapp', 'evt', '+269321', 'failed', JSON.stringify({ error: 'rejected_by_provider' }),
      ]);
    });

    it("catch l'exception, publie un fait neutre et renvoie ok:false sans relancer", async () => {
      authkey.callAuthKeyText.mockRejectedValueOnce(new Error('provider crash'));

      const result = await internals.notifyText('+269321', 'Bonjour', 'evt', 'order-3');
      await new Promise((resolve) => setImmediate(resolve));

      expect(result).toEqual({ ok: false, error: 'provider crash' });
      expect(mockNotificationOutcomeListener).toHaveBeenCalledWith({
        type: 'NotificationOutcomeRecorded',
        status: 'failed',
        event: 'evt',
        orderRef: null,
        orderId: 'order-3',
        error: 'provider crash',
      });
    });
  });
});
