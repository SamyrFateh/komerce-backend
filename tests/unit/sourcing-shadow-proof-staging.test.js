'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ pool: { end: jest.fn() } }));
jest.mock('../../services/sourcing-shadow-proof-service', () => ({ collectShadowProof: jest.fn() }));

const proof = require('../../services/sourcing-shadow-proof-service');
const { parseArgs, run } = require('../../scripts/sourcing-shadow-proof-staging');

describe('sourcing shadow proof staging runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('parse les flags sans mode write', () => {
    expect(parseArgs(['--require-ready', '--compact'])).toEqual({ requireReady: true, compact: true });
  });

  test('require-ready echoue si la preuve est insuffisante', async () => {
    proof.collectShadowProof.mockResolvedValue({
      verdict: { status: 'WARN', ready_for_product_projection_trial: false },
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await run(['--require-ready', '--compact']);
    expect(process.exitCode).toBe(3);
    log.mockRestore();
  });

  test('hard failure utilise un code distinct', async () => {
    proof.collectShadowProof.mockResolvedValue({
      verdict: { status: 'FAIL', ready_for_product_projection_trial: false },
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await run(['--compact']);
    expect(process.exitCode).toBe(2);
    log.mockRestore();
  });
});
