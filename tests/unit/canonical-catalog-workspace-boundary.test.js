'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

afterEach(() => {
  delete globalThis.Translator;
  delete globalThis.__KOMERCE_CATALOG_FR_TRANSLATOR__;
});

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
    this.value = '';
    this.disabled = false;
    this.readOnly = false;
    this.rows = 0;
    this.type = '';
    this.href = '';
    this.innerHTML = '';
  }

  set textContent(value) {
    this._text = value == null ? '' : String(value);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent || '').join('');
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    this._text = '';
    children.forEach(child => this.appendChild(child));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  async click() {
    for (const handler of this.listeners.click || []) {
      await handler({ target: this, preventDefault() {} });
    }
  }

  focus() {
    this.focused = true;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).filter(Boolean).includes(selector.slice(1));
    }
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attr) {
      const actual = this.getAttribute(attr[1]);
      return attr[2] === undefined ? actual !== null : actual === attr[2];
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function fakeDocument() {
  return {
    createElement(tagName) {
      return new FakeNode(tagName);
    },
  };
}

function fakeUi(doc) {
  return {
    Section: {
      create() {
        const element = doc.createElement('section');
        const slot = doc.createElement('div');
        element.appendChild(slot);
        return { element, slot };
      },
    },
    MetricStrip: { render: jest.fn() },
  };
}

function workspacePayload(approval) {
  return {
    summary: {
      commercial_approved: 0,
      commercial_closed_lots: 0,
      approval_pending: approval.length,
      needs_review: 0,
      commercial_markets: 0,
    },
    curation: { published_products: 0 },
    approval,
    approval_breakdown: { TEST: approval.length },
    approval_strategy: { value_density_used: false },
    approval_page: {
      total: approval.length,
      limit: 50,
      offset: 0,
      has_previous: false,
      has_next: false,
    },
    products: [],
    categories: [],
  };
}

function candidate(overrides = {}) {
  return {
    product_ref: 'KPR-131956',
    name: 'Casual Stand Collar Men Top Outdoor Workwear',
    description: null,
    name_source: 'Casual Stand Collar Men Top Outdoor Workwear',
    description_source: 'Supplier source description',
    category: 'mens-tops',
    price_kmf: null,
    content_source: 'connector_raw',
    source_locale: 'en',
    needs_review: false,
    supplier_name: 'CJdropshipping',
    supplier_stock: 20,
    sourcing_confidence: 'high',
    sourcing_decision: 'TEST',
    sourcing_reason: 'Supplier signal',
    ...overrides,
  };
}

test('Catalogue charge les assets business-truth versionnés', () => {
  const index = read('public/dashboards/canonical/index.html');
  expect(index).toContain('/dashboards/canonical/js/catalog-control-tower.js?v=260929-2');
  expect(index).toContain('/dashboards/canonical/css/catalog-control-tower.css?v=2501');
  expect(index).toContain('/dashboards/canonical/js/catalog-workspace.js?v=261003-4');
  expect(index).toContain('/dashboards/canonical/css/operations-workspace.css?v=261003-2');
});

test('Vue Catalogue ne duplique plus le pipeline Import', () => {
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');

  ['Sourcés', 'Prêts à publier', 'Visible par marché', 'Sens des statuts', 'renderTruthFlow']
    .forEach(label => expect(tower).not.toContain(label));
  ['Sources catalogue · LIVE', 'La Raffinerie en temps réel', 'En train d’arriver · LIVE']
    .forEach(label => expect(workspace).not.toContain(label));

  expect(workspace).toContain('Catalogue global commercial');
  expect(workspace).toContain('KIR clos');
  expect(workspace).toContain('Marchés approuvés');
  expect(workspace).toContain('/admin/import-runtime');
  expect(workspace).not.toContain('setInterval(');
});

test('Catalogue garde une seule surface Canonical et délègue provenance/import au Cockpit', () => {
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(tower).toContain('Compatibility shell only');
  expect(tower).not.toContain("view=advanced");
  expect(workspace).toContain("cockpit.href = '/admin/import-runtime'");
  expect(workspace).toContain("sourcing.href = '/admin/workspaces/sourcing'");
});

test('la curation guide explicitement la préparation française avant publication', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('Copier pour ChatGPT');
  expect(workspace).toContain('Préparer en français');
  expect(workspace).toContain('Préparation FR automatique…');
  expect(workspace).toContain('Enregistrer la préparation FR');
  expect(workspace).toContain('Coller la réponse');
  expect(workspace).toContain('/prepare-fr');
  expect(workspace).toContain('Valider après relecture');
  expect(workspace).toContain('Description corrigée');
  expect(workspace).toContain('/admin/products/');
});

test('Catalogue montre la file immédiatement et conserve le contexte Product 360', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  const decision = read('public/dashboards/canonical/js/catalog-workspace-decision.js');

  expect(workspace).toContain("tr.setAttribute('data-product-ref'");
  expect(workspace).toContain("text(doc, 'a', 'kmc-catalog-product-title'");
  expect(workspace).toContain('Retour à la curation');
  expect(decision).toContain('requestedProductRef');
  expect(decision).toContain("classList.add('is-context-target')");
  expect(decision).toContain("host.insertBefore(approvalSection");
  expect(decision).not.toContain('Voir la file →');
});

test('la file de curation garde les décisions et actions dans le viewport', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  const css = read('public/dashboards/canonical/css/operations-workspace.css');

  expect(workspace).toContain('kmc-catalog-curation-table');
  expect(workspace).toContain('<th>Produit</th><th>Catégorie</th><th>Signal sourcing</th><th>État</th><th>Action</th>');
  expect(workspace).toContain('kmc-catalog-reason');
  expect(workspace).toContain('curationState');
  expect(css).toContain('position: sticky');
  expect(css).toContain('.kmc-catalog-actions-cell');
  expect(css).toContain('display: table-cell');
  expect(css).toContain('.kmc-catalog-actions-inner');
  expect(css).toContain('.kmc-catalog-cell-stack');
  expect(css).toContain('min-width: 240px');
  expect(css).toContain('-webkit-line-clamp: 2');
  expect(css).toContain('word-break: normal');
  expect(workspace).toContain("actionContent.className = 'kmc-catalog-actions-inner'");
  expect(workspace).toContain("signalContent.className = 'kmc-catalog-cell-stack'");
});

test('la préparation FR canonique reste gratuite et assistée hors runtime', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');

  expect(workspace).toContain('Copier pour ChatGPT');
  expect(workspace).toContain('Préparer en français');
  expect(workspace).toContain('Aucun appel API depuis Komerce');
  expect(workspace).toContain('parseFrenchAssistantOutput');
  expect(workspace).toContain('clipboard.readText');
  expect(workspace).toContain('globalThis.Translator');
  expect(workspace).toContain('Préparation française automatique dans le navigateur');
  expect(workspace).toContain('sans API IA payante');
  expect(workspace).not.toContain('ANTHROPIC_API_KEY');
});

test('la curation montre explicitement le avant/après après préparation FR', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  const css = read('public/dashboards/canonical/css/operations-workspace.css');

  expect(workspace).toContain('Avant / après');
  expect(workspace).toContain('Avant · fournisseur');
  expect(workspace).toContain('Après · français');
  expect(workspace).toContain('name_source');
  expect(workspace).toContain('description_source');
  expect(workspace).toContain('FR préparé · à relire');
  expect(css).toContain('.kmc-catalog-compare-grid');
});

test('Avant / après ouvre une fenêtre hors du tableau sans muter la ligne', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);
  const prepared = candidate({
    name: 'Haut homme décontracté à col montant',
    description: 'Description française relue.',
    content_source: 'manual',
    needs_review: true,
  });
  const fetchFn = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => workspacePayload([prepared]),
  }));

  await workspace.mount({
    root,
    document: doc,
    ui,
    fetch: fetchFn,
    confirm: () => true,
    prompt: jest.fn(),
  });

  const row = root.querySelector('[data-product-ref="KPR-131956"]');
  const rowTextBefore = row.textContent;
  const toggle = row.querySelector('[data-catalog-compare-toggle]');
  expect(toggle).not.toBeNull();
  expect(root.querySelector('[data-catalog-compare-dialog]')).toBeNull();

  await toggle.click();

  const overlay = root.querySelector('[data-catalog-compare-dialog]');
  expect(overlay).not.toBeNull();
  expect(row.textContent).toBe(rowTextBefore);
  expect(overlay.textContent).toContain('KPR-131956');
  expect(overlay.textContent).toContain('Avant · fournisseur');
  expect(overlay.textContent).toContain('Après · français');
  expect(overlay.textContent).toContain('Casual Stand Collar Men Top Outdoor Workwear');
  expect(overlay.textContent).toContain('Haut homme décontracté à col montant');

  await overlay.querySelector('[data-workspace-action="close-compare"]').click();
  expect(root.querySelector('[data-catalog-compare-dialog]')).toBeNull();
});

test('une fiche FR sans prix route vers Atelier économique avant toute validation', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);
  const prepared = candidate({
    name: 'Haut homme décontracté à col montant',
    description: 'Description française relue.',
    content_source: 'manual',
    needs_review: true,
    price_kmf: null,
  });
  const fetchFn = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => workspacePayload([prepared]),
  }));

  await workspace.mount({
    root,
    document: doc,
    ui,
    fetch: fetchFn,
    confirm: () => true,
    prompt: jest.fn(),
  });

  const row = root.querySelector('[data-product-ref="KPR-131956"]');
  expect(row.textContent).toContain('FR préparé · prix à définir');
  const pricing = row.querySelector('[data-workspace-action="define-price"]');
  expect(pricing).not.toBeNull();
  expect(pricing.href).toBe('/admin/workspaces/pricing?product_ref=KPR-131956#pricing-products');
  expect(row.querySelector('[data-workspace-action="approve"]')).toBeNull();
  expect(row.querySelector('[data-workspace-action="override"]')).toBeNull();
});

test('une fiche FR tarifée retrouve ensuite la validation humaine', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);
  const prepared = candidate({
    name: 'Haut homme décontracté à col montant',
    description: 'Description française relue.',
    content_source: 'manual',
    needs_review: true,
    price_kmf: 12000,
  });
  const fetchFn = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => workspacePayload([prepared]),
  }));

  await workspace.mount({
    root,
    document: doc,
    ui,
    fetch: fetchFn,
    confirm: () => true,
    prompt: jest.fn(),
  });

  const row = root.querySelector('[data-product-ref="KPR-131956"]');
  expect(row.textContent).toContain('FR préparé · à relire');
  expect(row.textContent).toContain('Valider après relecture');
  expect(row.querySelector('[data-workspace-action="define-price"]')).toBeNull();
  expect(row.querySelector('[data-workspace-action="approve"]')).not.toBeNull();
});

test('la réponse ChatGPT se transforme automatiquement en champs FR', () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace.parseFrenchAssistantOutput(
    '**Titre FR:** Haut homme décontracté à col montant\n**Description FR:** Vêtement pour extérieur et travail, préparé à partir de la source fournisseur.'
  )).toEqual({
    name: 'Haut homme décontracté à col montant',
    description: 'Vêtement pour extérieur et travail, préparé à partir de la source fournisseur.',
  });
});

test('l’entrée Catalogue préchauffée prépare le FR sans clic produit puis laisse la validation humaine', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);

  const second = candidate({
    product_ref: 'KPR-131957',
    name: 'Produit déjà français',
    name_source: 'Produit déjà français',
    description_source: 'Description source déjà française',
    source_locale: 'fr',
  });
  const initial = workspacePayload([candidate(), second]);
  const prepared = workspacePayload([
    candidate({
      name: 'Haut homme décontracté à col montant',
      description: 'Description française relue.',
      content_source: 'manual',
    }),
    second,
  ]);

  const translate = jest.fn(async value => (
    value.includes('Casual Stand Collar')
      ? 'Haut homme décontracté à col montant'
      : 'Description française relue.'
  ));
  const destroy = jest.fn();
  globalThis.__KOMERCE_CATALOG_FR_TRANSLATOR__ = {
    sourceLanguage: 'en',
    targetLanguage: 'fr',
    promise: Promise.resolve({ translate, destroy }),
  };

  let getCount = 0;
  const fetchFn = jest.fn(async (url, options) => {
    if (options.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { product_ref: 'KPR-131956' } }),
      };
    }
    getCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => (getCount === 1 ? initial : prepared),
    };
  });

  await workspace.mount({
    root,
    document: doc,
    ui,
    fetch: fetchFn,
    confirm: () => true,
    prompt: jest.fn(),
  });

  const firstPaint = root.querySelector('[data-product-ref="KPR-131956"]');
  expect(firstPaint.querySelector('[data-workspace-action="prepare-fr-auto"]')).not.toBeNull();
  expect(firstPaint.querySelector('[data-workspace-action="prepare-fr"]')).toBeNull();

  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));

  const post = fetchFn.mock.calls.find(([, options]) => options.method === 'POST');
  expect(post).toBeDefined();
  expect(post[0]).toBe('/api/admin/workspaces/catalog/approval/KPR-131956/prepare-fr');
  expect(JSON.parse(post[1].body)).toMatchObject({
    name: 'Haut homme décontracté à col montant',
    description: 'Description française relue.',
    reason: 'Préparation FR automatique locale au navigateur — zéro API IA payante',
  });
  expect(destroy).not.toHaveBeenCalled();

  const refreshed = root.querySelector('[data-product-ref="KPR-131956"]');
  expect(refreshed.textContent).toContain('Avant / après');
  expect(refreshed.textContent).not.toContain('Après · français');
  expect(refreshed.querySelector('[data-catalog-compare-toggle]')).not.toBeNull();
  expect(refreshed.textContent).toContain('Définir le prix');
  expect(refreshed.textContent).not.toContain('Valider après relecture');
  expect(refreshed.textContent).toContain('FR préparé · CJdropshipping');
  expect(refreshed.textContent).not.toContain('Préparation humaine · CJdropshipping');
  expect(refreshed.querySelector('[data-workspace-action="prepare-fr"]')).toBeNull();
});

test('le parcours FR intégré conserve toute la file et rend le avant/après après sauvegarde', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);
  const prompt = jest.fn();

  const second = candidate({
    product_ref: 'KPR-131957',
    name: 'Second supplier product',
    name_source: 'Second supplier product',
  });
  const initial = workspacePayload([candidate(), second]);
  const prepared = workspacePayload([
    candidate({
      name: 'Haut homme décontracté à col montant',
      description: 'Description française relue.',
      content_source: 'manual',
    }),
    second,
  ]);

  const translate = jest.fn(async value => (
    value.includes('Casual Stand Collar')
      ? 'Haut homme décontracté à col montant'
      : 'Description française relue.'
  ));
  const destroy = jest.fn();
  globalThis.Translator = {
    create: jest.fn(async () => ({ translate, destroy })),
  };

  let getCount = 0;
  const fetchFn = jest.fn(async (url, options) => {
    if (options.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { product_ref: 'KPR-131956' } }),
      };
    }
    getCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => (getCount === 1 ? initial : prepared),
    };
  });

  await workspace.mount({
    root,
    document: doc,
    ui,
    fetch: fetchFn,
    confirm: () => true,
    prompt,
  });

  expect(root.querySelectorAll('[data-product-ref]')).toHaveLength(2);
  const firstRow = root.querySelector('[data-product-ref="KPR-131956"]');
  const prepare = firstRow.querySelector('[data-workspace-action="prepare-fr"]');
  expect(prepare).not.toBeNull();

  await prepare.click();
  const editor = root.querySelector('[data-catalog-fr-editor]');
  expect(editor).not.toBeNull();
  expect(editor.textContent).toContain('Source fournisseur');
  expect(editor.textContent).toContain('Casual Stand Collar Men Top Outdoor Workwear');
  expect(globalThis.Translator.create).toHaveBeenCalledWith(expect.objectContaining({
    sourceLanguage: 'en',
    targetLanguage: 'fr',
  }));
  expect(editor.querySelector('[data-catalog-fr-field="name"]').value)
    .toBe('Haut homme décontracté à col montant');
  expect(editor.querySelector('[data-catalog-fr-field="description"]').value)
    .toBe('Description française relue.');
  expect(destroy).toHaveBeenCalledTimes(1);

  await editor.querySelector('[data-workspace-action="save-fr-editor"]').click();

  expect(root.querySelectorAll('[data-product-ref]')).toHaveLength(2);
  const refreshed = root.querySelector('[data-product-ref="KPR-131956"]');
  expect(refreshed.textContent).toContain('Avant / après');
  expect(refreshed.textContent).not.toContain('Après · français');
  expect(refreshed.querySelector('[data-catalog-compare-toggle]')).not.toBeNull();
  expect(refreshed.textContent).toContain('Haut homme décontracté à col montant');
  expect(prompt).not.toHaveBeenCalled();

  const post = fetchFn.mock.calls.find(([, options]) => options.method === 'POST');
  expect(post[0]).toBe('/api/admin/workspaces/catalog/approval/KPR-131956/prepare-fr');
  expect(JSON.parse(post[1].body)).toMatchObject({
    name: 'Haut homme décontracté à col montant',
    description: 'Description française relue.',
  });
});

test('Catalogue ne crée plus de navigation parallèle au shell Canonical', () => {
  const source = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const css = read('public/dashboards/canonical/css/catalog-control-tower.css');
  expect(source).not.toContain('renderSidebar');
  expect(source).not.toContain('renderTopbar');
  expect(css).not.toContain('.kmc-ctl-sidebar');
  expect(css).not.toContain('body.kmc-catalog-live-mode > .kmc-admin-navigation');
});

test('la vue business lit uniquement le Workspace Catalogue canonique', () => {
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain("const ENDPOINT = '/api/admin/workspaces/catalog'");
  expect(tower).not.toContain('/api/admin/workspaces/catalog');
  expect(workspace).not.toContain("'/api/products");
  expect(tower).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(workspace).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
});


test('le CTA prix cible explicitement l onglet Produits du Pricing', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain("#pricing-products");
  expect(workspace).toContain("product_ref=");
});


test('Catalogue affiche les raisons de certification lisibles au lieu du seul 422 générique', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain("error.reasons = Array.isArray(body.reasons)");
  expect(workspace).toContain("boutique_subcategory_missing: 'sous-catégorie Boutique absente'");
  expect(workspace).toContain("media_missing: 'média Catalogue absent'");
  expect(workspace).toContain('actionErrorMessage(error)');
});
