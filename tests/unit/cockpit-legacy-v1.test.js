'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'cockpit-legacy-v1.css'), 'utf8');

test('cockpit-legacy-v1 reste une couche chargée uniquement par le shell index, après legacy-theme', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'index.html'), 'utf8');
  expect(index.indexOf('canonical-legacy-theme-v1.css')).toBeGreaterThan(-1);
  expect(index.indexOf('cockpit-legacy-v1.css')).toBeGreaterThan(index.indexOf('canonical-legacy-theme-v1.css'));
  expect(css.length).toBeGreaterThan(0);
});
