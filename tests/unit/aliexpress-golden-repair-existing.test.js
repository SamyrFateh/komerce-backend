/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const repair = require('../../scripts/aliexpress-golden-repair-existing');

describe('AliExpress Golden existing repair CLI', () => {
  test('defaults to execute and supports explicit dry-run', () => {
    expect(repair.parseMode([])).toBe('execute');
    expect(repair.parseMode(['--dry-run'])).toBe('dry-run');
  });

  test('requires an exact AliExpress supplier product id', () => {
    expect(repair.parseSupplierProductId(['--supplier-product-id=1005008089329682']))
      .toBe('1005008089329682');
    expect(() => repair.parseSupplierProductId([])).toThrow(/supplier-product-id/);
  });
});
