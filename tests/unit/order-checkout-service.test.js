/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '../../services/order-checkout-service.js'), 'utf8');

describe('garde acheteur de recette G6 (staging uniquement)', () => {
  test('multi-lignes et multi-unités ; cash relais et mobile money simulé ; PSP et wallet refusés', () => {
    expect(s).toContain("['cash_relais','mobile_money'].includes(payment_mode)");
    expect(s).toContain('use_wallet||');
    expect(s).toContain('stripe_payment_intent||');
    expect(s).not.toContain('items.length!==1');
    expect(s).not.toContain('Number(items[0]?.quantity)!==1');
  });
  test('production fail-closed : le marquage ne s\'active que sur staging', () => {
    const g = fs.readFileSync(path.join(__dirname, '../../services/g6-staging-buyer-identity-guard.js'), 'utf8');
    expect(g).toContain('if(!isStaging(env)||!isG6BuyerName(user))return false');
  });
});
