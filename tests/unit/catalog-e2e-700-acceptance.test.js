'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../scripts/aliexpress-incremental-e2e-200', () => ({
  WAVE_ID: 'incremental-e2e-200-v1',
  collectAcceptance: jest.fn(),
}));
jest.mock('../../scripts/catalog-refinery-final-acceptance', () => ({
  run: jest.fn(),
}));

const acceptance = require('../../scripts/catalog-e2e-700-acceptance');

describe('unified catalog E2E 700 acceptance', () => {
  test('pins the final clean dataset to 200 AliExpress + 500 CJ', () => {
    expect(acceptance.ALI_TARGET).toBe(200);
    expect(acceptance.CJ_TARGET).toBe(500);
    expect(acceptance.TOTAL_TARGET).toBe(700);
    expect(acceptance.CJ_CAMPAIGN).toBe('cj-balanced-e2e-500-v1');
  });

  test('output path is configurable but target is not', () => {
    const args = acceptance.parseArgs(['--output=artifacts/test-700.json']);
    expect(args.output).toMatch(/test-700\.json$/);
    expect(() => acceptance.parseArgs(['--expected=699'])).toThrow(/Argument inconnu/);
  });
});
