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
    expect(css).toContain('.kmc-admin-reference-results');
    expect(css).toContain('.kmc-admin-reference-results[hidden]');
    expect(css).toContain('.kmc-admin-reference-result');
  });
});

test('shell-v4 ne porte plus le fond navy de la sidebar (surchargé par la couche Legacy)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/css/canonical-shell-v4.css'), 'utf8');
  expect(css).not.toMatch(/background:\s*#102143/);
});


test('sidebar verticale démarre en haut et isole le scroll dans la navigation centrale', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const primary = (css.match(/body\.kmc-shell-v4 \.kmc-admin-primary-nav\s*\{([\s\S]*?)\}/) || [])[1] || '';
  const identity = (css.match(/body\.kmc-shell-v4 \.kmc-admin-navigation-identity\s*\{([\s\S]*?)\}/) || [])[1] || '';
  const utility = (css.match(/body\.kmc-shell-v4 \.kmc-admin-utility-nav\s*\{([\s\S]*?)\}/) || [])[1] || '';

  expect(primary).toMatch(/flex-direction:\s*column/);
  expect(primary).toMatch(/justify-content:\s*flex-start/);
  expect(primary).toMatch(/overflow-y:\s*auto/);
  expect(primary).toMatch(/overflow-x:\s*hidden/);
  expect(identity).toMatch(/flex:\s*0 0 auto/);
  expect(utility).toMatch(/flex:\s*0 0 auto/);
});

const __css = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/css/canonical-shell-v4.css'),
  'utf8'
);

describe('canonical-shell-v4.css', () => {
  test('la navigation primaire garde son défilement vertical contenu', () => {
    const block = __css.match(/\.kmc-admin-primary-nav\s*\{[^}]*\}/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/overflow-y:\s*auto/);
    expect(block[0]).toMatch(/overscroll-behavior:\s*contain/);
  });

  test('ne déclare plus scrollbar-gutter sur la navigation (surchargé par le polish)', () => {
    const block = __css.match(/\.kmc-admin-primary-nav\s*\{[^}]*\}/);
    expect(block[0]).not.toMatch(/scrollbar-gutter/);
  });
});
