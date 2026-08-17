'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { validateTransition, sourceStatusesFor, sqlGuard } = require('../../services/payment-status-validator');

describe('payment-status-validator', () => {
  test('refunded -> paid reste terminal', () => {
    expect(validateTransition('refunded', 'paid')).toEqual({ allowed: false, reason: 'blocked:refunded_to_paid' });
  });

  test('failed -> paid exige un événement de paiement identifiable', () => {
    expect(validateTransition('failed', 'paid').allowed).toBe(false);
    expect(validateTransition('failed', 'paid', { paymentEvent: { type: 'paypal.capture', externalId: 'cap-1' } }).allowed).toBe(true);
  });

  test('partially_paid ne peut jamais être écrit', () => {
    expect(validateTransition('pending', 'partially_paid')).toEqual({ allowed: false, reason: 'partially_paid_never_written' });
  });

  test('les sources SQL dérivent de la même matrice', () => {
    expect(sourceStatusesFor('refunded')).toEqual(['paid']);
    expect(sqlGuard(['paid'])).toBe("payment_status = 'paid'");
    expect(sqlGuard([])).toBe('FALSE');
  });
});
