'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L5 : l’avis « politique de marché absente » est un bloc d’information stylé, sans variante bouton', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/pricing-economic-cockpit.css'), 'utf8');
  expect(css).toContain('.kmc-pricing-decision-overview .kmc-pricing-configuration-notice');
  expect(css).toContain('.kmc-pricing-configuration-title');
  expect(css).toContain('.kmc-pricing-configuration-copy');
  expect(css).not.toMatch(/kmc-pricing-configuration[^{]*\{[^}]*cursor:\s*pointer/);
});
