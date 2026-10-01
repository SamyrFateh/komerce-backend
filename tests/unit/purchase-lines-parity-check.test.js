'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { CHECKS, runParityChecks, main } = require('../../scripts/purchase-lines-parity-check');

describe('purchase-lines-parity-check', () => {
  test('aucune divergence → ok', async () => {
    const q = jest.fn().mockResolvedValue({ rows: [] });
    const out = await runParityChecks(q);
    expect(out.ok).toBe(true);
    expect(q).toHaveBeenCalledTimes(CHECKS.length);
  });

  test('divergence → ko, ids tronqués à 20', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `po-${i}` }));
    const q = jest.fn().mockResolvedValueOnce({ rows }).mockResolvedValue({ rows: [] });
    const out = await runParityChecks(q);
    expect(out.ok).toBe(false);
    expect(out.report[0].ids).toHaveLength(20);
  });

  test('main : code retour 0 / 1 et rapport console', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main({ query: jest.fn().mockResolvedValue({ rows: [] }) })).toBe(0);
    expect(await main({ query: jest.fn().mockResolvedValue({ rows: [{ id: 'x' }] }) })).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toMatch(/KO .*ex: x/);
    log.mockRestore();
  });
});
