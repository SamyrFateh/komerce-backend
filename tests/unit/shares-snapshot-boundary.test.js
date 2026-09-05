'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'routes', 'shares.js'), 'utf8');

describe('/api/shares snapshot boundary', () => {
  test('publie explicitement un snapshot non transactionnel', () => {
    expect(source).toContain("const SHARE_KIND = 'snapshot'");
    expect(source).toContain('share_kind: SHARE_KIND');
    expect(source).toContain("snapshot_share_non_transactional");
  });

  test('reste séparé du lifecycle de liste partagée', () => {
    expect(source).toContain('/api/shared-carts');
    expect(source).not.toMatch(/INSERT INTO\s+shared_carts/i);
    expect(source).not.toMatch(/INSERT INTO\s+shared_cart_items/i);
  });

  test('refuse de lire un autre type de partage via la surface snapshot', () => {
    expect(source).toContain("share.type !== 'simple'");
    expect(source).toContain('snapshot_share_type_mismatch');
  });
});
