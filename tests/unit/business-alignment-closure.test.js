'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Business Alignment Closure — static runtime invariants.
 *
 * Ces assertions ne dupliquent pas les tests fonctionnels des domaines : elles
 * verrouillent les trois coutures métier corrigées par ce lot pour empêcher
 * leur réintroduction silencieuse lors d'un refactor.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Business Alignment Closure', () => {
  test('POST /api/orders exige un relais explicite avant le checkout', () => {
    const source = read('routes/orders/create.js');
    expect(source).toMatch(/fork\(\['relais_id'\],\s*schema\s*=>\s*schema\.required\(\)\)/);
    expect(source).toMatch(/validate\(orderCreateSchema\)/);
  });

  test('le garde variantes ne référence plus le statut retiré pending_group_payment', () => {
    const source = read('services/catalog-product-mutation-service.js');
    expect(source).toMatch(/o\.status\s*=\s*'pending'/);
    expect(source).not.toMatch(/pending_group_payment/);
  });

  test('parcel_blocked lit la référence colis canonique, pas tracking_number', () => {
    const source = read('services/signal-service.js');
    expect(source).toMatch(/p\.reference\s+AS\s+tracking_number/);
    expect(source).not.toMatch(/p\.tracking_number/);
  });
});
