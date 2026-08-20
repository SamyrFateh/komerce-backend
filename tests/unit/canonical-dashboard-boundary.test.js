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
  const res = {
    headersSent: false,
    setHeader: jest.fn(),
    sendFile: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  };
  return res;
}

describe('LOT 2-RESET — frontière Legacy / Canonical', () => {
  test('le socle canonical existe comme runtime physique autonome', () => {
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'css', 'base.css'))).toBe(true);
    expect(fs.existsSync(path.join(CANONICAL_ROOT, 'js', 'app.js'))).toBe(true);
  });

  test('canonical ne référence jamais admin/** ni admin-legacy/**', () => {
    const sourceFiles = walk(CANONICAL_ROOT).filter(file => /\.(?:html|css|js|mjs|cjs)$/.test(file));
    const forbidden = [
      /\/dashboards\/admin(?:-legacy)?\//,
      /\.\.\/admin(?:-legacy)?\//,
      /\.\.\/\.\.\/admin(?:-legacy)?\//,
      /\b(?:PilotageView|SanteView|ControlTowerView|ProblemsView)\b/,
    ];

    const violations = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.test(content)) {
          violations.push(`${path.relative(ROOT, file)} -> ${rule}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('/admin-next sert canonical sans détourner les routes /admin/* historiques', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);

    const canonicalRes = fakeRes();
    app._routes['/admin-next']({}, canonicalRes);
    expect(canonicalRes.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'canonical', 'index.html'),
      expect.any(Function)
    );

    const legacyCurrentRes = fakeRes();
    app._routes['/admin/pilotage']({}, legacyCurrentRes);
    expect(legacyCurrentRes.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html'),
      expect.any(Function)
    );
  });

  test('l’entrypoint canonical n’embarque aucune API métier au reset', () => {
    const appSource = fs.readFileSync(path.join(CANONICAL_ROOT, 'js', 'app.js'), 'utf8');
    const apiPaths = [...appSource.matchAll(/['"](\/api\/[^'"]+)['"]/g)].map(match => match[1]);
    expect(apiPaths).toEqual(['/api/auth/me']);
  });
});
