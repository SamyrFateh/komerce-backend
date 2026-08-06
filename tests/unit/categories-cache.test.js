'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/categories-cache.test.js
 * Couvre utils/categories-cache.js
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

describe('categories-cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('getCategoriesVersion → retourne un number, version initiale = 1', () => {
    const { getCategoriesVersion } = require('../../utils/categories-cache');
    expect(typeof getCategoriesVersion()).toBe('number');
    expect(getCategoriesVersion()).toBe(1);
  });

  it('getCategoriesETag → format "v<version>-<timestamp>" entre guillemets', () => {
    const { getCategoriesETag } = require('../../utils/categories-cache');
    expect(getCategoriesETag()).toMatch(/^"v\d+-\d+"$/);
  });

  it('invalidateCategoriesCache → incremente la version', () => {
    const { getCategoriesVersion, invalidateCategoriesCache } = require('../../utils/categories-cache');
    const before = getCategoriesVersion();
    invalidateCategoriesCache();
    expect(getCategoriesVersion()).toBe(before + 1);
  });

  it('invalidateCategoriesCache → change aussi l\'ETag', () => {
    const { getCategoriesETag, invalidateCategoriesCache } = require('../../utils/categories-cache');
    const before = getCategoriesETag();
    invalidateCategoriesCache();
    expect(getCategoriesETag()).not.toBe(before);
  });

  it('onCategoriesInvalidate → callback declenche avec la nouvelle version', () => {
    const { onCategoriesInvalidate, invalidateCategoriesCache, getCategoriesVersion } = require('../../utils/categories-cache');
    const cb = jest.fn();
    onCategoriesInvalidate(cb);
    invalidateCategoriesCache();
    expect(cb).toHaveBeenCalledWith(getCategoriesVersion());
  });

  it('onCategoriesInvalidate avec non-fonction → ignore silencieusement', () => {
    const { onCategoriesInvalidate, invalidateCategoriesCache } = require('../../utils/categories-cache');
    expect(() => onCategoriesInvalidate('pas une fonction')).not.toThrow();
    expect(() => invalidateCategoriesCache()).not.toThrow();
  });

  it('callback qui leve une exception → catch interne, autres callbacks executes', () => {
    const { onCategoriesInvalidate, invalidateCategoriesCache } = require('../../utils/categories-cache');
    const broken = jest.fn(() => { throw new Error('boom'); });
    const healthy = jest.fn();
    onCategoriesInvalidate(broken);
    onCategoriesInvalidate(healthy);
    expect(() => invalidateCategoriesCache()).not.toThrow();
    expect(healthy).toHaveBeenCalled();
  });

  it('invalidations successives → version strictement croissante (idempotence de l\'ordre)', () => {
    const { getCategoriesVersion, invalidateCategoriesCache } = require('../../utils/categories-cache');
    const v1 = getCategoriesVersion();
    invalidateCategoriesCache();
    const v2 = getCategoriesVersion();
    invalidateCategoriesCache();
    const v3 = getCategoriesVersion();
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
  });
});
