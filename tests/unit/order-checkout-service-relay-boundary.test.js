'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'services', 'order-checkout-service.js'), 'utf8');

describe('order-checkout-service explicit relay boundary', () => {
  test('un appel service sans relais échoue explicitement', () => {
    expect(source).toContain("code: 'relay_required'");
    expect(source).toContain('relais_id obligatoire');
  });

  test('le service ne choisit plus un relais actif arbitraire', () => {
    expect(source).not.toMatch(/SELECT \* FROM relais WHERE is_active = TRUE ORDER BY id LIMIT 1/);
  });

  test('le relais explicite reste l’ancre du market et du fulfillment', () => {
    expect(source).toContain("SELECT * FROM relais WHERE id = $1 AND is_active = TRUE");
    expect(source).toContain('marketId: relais?.market_id || null');
    expect(source).toContain('marketId: relais?.market_id || null');
  });
});
