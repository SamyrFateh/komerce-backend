'use strict';

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
jest.mock('../../services/notifications/signal-service', () => ({ upsertSignal: jest.fn(() => Promise.resolve()) }));

const db = require('../../db');
const signalService = require('../../services/notifications/signal-service');
const internals = require('../../services/notifications/internals');

describe('notifications/internals', () => {
  beforeEach(() => jest.clearAllMocks());

  it('firstName et formatAmount fournissent les fallbacks UI', () => {
    expect(internals.firstName()).toBe('Client');
    expect(internals.firstName('  Ali Ben  ')).toBe('Ali');
    expect(internals.formatAmount(null)).toBe('');
    expect(internals.formatAmount(1234567)).toBe('1 234 567');
  });

  it('pickPhone garde la priorite historique tracking > recipient > payer > user > fallback', () => {
    expect(internals.pickPhone({ tracking_phone: '+1', recipient_phone: '+2', phone_payer: '+3', user_phone: '+4' }, '+5')).toBe('+1');
    expect(internals.pickPhone({ recipient_phone: '+2', phone_payer: '+3' }, '+5')).toBe('+2');
    expect(internals.pickPhone({ phone_payer: '+3' }, ['+5'])).toBe('+3');
    expect(internals.pickPhone({}, ['+5'])).toBe('+5');
  });

  it('pickRecipients dedoublonne payeur et beneficiaire selon levenement', () => {
    const order = { tracking_phone: '+payer', recipient_phone: '+benef', user_phone: '+user' };

    expect(internals.pickRecipients(order, 'order_created')).toEqual([
      { phone: '+payer', role: 'payer' },
      { phone: '+benef', role: 'beneficiary' },
    ]);
    expect(internals.pickRecipients(order, 'payment_confirmed')).toEqual([{ phone: '+payer', role: 'payer' }]);
    expect(internals.pickRecipients(order, 'order_delivered')).toEqual([{ phone: '+benef', role: 'beneficiary' }]);
    expect(internals.pickRecipients({ tracking_phone: '+same', recipient_phone: '+same' }, 'order_shipped')).toEqual([{ phone: '+same', role: 'payer' }]);
  });

  it('pickRecipients fallback beneficiaire/payeur selon cas', () => {
    expect(internals.pickRecipients({ recipient_phone: '+benef' }, 'payment_confirmed')).toEqual([{ phone: '+benef', role: 'beneficiary' }]);
    expect(internals.pickRecipients({ tracking_phone: '+payer' }, 'order_delivered')).toEqual([{ phone: '+payer', role: 'payer' }]);
    expect(internals.pickRecipients({ phone_payer: '+payer' }, 'unknown_event')).toEqual([{ phone: '+payer', role: 'payer' }]);
  });

  it('logNotification insere un log avec detail stringifie', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await internals.logNotification({ orderRef: 'CMD-001', parcelRef: 'P-001', channel: 'whatsapp', event: 'paid', recipient: '+269', status: 'sent', detail: { ok: true } });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), [
      'CMD-001', 'P-001', 'whatsapp', 'paid', '+269', 'sent', JSON.stringify({ ok: true }),
    ]);
  });

  it('logNotification ignore table absente et autres erreurs sans throw', async () => {
    db.query.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: '42P01' }));
    await expect(internals.logNotification({ channel: 'whatsapp', event: 'x', status: 'failed' })).resolves.toBeUndefined();

    db.query.mockRejectedValueOnce(new Error('db_down'));
    await expect(internals.logNotification({ channel: 'whatsapp', event: 'x', status: 'failed' })).resolves.toBeUndefined();
  });

  it('_alertNotificationFailure cree un signal non bloquant', () => {
    internals._alertNotificationFailure({ event: 'paid', orderRef: 'CMD-001', orderId: 'order-001', error: new Error('boom') });

    expect(signalService.upsertSignal).toHaveBeenCalledWith(expect.objectContaining({
      signal_type: 'notification_failure', severity: 'warning', entity_id: 'order-001', target_filters: { order_id: 'order-001' },
      meta: expect.objectContaining({ event: 'paid', orderRef: 'CMD-001', orderId: 'order-001' }),
    }));
  });
});
