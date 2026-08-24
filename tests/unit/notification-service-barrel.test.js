'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
describe('notification-service barrels', () => {
  it('services/notification-service re-exporte lAPI publique notification sans casser les appelants historiques', () => {
    const legacy = require('../../services/notification-service');
    const modern = require('../../services/notifications/notification-service');

    [
      'notifyOrderCreated',
      'notifyPaymentConfirmed',
      'notifyStatusChange',
      'notifyCancellation',
      'notifyParcelCreated',
      'notifyParcelScan',
      'sendOtpMessage',
      'sendMagicLink',
      'notifyText',
      'buildRelayMapUrl',
      'formatRelayPoint',
      'appendRelayLocation',
      'notifyLoyaltyEarned',
      '_loadOrderFromParcel',
    ].forEach((name) => {
      expect(typeof legacy[name]).toBe('function');
      expect(legacy[name]).toBe(modern[name]);
    });
  });
});
