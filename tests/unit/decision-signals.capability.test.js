'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const capability = require('../../capabilities/decision-signals.capability');

test('decision-signals consomme Purchasing pour supplier_payment_review sans devenir propriétaire du paiement', () => {
  expect(capability.db.tables).toEqual(['signals: RW']);
  expect(capability.contract.consumes.some(item => /purchasing/i.test(item))).toBe(true);
  expect(capability.perimeter.in.some(item => /supplier_payment_review/.test(item))).toBe(true);
  expect(capability.invariants.some(item => /supplier_payment_review reste global/.test(item))).toBe(true);
});

test('le manifest conserve Action Center comme lifecycle de signaux uniquement', () => {
  expect(capability.perimeter.out.some(item => /aucune decision metier engageante/i.test(item))).toBe(true);
  expect(capability.contract.exposes).toContain('POST /api/admin/action-center/signals/:signalRef/resolve');
});
