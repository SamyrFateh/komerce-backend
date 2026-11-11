/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'checkout-vertical-rail.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'b-checkout.js'), 'utf8');

describe('checkout-vertical-rail — ligne Livraison du total serveur', () => {
  it('la classe stylée existe et est celle posée par le checkout', () => {
    expect(css).toMatch(/\.ck-delivery-line\s*\{/);
    expect(css).toMatch(/\.ck-delivery-line\[hidden\]/);
    expect(js).toContain("deliveryLine.className = 'ck-delivery-line'");
  });
});
