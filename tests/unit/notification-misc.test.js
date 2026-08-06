'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/notifications/internals', () => ({
  log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  callAuthKeyText: jest.fn(),
  WID: 'WID_DEFAULT',
  logNotification: jest.fn(() => Promise.resolve()),
  _alertNotificationFailure: jest.fn(),
}));

const internals = require('../../services/notifications/internals');
const { notifyText } = require('../../services/notifications/misc');

describe('notifications/misc notifyText', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skip sans phone ou message', async () => {
    await expect(notifyText('', 'msg', 'event', 'order-001')).resolves.toEqual({ ok: false, reason: 'no_phone_or_message' });
    await expect(notifyText('+269', '', 'event', 'order-001')).resolves.toEqual({ ok: false, reason: 'no_phone_or_message' });
    expect(internals.callAuthKeyText).not.toHaveBeenCalled();
  });

  it('envoie le texte et log en sent si AuthKey reussit', async () => {
    internals.callAuthKeyText.mockResolvedValueOnce({ ok: true, messageId: 'msg-001' });

    await expect(notifyText('+269000', 'Bonjour', 'reminder_h12', 'order-001')).resolves.toEqual({ ok: true, messageId: 'msg-001' });
    expect(internals.callAuthKeyText).toHaveBeenCalledWith({ mobile: '+269000', message: 'Bonjour' });
    expect(internals.logNotification).toHaveBeenCalledWith({
      orderRef: 'order-001',
      channel: 'whatsapp',
      event: 'reminder_h12',
      recipient: '+269000',
      status: 'sent',
      detail: { messageId: 'msg-001' },
    });
  });

  it('log en failed si AuthKey retourne ok=false', async () => {
    internals.callAuthKeyText.mockResolvedValueOnce({ ok: false, error: 'provider_down' });

    await expect(notifyText('+269000', 'Bonjour', 'reminder_h12', 'order-001')).resolves.toEqual({ ok: false, error: 'provider_down' });
    expect(internals.logNotification).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', detail: { error: 'provider_down' } }));
    expect(internals.log.warn).toHaveBeenCalled();
  });

  it('catch les exceptions provider et cree un signal notification_failure', async () => {
    internals.callAuthKeyText.mockRejectedValueOnce(new Error('network_down'));

    await expect(notifyText('+269000', 'Bonjour', 'reminder_h12', 'order-001')).resolves.toEqual({ ok: false, error: 'network_down' });
    expect(internals._alertNotificationFailure).toHaveBeenCalledWith({ event: 'reminder_h12', orderId: 'order-001', error: 'network_down' });
  });
});
