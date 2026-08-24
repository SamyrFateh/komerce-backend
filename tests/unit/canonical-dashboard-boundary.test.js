/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const fs = require('fs');
const path = require('path');

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const { mountHtmlRoutes } = require('../../bootstrap/html-routes');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL_ROOT = path.join(ROOT, 'public', 'dashboards', 'canonical');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function fakeApp() {
  const routes = {};
  return {
    get: jest.fn((routePath, handler) => { routes[routePath] = handler; }),
    _routes: routes,
  };
}

function fakeRes() {
  return {
    headersSent: false,
    setHeader: jest.fn(),
    sendFile: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  };
}

describe('LOT 2-CUTOVER — frontière Legacy / Canonical', () => {
  test('le runtime canonical physique contient Pilotage, Commerce, Operations et Finance', () => {
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'css', 'base.css'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'js', 'app.js'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'js', 'pilotage.js'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'js', 'commerce.js'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'js', 'operations.js'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'js', 'finance.js'))).toBe(true);
  });

  test('canonical ne référence jamais admin/** ni admin-legacy/**', () => {
    const sourceFiles = walk(CANONICAL_ROOT).filter(file => /\.(?:html|css|js|mjs|cjs)$/.test(file));
    const forbidden = [
      /\/dashboards\/admin(?:-legacy)?\//,
      /\.\.\/admin(?:-legacy)?\//,
      /\.\.\/\.\.\/admin(?:-legacy)?\//,
      /\b(?:PilotageView|SalesView|OrdersLogisticsView|FinanceView|PilotageFinView|SanteView|ControlTowerView|ProblemsView)\b/,
    ];

    const violations = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.test(content)) violations.push(`${path.relative(ROOT, file)} -> ${rule}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('les quatre dashboards prennent leurs URLs admin stables dans Canonical', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);
    const canonicalPath = path.join(ROOT, 'public', 'dashboards', 'canonical', 'index.html');

    for (const routePath of [
      '/admin',
      '/admin/pilotage',
      '/admin/commerce',
      '/admin/operations',
      '/admin/finance',
      '/admin/demo',
    ]) {
      const canonicalRes = fakeRes();
      app._routes[routePath]({ query: {} }, canonicalRes);
      expect(canonicalRes.sendFile).toHaveBeenCalledWith(canonicalPath, expect.any(Function));
      expect(canonicalRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
    }
  });

  test('les aliases de construction convergent vers les URLs stables', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);
    const expected = {
      '/admin-next': '/admin/pilotage',
      '/admin-next/commerce': '/admin/commerce',
      '/admin-next/operations': '/admin/operations',
      '/admin-next/finance': '/admin/finance',
      '/admin-next/demo': '/admin/demo',
      '/admin/pilotage-v2': '/admin/pilotage',
    };

    for (const [routePath, stablePath] of Object.entries(expected)) {
      const res = fakeRes();
      app._routes[routePath]({ query: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, stablePath);
      expect(res.sendFile).not.toHaveBeenCalled();
    }
  });

  test('Pilotage Legacy 1 reste rollbackable sans changer le pathname historique', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);
    const legacyPath = path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html');
    const res = fakeRes();

    app._routes['/admin/pilotage']({ query: { legacy: '1' } }, res);

    expect(res.sendFile).toHaveBeenCalledWith(legacyPath, expect.any(Function));
    expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  });

  test('une capacité non encore reconstruite reste servie par Legacy 1', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);
    const legacyPath = path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html');
    const res = fakeRes();

    app._routes['/admin/hub-relais']({ query: {} }, res);

    expect(res.sendFile).toHaveBeenCalledWith(legacyPath, expect.any(Function));
    expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  });

  test('l’entrypoint canonical ne charge que la session puis l’autorité serveur', () => {
    const appSource = fs.readFileSync(path.join(CANONICAL_ROOT, 'js', 'app.js'), 'utf8');
    const apiPaths = [...appSource.matchAll(/['"](\/api\/[^'"]+)['"]/g)].map(match => match[1]);
    expect(apiPaths).toEqual(['/api/auth/me', '/api/admin/dashboard/context']);
    expect(appSource).toContain('validateAdminContext');
    expect(appSource).not.toMatch(/market_id|localStorage|sessionStorage/);
  });
});