'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  OUTCOME_KEYS,
  reconcileCertificationBatch,
} = require('../../utils/certification-accounting');

describe('canonical certification batch accounting', () => {
  test('balances a fully explained mixed batch with UNACCOUNTED=0', () => {
    const out = reconcileCertificationBatch({
      input_total: 100,
      certified: 72,
      quarantined: 10,
      rejected: 8,
      duplicates: 5,
      archived: 5,
    });

    expect(out).toMatchObject({
      input_total: 100,
      terminal_total: 100,
      unaccounted: 0,
      overflow: 0,
      balanced: true,
    });
    expect(OUTCOME_KEYS).toContain('duplicates');
  });

  test('fails accounting when one input disappears silently', () => {
    const out = reconcileCertificationBatch({
      input_total: 10,
      certified: 8,
      rejected: 1,
    });
    expect(out).toMatchObject({
      terminal_total: 9,
      unaccounted: 1,
      overflow: 0,
      balanced: false,
    });
  });

  test('detects impossible double accounting as overflow', () => {
    const out = reconcileCertificationBatch({
      input_total: 10,
      certified: 9,
      rejected: 2,
    });
    expect(out).toMatchObject({
      terminal_total: 11,
      unaccounted: 0,
      overflow: 1,
      balanced: false,
    });
  });

  test.each([
    ['input_total', -1],
    ['certified', -1],
    ['rejected', 1.5],
  ])('rejects invalid count %s=%s', (key, value) => {
    expect(() => reconcileCertificationBatch({
      input_total: 1,
      [key]: value,
    })).toThrow(/CERTIFICATION_ACCOUNTING_INVALID/);
  });
});
