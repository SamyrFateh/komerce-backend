'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const WORKSPACE = 'public/dashboards/canonical/js/purchasing-workspace.js';
const workspaceModule = require(path.join(ROOT, WORKSPACE));

describe('Achats fournisseurs — frontière canonique', () => {
  test('charge ses assets, est servi par le serveur et routé côté client', () => {
    const index = read('public/dashboards/canonical/index.html');
    expect(index).toContain('/dashboards/canonical/js/purchasing-workspace.js?v=');
    expect(index).toContain('/dashboards/canonical/css/purchasing-workspace.css?v=');
    expect(read('bootstrap/html-routes.js')).toContain("'/admin/workspaces/purchasing'");
    expect(read('public/dashboards/canonical/js/app.js')).toContain("'/admin/workspaces/purchasing'");
    expect(read('public/dashboards/canonical/js/canonical-client-router-v4.js')).toContain('purchasing');
  });

  test('aucun import ni référence aux générations legacy', () => {
    const source = read(WORKSPACE);
    expect(source).not.toMatch(/admin-legacy|\/dashboards\/admin\//);
  });

  test('ne consomme que des routes /api/purchasing réellement déclarées (aucun backend nouveau)', () => {
    const source = read(WORKSPACE);
    const routes = read('routes/purchasing.js');
    expect(workspaceModule.ENDPOINT).toBe('/api/purchasing');
    expect(source).not.toMatch(/\/api\/(?!purchasing)/);

    const used = [
      "router.get('/open-lines'",
      "router.get('/po/:po_id'",
      "router.post('/po/prepare'",
      "router.post('/po/:po_id/detach'",
      "router.post('/po/:po_id/discard'",
      "router.post('/po/:po_id/submit'",
      "router.post('/po/:po_id/confirm'",
      "router.post('/lines/:id/cancel'",
    ];
    used.forEach((declaration) => expect(routes).toContain(declaration));
    ['/open-lines', '/po/prepare', '/detach', '/discard', '/submit', '/confirm', '/cancel'].forEach((fragment) => {
      expect(source).toContain(fragment);
    });
  });

  test('aucun calcul métier navigateur : le marché n’est jamais une clé de regroupement côté écran', () => {
    const source = read(WORKSPACE);
    expect(source).toContain('${group.supplier_id}|${group.procurement_hub_ref}');
    expect(source).not.toMatch(/groupBy.*market|key\s*=.*market_id/);
  });

  test('navigation : espace réservé à admin dans Opérations', () => {
    const nav = read('public/dashboards/canonical/js/navigation.js');
    expect(nav).toMatch(/id: 'purchasing-workspace', label: 'Achats fournisseurs', href: '\/admin\/workspaces\/purchasing', roles: Object\.freeze\(\['admin'\]\)/);
  });
});

describe('describeError', () => {
  const { describeError } = workspaceModule;

  test('relaie le message serveur', () => {
    expect(describeError(new Error('Boom'))).toBe('Boom');
    expect(describeError(null)).toBe('Erreur inattendue');
  });

  test('détaille les verdicts d’un refus de soumission', () => {
    const error = new Error('Soumission refusée');
    error.code = 'PURCHASE_ORDER_SUBMIT_REFUSED';
    error.body = { verdicts: [{ supplier_unit_ref: 'UNIT-A', reason: 'preflight requis' }, { provider: 'allegro', verdict: 'blocked' }] };
    expect(describeError(error)).toBe('Soumission refusée — UNIT-A : preflight requis · allegro : blocked');
  });

  test('explique un flag désactivé sans jargon', () => {
    const error = new Error('x');
    error.code = 'GROUPED_PURCHASING_DISABLED';
    expect(describeError(error)).toMatch(/pas activés/);
  });
});
