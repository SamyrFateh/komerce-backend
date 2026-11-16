'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { refusalMessage, isActionable } = require('../../public/dashboards/canonical/js/unsold-workspace');

describe('unsold-workspace (F3)', () => {
  test('409 scan affiche le refus F3 explicite', () => {
    const m = refusalMessage(409, { code: 'UNSOLD_NO_SHOW_NOT_CERTIFIED' });
    expect(m).toMatch(/409/);
    expect(m).toMatch(/colis payé/);
  });
  test('404 mentionne la commande payée', () => {
    expect(refusalMessage(404, {})).toMatch(/commande payée/);
  });
  test('aucune action sur commande payée ni invendu résolu', () => {
    expect(isActionable({ status: 'available' })).toBe(true);
    expect(isActionable({ status: 'available', payment_status: 'paid' })).toBe(false);
    expect(isActionable({ status: 'destroyed' })).toBe(false);
    expect(isActionable(null)).toBe(false);
  });
});
