'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('order_status canonical schema closure', () => {
  test('le réparateur legacy ne ressuscite plus pending_group_payment', () => {
    const source = read('scripts/fix-schema.js');
    expect(source).not.toMatch(/ADD VALUE\s+'pending_group_payment'/);
    expect(source).not.toContain("run('order_status enum pending_group_payment'");
    expect(source).toContain('ne doit jamais être ressuscité');
  });

  test('la migration 128 retire la valeur zombie et conserve le domaine canonique', () => {
    const migration = read('migrations/128_order_status_canonical_reclosure.sql');
    expect(migration).toContain("UPDATE orders SET status = 'pending' WHERE status = 'pending_group_payment'");
    expect(migration).toMatch(/CREATE TYPE order_status_new AS ENUM\s*\(\s*'pending', 'confirmed', 'ordered', 'preparation', 'shipped',\s*'in_transit', 'available', 'collected', 'cancelled', 'refunded'\s*\)/m);
    expect(migration).not.toMatch(/CREATE TYPE order_status_new AS ENUM[\s\S]*?'pending_group_payment'[\s\S]*?\);/m);
  });

  test('le runtime catalog garde seulement pending pour protéger les variantes en commande active', () => {
    const source = read('services/catalog-product-mutation-service.js');
    expect(source).toContain("AND o.status = 'pending'");
    expect(source).not.toMatch(/o\.status[^\n]*pending_group_payment/);
  });
});
