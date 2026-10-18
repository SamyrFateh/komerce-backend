'use strict';

/**
 * Regression: production application routes must never expose synthetic
 * Golden test helpers as HTTP mutations. Tests can use the helpers directly
 * on isolated test databases, but the deployed route must remain read-only.
 */
const fs = require('fs');
const path = require('path');

describe('admin-order-360 Golden mutation boundary', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../routes/admin-order-360.js'),
    'utf8'
  );

  test('does not import synthetic Golden journey test helpers', () => {
    expect(source).not.toMatch(/require\(['"]\.\.\/tests\/helpers\/goldenJourney(?:Setup)?['"]\)/);
  });

  test('does not expose Golden create or advance POST routes', () => {
    expect(source).not.toMatch(/['"]\/golden-create['"]/);
    expect(source).not.toMatch(/['"]\/orders\/:orderReference\/golden-advance['"]/);
  });

  test('preserves read-only Golden evidence routes', () => {
    expect(source).toMatch(/['"]\/golden-upstream['"]/);
    expect(source).toMatch(/['"]\/orders\/:orderReference\/golden-evidence['"]/);
  });
});
