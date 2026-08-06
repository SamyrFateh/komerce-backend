'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pricing-cache.test.js
 * Couvre utils/pricing-cache.js
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

describe('pricing-cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('aucun callback enregistre → invalidate est un no-op propre, pas de crash', () => {
    const { invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    expect(() => invalidatePricingMatricesCache()).not.toThrow();
  });

  it('onInvalidate enregistre un callback declenche par invalidate', () => {
    const { onInvalidate, invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    const cb = jest.fn();
    onInvalidate(cb);
    invalidatePricingMatricesCache();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('plusieurs callbacks → tous declenches', () => {
    const { onInvalidate, invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    onInvalidate(cb1);
    onInvalidate(cb2);
    invalidatePricingMatricesCache();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('onInvalidate avec un argument non-fonction → ignore silencieusement', () => {
    const { onInvalidate, invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    expect(() => onInvalidate('pas une fonction')).not.toThrow();
    expect(() => onInvalidate(null)).not.toThrow();
    expect(() => invalidatePricingMatricesCache()).not.toThrow();
  });

  it('un callback qui leve une exception → catch interne, autres callbacks toujours executes', () => {
    const { onInvalidate, invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    const broken = jest.fn(() => { throw new Error('boom'); });
    const healthy = jest.fn();
    onInvalidate(broken);
    onInvalidate(healthy);
    expect(() => invalidatePricingMatricesCache()).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('invalidate multiple fois → callback rappele a chaque fois (pas de desabonnement auto)', () => {
    const { onInvalidate, invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    const cb = jest.fn();
    onInvalidate(cb);
    invalidatePricingMatricesCache();
    invalidatePricingMatricesCache();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('meme fonction enregistree deux fois (Set) → appelee une seule fois', () => {
    const { onInvalidate, invalidatePricingMatricesCache } = require('../../utils/pricing-cache');
    const cb = jest.fn();
    onInvalidate(cb);
    onInvalidate(cb);
    invalidatePricingMatricesCache();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
