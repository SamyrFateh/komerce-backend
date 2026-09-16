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
const POLICY = 'public/dashboards/canonical/js/navigation-policy-v4.js';
const SYNC = 'public/dashboards/canonical/js/navigation-shell-v4-sync.js';
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
    expect(source).toContain('querySelectorAll?.(CHROME_SELECTOR)');
    expect(source).toContain('nav.mount({');
    expect(source).toContain('user,');
    expect(source).toContain('adminContext,');
  });

  test('sidebar, topbar et tabs ont chacun un propriétaire unique partout', () => {
    const bootstrap = read(BOOTSTRAP);
    const policy = read(POLICY);
    const sync = read(SYNC);

    expect(bootstrap).toContain('[data-canonical-shell-role="navigation"]');
    expect(bootstrap).toContain('[data-canonical-shell-role="topbar"]');
    expect(bootstrap).toContain('[data-canonical-shell-role="domain-tabs"]');
    expect(bootstrap).toContain('nodes.filter((node, index) => nodes.indexOf(node) === index)');

    expect(policy).toContain("navigation: '#canonical-admin-navigation");
    expect(policy).toContain("topbar: '#canonical-admin-topbar");
    expect(policy).toContain("tabs: '#canonical-admin-domain-tabs");
    expect(policy).toContain("header.setAttribute('data-canonical-shell-role', 'navigation')");
    expect(policy).toContain("topbar.setAttribute('data-canonical-shell-role', 'topbar')");
    expect(policy).toContain("nav.setAttribute('data-canonical-shell-role', 'domain-tabs')");
    expect(policy).toContain('_dedupeShell: dedupeShell');

    expect(sync).toContain("typeof nav._dedupeShell === 'function'");
    expect(sync).toContain('if (header === lastHeader) return;');
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
