'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }) }));

const { mountHtmlRoutes } = require('../../bootstrap/html-routes');
const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function fakeApp() {
  const routes = {};
  return { get: jest.fn((routePath, handler) => { routes[routePath] = handler; }), _routes: routes };
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

test('URL Sourcing et anciens points d?entr?e convergent selon le cutover 4L', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/workspaces/sourcing']({}, canonicalRes);
  expect(canonicalRes.setHeader)
    .toHaveBeenCalledWith('X-Admin-Generation', 'canonical');

  for (const routePath of ['/admin/sourcing', '/admin/sourcing-scanner']) {
    const aliasRes = fakeRes();
    app._routes[routePath]({ query: {} }, aliasRes);
    expect(aliasRes.redirect)
      .toHaveBeenCalledWith(302, '/admin/workspaces/sourcing');

    const rollbackRes = fakeRes();
    app._routes[routePath]({ query: { legacy: '1' } }, rollbackRes);
    expect(rollbackRes.redirect)
      .toHaveBeenCalledWith(302, '/admin/workspaces/sourcing');
    expect(rollbackRes.sendFile).not.toHaveBeenCalled();
  }

  const suppliersRes = fakeRes();
  app._routes['/admin/suppliers']({}, suppliersRes);
  expect(suppliersRes.setHeader)
    .toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
});

test('runtime charge Sourcing sans vues Legacy ni API historiques', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/sourcing-workspace.js');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:SourcingView|SourcingScannerView|SuppliersView|ApiClient|KmcApi)\b/);
  expect(source).not.toContain('/api/admin/sourcing');
  expect(source).not.toContain('/api/admin/partners');
  expect(source).toContain('/api/admin/workspaces/sourcing');
});

test('Sourcing est global central et navigue par références métier', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace.js'), 'utf8');
  expect(appSource).toContain("SOURCING_WORKSPACE: 'sourcing-workspace'");
  expect(source).toContain('row.candidate_ref');
  expect(source).toContain('row.partner_ref');
  expect(source).toContain('row.product_ref');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
});

test('service Canonical délègue les moteurs au lieu de réimplémenter leur SQL métier', () => {
  const service = fs.readFileSync(path.join(ROOT, 'services', 'sourcing-workspace.js'), 'utf8');
  expect(service).toContain("require('./sourcing-candidate-actions')");
  expect(service).toContain("require('./sourcing-mutations')");
  expect(service).toContain("require('./suppliers/catalog-import-orchestrator')");
  expect(service).toContain("require('./partner-admin-service')");
  expect(service).not.toContain('INSERT INTO sourcing_candidate_events');
  expect(service).not.toContain('UPDATE products SET');
});


test('Sourcing ne duplique plus le registre KIR et garde la santé technique en diagnostic', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace.js'), 'utf8');
  const decision = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace-decision.js'), 'utf8');

  expect(source).toContain('Lancer un import');
  expect(source).toContain('/admin/import-runtime');
  expect(source).not.toContain('Aucun import récent.');
  expect(source).not.toContain("const rows = payload.imports || []");
  expect(source).toContain('/admin/import-runtime');

  expect(decision).toContain("get('diagnostic') === '1'");
  expect(decision).toContain('renderHealth');
  expect(source).not.toContain('?diagnostic=1');
});

test('candidats : hiérarchie visuelle par classes, sans changer les valeurs affichées', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/sourcing-workspace.js'), 'utf8');
  expect(src).toContain('kmc-cand-ref');
  expect(src).toContain('kmc-cand-product');
  expect(src).toContain('Prix d’achat fournisseur');
  expect(src).toContain('sourcingRemedy(row)');
  expect(src).toContain("data-workspace-action', 'view-catalog'");
});

test('candidats : état et décision affichés en français (libellés mappés, valeur brute en repli)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/sourcing-workspace.js'), 'utf8');
  expect(src).toContain("imported_to_catalog: 'Dans le catalogue'");
  expect(src).toContain("test: 'À tester'");
  expect(src).toContain('CANDIDATE_STATE_LABELS');
});

test('imports manuels et CSV : panneau guidé, validation avant écriture et sans prompt navigateur', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace.js'), 'utf8');
  const start = source.indexOf('function renderImports(');
  const end = source.indexOf('function renderPortfolio(', start);
  const segment = source.slice(start, end);
  expect(segment).toContain("data-sourcing-manual-panel");
  expect(segment).toContain("data-manual-supplier");
  expect(segment).toContain("data-manual-products");
  expect(segment).toContain("JSON invalide : vérifiez la syntaxe.");
  expect(segment).toContain("source_type: 'csv'");
  expect(segment).toContain("source_type: 'manual'");
  expect(segment).not.toContain('context.prompt(');
});

test('import JSON guidé : invalide bloqué, valide transmis sans mutation implicite', async () => {
  const sourcing = require('../../public/dashboards/canonical/js/sourcing-workspace.js');
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.text = ''; this.value = ''; }
    set textContent(value) { this.text = String(value || ''); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(event, listener) { this.listeners[event] = listener; }
    focus() {}
    querySelector(selector) {
      const key = selector.slice(1, -1);
      if (Object.prototype.hasOwnProperty.call(this.attrs, key)) return this;
      for (const child of this.children) {
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    }
  }
  const find = (node, key, value) => {
    if (node.attrs[key] === value) return node;
    for (const child of node.children) {
      const found = find(child, key, value);
      if (found) return found;
    }
    return null;
  };
  const root = new Node('root');
  const calls = [];
  const payload = { summary: {}, candidates: [], portfolio: { products: [] }, suppliers: [] };
  const fetch = jest.fn(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => payload };
  });
  await sourcing.mount({
    root, document: { createElement: tag => new Node(tag) }, fetch,
    user: { role: 'admin' },
    ui: {
      Section: { create: () => {
        const element = new Node('section'), slot = new Node('div');
        element.appendChild(slot);
        return { element, slot };
      } },
      MetricStrip: { render: () => {} },
    },
    prompt: () => { throw new Error('Native prompt forbidden for imports'); },
  });
  const action = name => find(root, 'data-workspace-action', name);
  action('manual-import').listeners.click();
  find(root, 'data-manual-supplier', '').value = 'CJ';
  const editor = find(root, 'data-manual-products', '');
  editor.value = '{wrong';
  await action('submit-manual-import').listeners.click();
  expect(calls.filter(call => call.options.method === 'POST')).toHaveLength(0);
  expect(find(root, 'data-manual-feedback', '').textContent).toContain('JSON invalide');
  editor.value = '[{"supplier_product_id":"CJ-1","product_name":"Produit test","purchase_price":100,"currency":"AED"}]';
  await action('submit-manual-import').listeners.click();
  const mutations = calls.filter(call => call.options.method === 'POST');
  expect(mutations).toHaveLength(1);
  expect(JSON.parse(mutations[0].options.body)).toEqual({
    supplier_name: 'CJ', source_type: 'manual',
    items: [{ supplier_product_id: 'CJ-1', product_name: 'Produit test', purchase_price: 100, currency: 'AED' }],
  });

  // CSV partage le panneau mais jamais le payload JSON; aucun import implicite.
  action('csv-import').listeners.click();
  const csvEditor = find(root, 'data-manual-products', '');
  find(root, 'data-manual-supplier', '').value = 'CJ';
  csvEditor.value = '';
  await action('submit-manual-import').listeners.click();
  expect(calls.filter(call => call.options.method === 'POST')).toHaveLength(1);
  csvEditor.value = 'supplier_product_id,product_name,purchase_price,currency\nCJ-2,Produit CSV,200,AED';
  await action('submit-manual-import').listeners.click();
  const posts = calls.filter(call => call.options.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[1].options.body)).toEqual({
    supplier_name: 'CJ', source_type: 'csv',
    csv_text: 'supplier_product_id,product_name,purchase_price,currency\nCJ-2,Produit CSV,200,AED',
  });
});

test('fournisseurs sourcing : création et modification via formulaire, validations sans POST inutile', async () => {
  const sourcing = require('../../public/dashboards/canonical/js/sourcing-workspace.js');
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.text = ''; this.value = ''; }
    set textContent(value) { this.text = String(value || ''); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(event, listener) { this.listeners[event] = listener; }
    focus() {}
    querySelector(selector) {
      const key = selector.slice(1, -1);
      if (Object.prototype.hasOwnProperty.call(this.attrs, key)) return this;
      for (const child of this.children) {
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    }
  }
  const find = (node, key, value) => {
    if (node.attrs[key] === value) return node;
    for (const child of node.children) {
      const found = find(child, key, value);
      if (found) return found;
    }
    return null;
  };
  const payload = {
    summary: {}, candidates: [], imports: [],
    portfolio: { products: [] },
    suppliers: [{ partner_ref: 'KPT-1', name: 'CJ', country_code: 'AE', lead_time_days: 5, is_active: true }],
  };
  const calls = [];
  const fetch = jest.fn(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => payload };
  });
  const root = new Node('div');
  await sourcing.mount({
    root, document: { createElement: tag => new Node(tag) }, fetch,
    locationSearch: '?mode=partners',
    user: { role: 'admin' },
    ui: {
      Section: { create: () => {
        const element = new Node('section'), slot = new Node('div');
        element.appendChild(slot);
        return { element, slot };
      } },
      MetricStrip: { render: () => {} },
    },
    prompt: () => { throw new Error('Prompt navigateur interdit'); },
  });
  const action = name => find(root, 'data-workspace-action', name);
  const field = key => find(root, 'data-supplier-field', key);
  const submit = async () => {
    const form = find(root, 'data-sourcing-supplier-form', '');
    await form.listeners.submit({ preventDefault() {} });
  };
  const mutations = () => calls.filter(c => c.options.method === 'POST');

  action('create-supplier').listeners.click();
  await submit();
  expect(mutations()).toHaveLength(0);
  field('name').value = 'Fournisseur Comores';
  field('country_code').value = 'ZZZ';
  await submit();
  expect(mutations()).toHaveLength(0);
  field('country_code').value = 'KM';
  field('contact_name').value = 'Contact test';
  await submit();
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url).toBe('/api/admin/workspaces/sourcing/suppliers');
  expect(JSON.parse(mutations()[0].options.body)).toEqual({
    name: 'Fournisseur Comores', country_code: 'KM', contact_name: 'Contact test',
  });

  action('update-supplier').listeners.click();
  field('name').value = 'CJ modifié';
  field('lead_time_days').value = '-1';
  await submit();
  expect(mutations()).toHaveLength(1);
  field('lead_time_days').value = '0';
  await submit();
  expect(mutations()).toHaveLength(2);
  expect(mutations()[1].url).toBe('/api/admin/workspaces/sourcing/suppliers/KPT-1/update');
  expect(JSON.parse(mutations()[1].options.body)).toEqual({ name: 'CJ modifié', lead_time_days: 0 });
});
