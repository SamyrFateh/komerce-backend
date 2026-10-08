'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js');
const source = fs.readFileSync(path.join(JS_DIR, 'navigation-policy-v4.js'), 'utf8');

test('une seule source de navigation Canonical existe (plus de couche V2.1/V3)', () => {
  expect(fs.existsSync(path.join(JS_DIR, 'navigation.js'))).toBe(false);
  expect(fs.existsSync(path.join(JS_DIR, 'navigation-policy-v3.js'))).toBe(false);
  // Un seul module assigne l'API globale de navigation, une seule fois.
  const owners = fs.readdirSync(JS_DIR).filter(file => file.endsWith('.js')
    && fs.readFileSync(path.join(JS_DIR, file), 'utf8').includes('global.KomerceCanonicalNavigation = '));
  expect(owners).toEqual(['navigation-policy-v4.js']);
  expect((source.match(/global\.KomerceCanonicalNavigation = /g) || [])).toHaveLength(1);
  // Une seule table de domaines N1 et un seul rendu de sidebar groupée.
  expect((source.match(/const DOMAINS = /g) || [])).toHaveLength(1);
  expect((source.match(/const SIDEBAR_GROUPS = /g) || [])).toHaveLength(1);
});

test('la navigation ne porte pas de taxonomie admin parallèle', () => {
  expect(source).not.toContain('ADMIN_CAPABILITY_GROUPS');
  expect(source).not.toContain('createAdminCapabilityGroup');
  expect(source).toContain('visibleDomains.forEach');
});

test('la navigation ne dépend plus d\'une couche de base', () => {
  expect(source).not.toMatch(/const base = global\.KomerceCanonicalNavigation/);
  expect(source).not.toMatch(/\.\.\.base\b/);
});
