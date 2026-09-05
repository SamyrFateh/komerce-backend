'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  FINDINGS,
  REASON_CODES,
  PROMOTION_STATUSES,
  STATUS_PRIORITY,
  finding,
  WEIGHT_CONVERSIONS_TO_KG,
} = require('../../services/suppliers/pipeline-constants');

describe('pipeline-constants', () => {
  test('les référentiels de décision sont immuables et cohérents', () => {
    expect(Object.isFrozen(FINDINGS)).toBe(true);
    expect(Object.isFrozen(REASON_CODES)).toBe(true);
    expect(Object.isFrozen(STATUS_PRIORITY)).toBe(true);
    expect(PROMOTION_STATUSES).toContain('READY_FOR_PROMOTION');
    expect(STATUS_PRIORITY.REJECTED_SOURCE_DATA_INVALID)
      .toBeLessThan(STATUS_PRIORITY.READY_FOR_PROMOTION);
  });

  test('finding conserve code, détail et contexte additionnel', () => {
    expect(finding('CODE', 'detail', { source_index: 3 })).toEqual({
      code: 'CODE',
      detail: 'detail',
      source_index: 3,
    });
  });

  test('les conversions de poids ont le kg pour unité canonique', () => {
    expect(WEIGHT_CONVERSIONS_TO_KG.kg).toBe(1);
    expect(WEIGHT_CONVERSIONS_TO_KG.g).toBe(0.001);
    expect(WEIGHT_CONVERSIONS_TO_KG.lb).toBeCloseTo(0.45359237);
  });
});
