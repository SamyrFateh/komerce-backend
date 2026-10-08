/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TOKENS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'tokens.css'), 'utf8');

describe('tokens.css', () => {
  test('définit les 4 états et UNKNOWN est un gris distinct du vert', () => {
    const value = name => (TOKENS.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
    for (const state of ['green', 'orange', 'red', 'unknown']) {
      expect(value(`--health-${state}-fg`)).toBeTruthy();
      expect(value(`--health-${state}-bg`)).toBeTruthy();
    }
    expect(value('--health-unknown-fg')).not.toBe(value('--health-green-fg'));
    expect(value('--health-unknown-bg')).not.toBe(value('--health-green-bg'));
  });
  test('tokens.css est chargé par les 4 shells', () => {
    for (const shell of ['index', 'access', 'market-autonomy', 'market-catalog']) {
      const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', `${shell}.html`), 'utf8');
      expect(html).toContain('/dashboards/canonical/css/tokens.css');
    }
  });
});
