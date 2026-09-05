'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'services', 'customs-shipment-service.js'), 'utf8');

function createShipmentSource() {
  const start = source.indexOf('async function createShipment');
  const end = source.indexOf('/**\n * Met à jour les métadonnées', start);
  return source.slice(start, end);
}

describe('customs shipment market atomicity', () => {
  test('marketId vient des options service de confiance, jamais du body', () => {
    const create = createShipmentSource();
    expect(create).toContain('async function createShipment(db, body, userId, options = {})');
    expect(create).toContain('const marketId = options.marketId || null');
    expect(create).not.toMatch(/body\.(market_id|marketId)/);
  });

  test('market_id est écrit dans l INSERT initial avant le COMMIT', () => {
    const create = createShipmentSource();
    expect(create).toMatch(/created_by,\s*market_id, status\)/);
    expect(create).toContain("$14,$15,'pending'");
    expect(create).toMatch(/userId, marketId/);
    expect(create.indexOf('market_id, status')).toBeLessThan(create.indexOf("client.query('COMMIT')"));
  });

  test('le service retourne l état final de la même transaction', () => {
    const create = createShipmentSource();
    expect(create).toContain('SELECT * FROM customs_shipments WHERE id = $1');
    expect(create).toContain('return { shipment: finalShipment || shipment, allocations }');
  });
});
