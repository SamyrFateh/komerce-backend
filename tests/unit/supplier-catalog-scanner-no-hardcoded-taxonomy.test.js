'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

describe('supplier catalog scanner taxonomy stays dynamic', () => {
  test('scanner contains no business category key list or discovery path map', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../services/supplier-catalog-scanner.js'),
      'utf8'
    );

    expect(source).not.toContain('DISCOVERY_PATH_CATEGORY_KEYS');
    expect(source).not.toContain('DISCOVERY_SEGMENT_CATEGORY_KEYS');
    expect(source).not.toMatch(/catKeys\s*:/);
    expect(source).not.toMatch(/phones:\s*0\./);
    expect(source).not.toMatch(/vetements:\s*0\./);
    expect(source).not.toMatch(/cosmetiques:\s*0\./);
  });
});
