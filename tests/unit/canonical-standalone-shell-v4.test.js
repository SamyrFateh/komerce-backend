'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOTSTRAP = 'public/dashboards/canonical/js/standalone-shell-bootstrap-v4.js';
const HTML_SURFACES = [
  'public/dashboards/canonical/access.html',
  'public/dashboards/canonical/market-autonomy.html',
  'public/dashboards/canonical/market-catalog.html',
];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Canonical standalone shell V4.1', () => {
  test.each(HTML_SURFACES)('%s remonte le shell après le chargement V4', file => {
    const html = read(file);
    const shell = html.indexOf('/dashboards/canonical/js/navigation-shell-v4-sync.js?v=2101');
    const bootstrap = html.indexOf('/dashboards/canonical/js/standalone-shell-bootstrap-v4.js?v=2301');
    expect(shell).toBeGreaterThanOrEqual(0);
    expect(bootstrap).toBeGreaterThan(shell);
  });

  test('le bootstrap résout user + contexte avant de remonter la navigation', () => {
    const source = read(BOOTSTRAP);
    expect(source).toContain("requestJson('/api/auth/me')");
    expect(source).toContain("requestJson('/api/admin/dashboard/context')");
    expect(source).toContain('global.KOMERCE_CANONICAL_AUTH_USER = user');
    expect(source).toContain('global.KOMERCE_CANONICAL_ADMIN_CONTEXT = adminContext');
    expect(source).toContain("doc?.getElementById?.('canonical-admin-navigation')?.remove?.()");
    expect(source).toContain('nav.mount({');
    expect(source).toContain('user,');
    expect(source).toContain('adminContext,');
  });

  test('une session expirée repart vers login avec retour vers la page courante', () => {
    const source = read(BOOTSTRAP);
    expect(source).toContain("global.location?.replace?.(loginUrl())");
    expect(source).toContain("/login.html?next=${encodeURIComponent(next)}");
  });

  test('le bootstrap reste sans autorité métier', () => {
    const source = read(BOOTSTRAP);
    expect(source).not.toMatch(/\/api\/admin\/(users|markets|orders|products)\b/);
    expect(source).not.toMatch(/method:\s*['\"](POST|PUT|PATCH|DELETE)['\"]/);
  });
});
