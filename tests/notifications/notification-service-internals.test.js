/**
 * @komerce-arch
 * @role          notification-internals-tests
 * @domain        notification
 * @layer         test
 * @criticality   medium
 * @inputs        notification helper fixtures
 * @outputs       jest assertions
 * @depends       services/notifications/internals.js
 * @used-by       feature-guard, jest
 * @doctrine      notification_non_bloquante, fallback_trace
 * @impact-areas  notifications, tests, governance
 * @version       2026-06
 */
'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  })),
}));

jest.mock('../../services/authkey-client', () => ({
  notifyOrderCreated: jest.fn(),
  notifyPaymentConfirmed: jest.fn(),
  notifyOrderShipped: jest.fn(),
  notifyOrderDelivered: jest.fn(),
  notifyOrderCancelled: jest.fn(),
  callAuthKey: jest.fn(),
  callAuthKeyText: jest.fn(),
  WID: {},
}));

const db = require('../../db');
const internals = require('../../services/notifications/internals');

function normalizeSpaces(value) {
  return String(value).replace(/\s/g, ' ');
}

describe('notification internals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('formats customer-facing helper values predictably', () => {
    expect(internals.firstName(' Samyr Fateh ')).toBe('Samyr');
    expect(internals.firstName('')).toBe('Client');
    expect(normalizeSpaces(internals.formatAmount(1234567))).toBe('1 234 567');
    expect(internals.formatAmount(null)).toBe('');
  });

  test('selects the payer as sole recipient, regardless of event (Lot 3 : no more distinct beneficiary)', () => {
    const order = {
      tracking_phone: '+33600000001',
      recipient_phone: '+26900000002',
      user_phone: '+33600000003',
    };

    expect(internals.pickRecipients(order, 'order_created')).toEqual([
      { phone: '+33600000001', role: 'payer' },
    ]);
    expect(internals.pickRecipients(order, 'payment_confirmed')).toEqual([
      { phone: '+33600000001', role: 'payer' },
    ]);
    expect(internals.pickRecipients(order, 'order_delivered')).toEqual([
      { phone: '+33600000001', role: 'payer' },
    ]);
  });

  test('falls back to phone_payer and ignores recipient_phone', () => {
    expect(internals.pickRecipients({
      phone_payer: '+26900000002',
      recipient_phone: '+26900000009',
    }, 'order_shipped')).toEqual([
      { phone: '+26900000002', role: 'payer' },
    ]);
  });

  test('notification logging is non-blocking when the table is not deployed yet', async () => {
    db.query.mockRejectedValueOnce({ code: '42P01' });

    await expect(internals.logNotification({
      orderRef: 'KOM-1',
      channel: 'whatsapp',
      event: 'payment_confirmed',
      recipient: '+33600000001',
      status: 'sent',
      detail: { ok: true },
    })).resolves.toBeUndefined();
  });
});
