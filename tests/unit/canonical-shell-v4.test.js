'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Preuve structurelle du shell V4 : la hiérarchie de groupes de navigation
 * doit rester compacte et n'altère pas les primitives de lien existantes.
 */

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(
  __dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'canonical-shell-v4.css'
);

describe('canonical-shell-v4 grouped sidebar', () => {
  test('styles the six-group hierarchy without replacing the primary link primitive', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toContain('.kmc-admin-sidebar-group');
    expect(css).toContain('.kmc-admin-sidebar-group-label');
    expect(css).toContain('body.kmc-shell-v4 .kmc-admin-primary-link');
    expect(css).toContain('text-transform: uppercase');
  });
});
