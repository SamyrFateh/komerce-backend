'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/hub-live.js'), 'utf8');

test('Hub live : chaque référence de commande porte un lien 360 direct avec retour vers la vue courante', () => {
  expect(src).toContain('const { order360Link,');
  expect(src).toContain("order360Link(order.reference, 'Retour au Hub live')");
  // La liaison reste interne au cockpit (data-cockpit-nav) : le lien 360 s'y ajoute sans le remplacer.
  expect(src).toContain('data-cockpit-nav>${esc(order.reference)}</a>');
});
