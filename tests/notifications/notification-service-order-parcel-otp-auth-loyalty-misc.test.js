/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch
 * @role          notification-service-barrel-tests
 * @domain        notification
 * @layer         test
 * @criticality   medium
 * @inputs        notification public module
 * @outputs       jest assertions
 * @depends       services/notifications/notification-service.js
 * @used-by       feature-guard, jest
 * @doctrine      notification_non_bloquante, fallback_trace
 * @impact-areas  notifications, tests, governance
 * @version       2026-06
 */
'use strict';

jest.mock('../../services/notifications/order', () => ({
  notifyOrderCreated: jest.fn(),
  notifyPaymentConfirmed: jest.fn(),
  notifyStatusChange: jest.fn(),
  notifyCancellation: jest.fn(),
}));

jest.mock('../../services/notifications/parcel', () => ({
  _loadOrderFromParcel: jest.fn(),
  notifyParcelScan: jest.fn(),
  notifyParcelCreated: jest.fn(),
}));

jest.mock('../../services/notifications/otp-auth', () => ({
  sendOtpMessage: jest.fn(),
  sendMagicLink: jest.fn(),
}));

jest.mock('../../services/notifications/loyalty', () => ({
  notifyLoyaltyEarned: jest.fn(),
}));

jest.mock('../../services/notifications/misc', () => ({
  notifyText: jest.fn(),
  notifyInvoiceReady: jest.fn(),
}));

describe('notification service barrel', () => {
  test('preserves the public notification API after internal split', () => {
    const service = require('../../services/notifications/notification-service');

    expect(Object.keys(service).sort()).toEqual([
      '_loadOrderFromParcel',
      'notifyCancellation',
      'notifyInvoiceReady',
      'notifyLoyaltyEarned',
      'notifyOrderCreated',
      'notifyParcelCreated',
      'notifyParcelScan',
      'notifyPaymentConfirmed',
      'notifyStatusChange',
      'notifyText',
      'sendMagicLink',
      'sendOtpMessage',
    ].sort());
  });
});
