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

  insertBefore(child, reference) {
    const position = this.children.indexOf(reference);
    if (position < 0) throw new Error('FakeNode: reference is not a child');
    if (child.parentNode) child.remove();
    this.children.splice(position, 0, child);
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
  expect(index).toContain('/dashboards/canonical/css/catalog-control-tower.css?v=261010-9');
  expect(index).toContain('/dashboards/canonical/js/catalog-workspace.js?v=261031-2');
  expect(index).toContain('/dashboards/canonical/css/operations-workspace.css?v=261027-1');
});

test('Vue Catalogue ne duplique plus le pipeline Import', () => {
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');

  ['Sourcés', 'Prêts à publier', 'Visible par marché', 'Sens des statuts', 'renderTruthFlow']
    .forEach(label => expect(tower).not.toContain(label));
  ['Sources catalogue · LIVE', 'La Raffinerie en temps réel', 'En train d’arriver · LIVE']
    .forEach(label => expect(workspace).not.toContain(label));

  expect(workspace).toContain("createSection(rootNode, ui, 'Produits', '')");
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
  expect(workspace).toContain("if (refinery) {");
  expect(workspace).toContain("next.href = '/admin/workspaces/catalog'");
  expect(workspace).not.toContain('nav.appendChild(refineryLink)');
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

  expect(workspace).toContain("tr.setAttribute(row.product_ref ? 'data-product-ref' : 'data-candidate-ref'");
  expect(workspace).toContain("text(doc, row.product_ref ? 'a' : 'span'");
  expect(workspace).toContain('Retour à la curation');
  expect(workspace).toContain("params.set('product_ref', context.focusedProductRef)");
  expect(decision).toContain('requestedProductRef');
  expect(decision).toContain("classList.add('is-context-target')");
  expect(decision).toContain("host.insertBefore(approvalSection");
  expect(decision).not.toContain('Voir la file →');
});

test('Catalogue conserve un relais visible vers la décision marché après publication', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('Suite commerciale');
  expect(workspace).toContain('Publication Catalogue terminée · décision commerciale marché encore requise.');
  expect(workspace).toContain('/dashboards/canonical/market-catalog.html?');
  expect(workspace).toContain('product_ref');
});

test('la file de curation garde les décisions et actions dans le viewport', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  const css = read('public/dashboards/canonical/css/operations-workspace.css');

  expect(workspace).toContain('kmc-catalog-curation-table');
  expect(workspace).toContain('<th>Produit</th><th>Catégorie</th><th>Signal sourcing</th><th>État</th><th>Action</th>');
  expect(workspace).toContain('kmc-catalog-reason');
  expect(workspace).toContain('curationState');
  expect(workspace).toContain('renderCurationChain');
  expect(css).toContain('.kmc-catalog-chain-stage.is-current');
  expect(css).toContain('.kmc-workspace-action.is-approve');
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
    location: { search: '?view=refinery' },
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
    location: { search: '?view=refinery' },
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
    location: { search: '?view=refinery' },
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

test('un refus de certification reste visible dans la ligne du produit cliqué', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);
  const prepared = candidate({
    name: 'Jupe bouffante en coton blanc',
    description: 'Description française relue.',
    content_source: 'manual',
    needs_review: true,
    price_kmf: 7990,
  });
  const fetchFn = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST') {
      return {
        ok: false,
        status: 422,
        json: async () => ({
          error: 'Certification Catalogue incomplète',
          code: 'catalog_certification_failed',
          reasons: ['boutique_subcategory_missing', 'media_missing'],
          certification_version: 'v-test',
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => workspacePayload([prepared]),
    };
  });

  await workspace.mount({
    location: { search: '?view=refinery' },
    root,
    document: doc,
    ui,
    fetch: fetchFn,
    confirm: () => true,
    prompt: jest.fn(),
  });

  const row = root.querySelector('[data-product-ref="KPR-131956"]');
  const feedback = row.querySelector('[data-catalog-action-feedback]');
  expect(feedback).not.toBeNull();
  expect(feedback.textContent).toBe('');

  await row.querySelector('[data-workspace-action="approve"]').click();

  expect(feedback.textContent).toContain('Certification Catalogue incomplète');
  expect(feedback.textContent).toContain('sous-catégorie Boutique absente');
  expect(feedback.textContent).toContain('média Catalogue absent');
  expect(feedback.className).toContain('is-critical');
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
    location: { search: '?view=refinery' },
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
    location: { search: '?view=refinery' },
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

test('Catalogue définit le wrapper de table utilisé par les vues produit et relais marché', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('function wrapTable(doc, table)');
  expect(workspace).toContain("wrap.className = 'kmc-workspace-table-wrap'");
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

test('Raffinerie et Catalogue ont des files actives distinctes', () => {
  const source = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(source).toContain("get('view') === 'refinery'");
  expect(source).toContain('if (refinery) {');
  expect(source).toContain('renderApproval(rootNode, ui, doc, payload, context)');
  expect(source).toContain('renderProducts(rootNode, ui, doc, payload, context)');
});

test('Catalogue fini ne declenche jamais une preparation FR automatique', () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const candidateRow = candidate({ source_locale: 'en', content_source: 'connector_raw' });
  expect(workspace.scheduleAutoFrenchPreparation(
    { workspaceView: 'catalog', autoFrenchRunning: false, autoFrenchAttempted: new Set(), autoFrenchFailed: new Set() },
    { approval: [candidateRow] },
  )).toBe(false);
  const source = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(source).toContain("if (context.workspaceView !== 'refinery') return false;");
  expect(source).toContain("if (context.workspaceView === 'refinery' && !reloadOptions.skipAutoFrenchSchedule)");
});

test('la Raffinerie affiche les manquants certifies par le serveur et laisse la vue commerciale distincte', () => {
  const source = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(source).toContain("include_readiness: '1'");
  expect(source).toContain("data-refinery-readiness");
  expect(source).toContain('reasons.map(certificationReasonLabel)');
  expect(source).toContain('/admin/workspaces/catalog?view=refinery&product_ref=');
});

test('la Raffinerie ne duplique pas ses compteurs en bas et préserve les métriques du Catalogue', () => {
  const source = read('public/dashboards/canonical/js/catalog-workspace.js');
  const render = source.slice(source.indexOf('function renderPayload('), source.indexOf('async function mount(', source.indexOf('function renderPayload(')));
  expect(render).toContain("if (context.catalogTab === 'assortment') {");
  expect(render).toContain("} else if (context.catalogTab === 'taxonomy') {");
  expect(render).toContain('renderCommercial(rootNode, ui, doc, payload)');
  expect(render).toContain('renderTaxonomy(rootNode, ui, doc, payload, context)');
  expect(render).not.toContain('taxonomyPanel');
  expect(render.indexOf('renderCatalogTabs(rootNode, doc, context)')).toBeLessThan(render.indexOf('renderProducts(rootNode, ui, doc, payload, context)'));
  // Les compteurs opérationnels du registre sont exclus de la Raffinerie
  // et des deux rubriques secondaires : aucune métrique hors du bon onglet.
  expect(render).toContain("if (refinery) {");
  expect(render).toContain("renderApproval(rootNode, ui, doc, payload, context);");
  expect(render).not.toContain('ui.MetricStrip.render');
  expect(render).not.toContain("metricItems(payload.summary, payload.curation).filter");
  expect(render).toContain('renderApproval(rootNode, ui, doc, payload, context)');
  expect(render).toContain('renderProducts(rootNode, ui, doc, payload, context)');
});


test('Catalogue unifié : candidat pré-handoff affiché et inspectable sans écriture ni product_ref', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument();
  const root = doc.createElement('main');
  const ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.summary.operator_groups = {
    correction: 0, review: 0, validated: 0, processing: 1, excluded: 0,
  };
  payload.products = [{
    record_kind: 'candidate',
    candidate_ref: 'SC-000442',
    product_ref: null,
    name: 'Produit fournisseur à analyser',
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-442',
    supplier_category: 'Home > Lighting',
    supplier_name_original: 'Raw supplier product',
    candidate_state: 'raw_imported',
    operator_group: 'processing',
    work_status: 'processing',
    issues: [],
  }];
  payload.registry_page = {
    total: 1, limit: 50, offset: 0, has_previous: false, has_next: false,
  };
  const fetchFn = jest.fn(async () => ({
    ok: true, status: 200, json: async () => payload,
  }));
  await workspace.mount({
    root, document: doc, ui, fetch: fetchFn, location: { search: '' },
  });
  expect(fetchFn.mock.calls[0][0]).toContain('unified=1');
  const row = root.querySelector('[data-candidate-ref="SC-000442"]');
  expect(row).not.toBeNull();
  expect(row.textContent).toContain('Préparation automatique');
  expect(row.textContent).not.toContain('Approuvé Catalogue');
  expect(row.querySelector('[data-workspace-action="approve"]')).toBeNull();
  const inspect = row.querySelector('[data-workspace-action="inspect-candidate"]');
  expect(inspect).not.toBeNull();
  await inspect.click();
  const dossier = root.querySelector('[data-catalog-candidate-inspector="SC-000442"]');
  expect(dossier).not.toBeNull();
  expect(dossier.textContent).toContain('Raw supplier product');
  expect(dossier.textContent).toContain('Lecture seule');
  expect(fetchFn).toHaveBeenCalledTimes(1);
});


test('Catalogue unique : confirmation du classement candidat réutilise la suggestion Sourcing avec grant', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.summary.operator_groups = { correction: 0, review: 1, validated: 0, processing: 0, excluded: 0 };
  payload.products = [{
    record_kind: 'candidate', candidate_ref: 'KSC-000444', product_ref: null,
    name: 'Lampe source', supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-444', supplier_category: 'Home > Lamp',
    candidate_state: 'scanned', sourcing_decision: 'TEST',
    operator_group: 'review', work_status: 'sourcing_review', issues: [],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false };
  const calls = [];
  const fetchFn = jest.fn(async (url, options = {}) => {
    calls.push([url, options]);
    let data = payload;
    if (url.includes('/boutique-category-options')) data = {
      categories: [
        { category: 'maison', category_label: 'Maison', subcategory: 'luminaire', subcategory_label: 'Luminaires' },
        { category: 'tech', category_label: 'Tech', subcategory: 'accessories', subcategory_label: 'Accessoires' },
      ],
      suggestions: [{
        category: 'maison', category_label: 'Maison', subcategory: 'luminaire',
        subcategory_label: 'Luminaires', confidence: 'high', reason: 'Supplier product object',
      }],
    };
    if (url.includes('/confirm-boutique-category'))
      data = { ok: true, result: { confirmed: true, draft_created: true } };
    return { ok: true, status: 200, json: async () => data };
  });
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, location: { search: '' } });
  const row = root.querySelector('[data-candidate-ref="KSC-000444"]');
  await row.querySelector('[data-workspace-action="inspect-candidate"]').click();
  const panel = root.querySelector('[data-catalog-candidate-inspector="KSC-000444"]');
  await panel.querySelector('[data-workspace-action="candidate-boutique-review"]').click();
  const select = panel.querySelector('[data-catalog-candidate-category-choice]');
  expect(select).not.toBeNull();
  expect(select.value).toBe('0');
  expect(select.children[0].textContent).toContain('Proposé');
  const form = panel.querySelector('[data-catalog-candidate-category-form]');
  const sourceFacts = panel.querySelector('[data-catalog-source-details]');
  const dock = panel.querySelector('[data-catalog-action-dock]');
  expect(panel.children.indexOf(dock)).toBeLessThan(panel.children.indexOf(form));
  expect(panel.children.indexOf(form)).toBeLessThan(panel.children.indexOf(sourceFacts));
  await form.listeners.submit[0]({ preventDefault() {} });
  expect(calls.some(([url]) => url.includes('/confirm-boutique-category'))).toBe(true);
  const [postUrl, postOptions] = calls.find(([url]) => url.includes('/confirm-boutique-category'));
  expect(postUrl).toContain('/api/admin/workspaces/sourcing/candidates/KSC-000444/');
  expect(postOptions.method).toBe('POST');
  expect(JSON.parse(postOptions.body)).toEqual({ category: 'maison', subcategory: 'luminaire' });
  expect(calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
});

test('Catalogue unique : candidat en préparation ne propose aucune mutation prématurée', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind: 'candidate', candidate_ref: 'KSC-000445', product_ref: null,
    name: 'Produit importé', candidate_state: 'raw_imported',
    operator_group: 'processing', work_status: 'processing', issues: [],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false };
  const fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, location: { search: '' } });
  const row = root.querySelector('[data-candidate-ref="KSC-000445"]');
  await row.querySelector('[data-workspace-action="inspect-candidate"]').click();
  const panel = root.querySelector('[data-catalog-candidate-inspector="KSC-000445"]');
  expect(panel.textContent).toContain('aucune correction humaine présumée');
  expect(panel.querySelector('[data-workspace-action="candidate-boutique-review"]')).toBeNull();
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test('Catalogue unique : produit remis a correction de catégorie, français et gate de validation dans son panneau', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind: 'product', product_ref: 'KPR-000446', candidate_ref: 'KSC-000446',
    name: 'Produit source', supplier_name: 'CJdropshipping',
    lifecycle_status: 'candidate', is_active: false, work_status: 'taxonomy_to_confirm',
    operator_group: 'correction', issues: ['taxonomy_to_confirm', 'editorial_to_complete'],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false };
  const fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, location: { search: '' } });
  const row = root.querySelector('[data-product-ref="KPR-000446"]');
  expect(row.querySelector('[data-workspace-action="open-catalog-inspector"]')).not.toBeNull();
  await row.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel = root.querySelector('[data-catalog-product-inspector="KPR-000446"]');
  expect(panel.textContent).toContain('Classement Boutique à corriger');
  expect(panel.querySelector('[data-workspace-action="inspector-classify"]')).not.toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-prepare-fr"]')).not.toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-approve"]')).toBeNull();
  expect(fetchFn.mock.calls.map(([url]) => url).filter(url => url.includes('dossier_product_ref=KPR-000446'))).toHaveLength(1);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test('Catalogue unique : le serveur refuse la validation si la certification est incomplète', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind: 'product', product_ref: 'KPR-000447', candidate_ref: 'KSC-000447',
    name: 'Produit prêt', lifecycle_status: 'candidate', is_active: false,
    work_status: 'approval_pending', operator_group: 'review', issues: ['approval_pending'],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false };
  const fetchFn = jest.fn(async url => ({
    ok: true, status: 200,
    json: async () => url.includes('diagnose_product_ref=')
      ? { phase: 'catalog_approval', certification: { certified: false, reasons: ['media_missing'] } }
      : payload,
  }));
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, location: { search: '' } });
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel = root.querySelector('[data-catalog-product-inspector="KPR-000447"]');
  await panel.querySelector('[data-workspace-action="inspector-check-approval"]').click();
  expect(panel.textContent).toContain('À compléter');
  expect(panel.querySelector('[data-workspace-action="inspector-approve"]')).toBeNull();
  const urls=fetchFn.mock.calls.map(([url]) => url);
  expect(urls).toHaveLength(3);
  expect(urls[1]).toContain('dossier_product_ref=KPR-000447');
  expect(urls[2]).toContain('diagnose_product_ref=KPR-000447');
});


test('Catalogue unique : une validation autorisée exige un GET de preuve puis une confirmation humaine', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind: 'product', product_ref: 'KPR-000448', candidate_ref: 'KSC-000448',
    name: 'Produit prêt', lifecycle_status: 'candidate', is_active: false,
    work_status: 'approval_pending', operator_group: 'review', issues: ['approval_pending'],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false };
  const confirm = jest.fn(() => true);
  const fetchFn = jest.fn(async (url, options = {}) => ({
    ok: true, status: 200,
    json: async () => url.includes('diagnose_product_ref=')
      ? { phase: 'catalog_approval', certification: { certified: true, reasons: [] } }
      : options.method === 'POST'
        ? { ok: true, action: 'catalog_candidate_approved', result: { product_ref: 'KPR-000448' } }
        : payload,
  }));
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, confirm, location: { search: '' } });
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel = root.querySelector('[data-catalog-product-inspector="KPR-000448"]');
  expect(panel).not.toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-approve"]')).toBeNull();
  await panel.querySelector('[data-workspace-action="inspector-check-approval"]').click();
  const approve = panel.querySelector('[data-workspace-action="inspector-approve"]');
  expect(approve).not.toBeNull();
  expect(fetchFn.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(0);
  await approve.click();
  expect(confirm).toHaveBeenCalledTimes(1);
  const posts = fetchFn.mock.calls.filter(([, options = {}]) => options.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain('/api/admin/workspaces/catalog/approval/KPR-000448/approve');
  expect(fetchFn.mock.calls.map(([url]) => url).filter(url => url.includes('unified=1'))).toHaveLength(2);
});

test('Catalogue unique : un refus du Sourcing empêche la proposition et toute mutation', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind: 'candidate', candidate_ref: 'KSC-000449', product_ref: null,
    name: 'Source', candidate_state: 'scanned',
    operator_group: 'review', work_status: 'sourcing_review', issues: [],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false };
  const fetchFn = jest.fn(async url => url.includes('/boutique-category-options')
    ? { ok: false, status: 403, json: async () => ({ error: 'Sourcing global requis', code: 'sourcing_global_access_denied' }) }
    : { ok: true, status: 200, json: async () => payload });
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, location: { search: '' } });
  await root.querySelector('[data-workspace-action="inspect-candidate"]').click();
  const panel = root.querySelector('[data-catalog-candidate-inspector="KSC-000449"]');
  await panel.querySelector('[data-workspace-action="candidate-boutique-review"]').click();
  expect(panel.querySelector('[data-catalog-candidate-category-form]')).toBeNull();
  expect(fetchFn.mock.calls.filter(([, opts = {}]) => opts.method === 'POST')).toHaveLength(0);
});

test('Catalogue unifié : médias fournisseur non confondus avec les médias canoniques', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind:'product', product_ref:'KPR-00450', candidate_ref:'KSC-00450',
    name:'Lampe à compléter', lifecycle_status:'candidate', is_active:false,
    work_status:'media_to_complete', operator_group:'correction',
    active_media_count:0, source_media_count:1, media_status:'source_recoverable',
    issues:['media_missing'],
  }];
  payload.registry_page = { total:1, limit:50, offset:0, has_next:false, has_previous:false };
  const fetchFn = jest.fn(async () => ({ok:true,status:200,json:async()=>payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const row = root.querySelector('[data-product-ref="KPR-00450"]');
  expect(row.textContent).toContain('Média canonique à compléter');
  await row.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel = root.querySelector('[data-catalog-product-inspector="KPR-00450"]');
  expect(panel.textContent).toContain('Médias source identifiés');
  expect(panel.textContent).toContain('Médias actifs canoniques');
  expect(panel.textContent).toContain('Réintégration canonique nécessaire');
  expect(fetchFn.mock.calls.map(([url]) => url).filter(url => url.includes('dossier_product_ref=KPR-00450'))).toHaveLength(1);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(panel.querySelector('[data-workspace-action="inspector-approve"]')).toBeNull();
});

test('Catalogue unique : réparation média auditée seulement après consentement, sans approbation', async () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind:'product', product_ref:'KPR-RECOVER', candidate_ref:'KSC-RECOVER',
    name:'Luminaire', lifecycle_status:'candidate', is_active:false,
    work_status:'media_to_complete', operator_group:'correction',
    active_media_count:0, source_media_count:1, media_status:'source_recoverable',
    issues:['media_missing'],
  }];
  payload.registry_page = {total:1, limit:50, offset:0,has_next:false,has_previous:false};
  let approved=false;
  const confirm=jest.fn(()=>approved);
  const fetchFn=jest.fn(async (url,opts={})=>({
    ok:true,status:200,json:async()=>opts.method==='POST'
      ? {ok:true,result:{audit_recorded:true,media_recovered:1,catalog_approved:false}}
      : payload
  }));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,confirm,location:{search:''}});
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel=root.querySelector('[data-catalog-product-inspector="KPR-RECOVER"]');
  const btn=panel.querySelector('[data-workspace-action="inspector-recover-media"]');
  expect(btn).not.toBeNull();
  await btn.click();
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  approved=true;
  await btn.click();
  const posts=fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain('/products/KPR-RECOVER/recover-source-media');
  expect(JSON.parse(posts[0][1].body)).toEqual({});
  expect(fetchFn.mock.calls.filter(([url])=>url.includes('/approve'))).toHaveLength(0);
});

test('Catalogue unique : aperçu fournisseur sans contrat stable ne déclenche aucune réparation', async () => {
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{record_kind:'product',product_ref:'KPR-PREVIEW',name:'Lampe',
    lifecycle_status:'candidate',is_active:false,work_status:'media_to_complete',
    media_status:'preview_only',operator_group:'correction',active_media_count:0,
    source_media_count:0,issues:['media_missing']}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async()=>({ok:true,status:200,json:async()=>payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel=root.querySelector('[data-catalog-product-inspector="KPR-PREVIEW"]');
  expect(panel.textContent).toContain('L’image d’aperçu ne constitue pas une preuve');
  expect(panel.querySelector('[data-workspace-action="inspector-recover-media"]')).toBeNull();
});


test('Catalogue : candidat WATCH visible en surveillance, jamais à valider ni promouvoir', async () => {
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{record_kind:'candidate',candidate_ref:'KSC-WATCH',product_ref:null,
    name:'Source différée',candidate_state:'scanned',sourcing_decision:'WATCH',
    operator_group:'processing',work_status:'sourcing_deferred',issues:[]}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async()=>({ok:true,status:200,json:async()=>payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const row=root.querySelector('[data-candidate-ref="KSC-WATCH"]');
  expect(row.textContent).toContain('Surveillance Sourcing');
  await row.querySelector('[data-workspace-action="inspect-candidate"]').click();
  const panel=root.querySelector('[data-catalog-candidate-inspector="KSC-WATCH"]');
  expect(panel.textContent).toContain('Décision Sourcing différée');
  expect(panel.querySelector('[data-workspace-action="candidate-boutique-review"]')).toBeNull();
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test('Catalogue : cycle de vie contradictoire, dossier lecture seule, zéro validation',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{record_kind:'product',product_ref:'KPR-INCOHERENT',
    candidate_ref:'KSC-INCOHERENT',name:'Fiche historique',
    lifecycle_status:'candidate',is_active:true,
    work_status:'activation_to_reconcile',operator_group:'correction',
    active_media_count:0,source_media_count:1,media_status:'source_recoverable',
    issues:['activation_to_reconcile','source_to_normalize','media_missing']}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async()=>({ok:true,status:200,json:async()=>payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const row=root.querySelector('[data-product-ref="KPR-INCOHERENT"]');
  expect(row.textContent).toContain('Activation d’un candidat');
  await row.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel=root.querySelector('[data-catalog-product-inspector="KPR-INCOHERENT"]');
  expect(panel.textContent).toContain('Activation d’une fiche encore marquée candidate');
  expect(panel.querySelector('[data-workspace-action="inspector-recover-media"]')).toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-approve"]')).toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-classify"]')).toBeNull();
  expect(fetchFn.mock.calls.map(([url]) => url).filter(url => url.includes('dossier_product_ref=KPR-INCOHERENT'))).toHaveLength(1);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});


test('Catalogue unique : WATCH bloqué par catégorie économique — suggestion, validation et scan sans promotion',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{record_kind:'candidate',candidate_ref:'KSC-MISSING-ECON',
    product_ref:null,name:'Adaptateur importé',candidate_state:'scanned',
    sourcing_decision:'WATCH',source_category_review_required:true,
    work_status:'sourcing_category_review',operator_group:'correction',
    issues:['sourcing_economic_category_missing']}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const requests=[];
  const fetchFn=jest.fn(async (url,options={})=>{
    requests.push([url,options]);
    const data=url.includes('/category-options')?{
      categories:[
        {key:'electronics',label:'Électronique'},
        {key:'household',label:'Maison'}],
      suggestions:[{key:'electronics',label:'Électronique',confidence:'high'}],
      source:'customs_categories',
    }:url.includes('/resolve-category')?{
      ok:true,result:{category:{key:'electronics'},scan:{decision:'TEST'}}
    }:payload;
    return {ok:true,status:200,json:async()=>data};
  });
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const row=root.querySelector('[data-candidate-ref="KSC-MISSING-ECON"]');
  expect(row.textContent).toContain('Catégorie économique manquante');
  await row.querySelector('[data-workspace-action="inspect-candidate"]').click();
  const panel=root.querySelector('[data-catalog-candidate-inspector="KSC-MISSING-ECON"]');
  const action=panel.querySelector('[data-workspace-action="candidate-economic-category-review"]');
  expect(action).not.toBeNull();
  await action.click();
  const select=panel.querySelector('[data-catalog-economic-category-choice]');
  expect(select).not.toBeNull();
  expect(select.children[0].textContent).toContain('Proposé');
  const form=panel.querySelector('[data-catalog-economic-category-form]');
  await form.listeners.submit[0]({preventDefault(){}});
  const posts=requests.filter(([,o])=>o.method==='POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain('/api/admin/workspaces/sourcing/candidates/KSC-MISSING-ECON/resolve-category');
  expect(JSON.parse(posts[0][1].body)).toEqual({category_key:'electronics'});
  expect(requests.filter(([url])=>url.includes('/promote')||url.includes('/approve'))).toHaveLength(0);
});


test('Catalogue : absence de suggestion économique ne sélectionne jamais une catégorie arbitraire',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{record_kind:'candidate',candidate_ref:'KSC-NO-SUGGESTION',product_ref:null,
    name:'Objet ambigu',candidate_state:'scanned',sourcing_decision:'WATCH',
    work_status:'sourcing_category_review',operator_group:'correction',
    issues:['sourcing_economic_category_missing']}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async url=>({
    ok:true,status:200,json:async()=>url.includes('/category-options')
      ? {categories:[{key:'first',label:'Première catégorie'},{key:'second',label:'Seconde'}],
         suggestions:[],source:'customs_categories'}:payload
  }));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  await root.querySelector('[data-workspace-action="inspect-candidate"]').click();
  const panel=root.querySelector('[data-catalog-candidate-inspector="KSC-NO-SUGGESTION"]');
  await panel.querySelector('[data-workspace-action="candidate-economic-category-review"]').click();
  const select=panel.querySelector('[data-catalog-economic-category-choice]');
  expect(select.value).toBe('');
  expect(select.children[0].textContent).toContain('aucune suggestion fiable');
  await panel.querySelector('[data-catalog-economic-category-form]')
    .listeners.submit[0]({preventDefault(){}});
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
});

test('Catalogue: la correction française est visible AVANT les coûts et ouvre le vrai formulaire sans écriture automatique', async () => {
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{
    record_kind:'product',product_ref:'KPR-FR-VISIBLE',candidate_ref:'KSC-FR-VISIBLE',
    name:'English privacy screen protector',description:null,content_source:'connector_raw',source_locale:'en',
    lifecycle_status:'candidate',is_active:false,work_status:'editorial_to_complete',
    operator_group:'correction',issues:['editorial_to_complete'],
  }];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async url=>({
    ok:true,status:200,json:async()=>url.includes('dossier_product_ref=')
      ? {product_ref:'KPR-FR-VISIBLE',identity:{
        title_fr:'English privacy screen protector',description_fr:null,
        content_source:'connector_raw',locale:'en',
      }}
      : payload,
  }));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const panel=root.querySelector('[data-catalog-product-inspector="KPR-FR-VISIBLE"]');
  const dock=panel.querySelector('[data-catalog-action-dock]');
  const sourceFacts=panel.querySelector('[data-catalog-source-details]');
  const dossier=panel.querySelector('[data-catalog-product-dossier]');
  expect(dock).not.toBeNull();
  expect(sourceFacts).not.toBeNull();
  expect(panel.querySelector('[data-catalog-economic-summary]')).toBeNull();
  expect(dossier).not.toBeNull();
  expect(sourceFacts.parentNode).toBe(panel.querySelector('[data-catalog-complementary-info]'));
  const additional=panel.querySelector('[data-catalog-complementary-info]');
  expect(additional).not.toBeNull();
  expect(panel.children.indexOf(dock)).toBeLessThan(panel.children.indexOf(additional));
  expect(additional.querySelector('[data-catalog-product-dossier]')).toBe(dossier);
  const buttons=dock.querySelector('.kmc-catalog-inspector-actions');
  const editor=buttons.querySelector('[data-workspace-action="inspector-prepare-fr"]');
  expect(editor).not.toBeNull();
  expect(editor.textContent).toBe('Compléter titre et description FR');
  expect(buttons.children[0]).toBe(editor);
  expect(buttons.querySelector('[data-workspace-action="inspector-classify"]')).toBeNull();
  expect(additional.querySelector('[data-workspace-action="inspector-classify"]')).not.toBeNull();
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  await editor.click();
  expect(root.querySelector('[data-catalog-fr-editor]')).not.toBeNull();
  expect(root.querySelector('[data-workspace-action="save-fr-editor"]')).not.toBeNull();
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
});

test.each([true, false])('Examiner autosave FR : certification serveur=%s, approbation uniquement si conforme', async (certified) => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc = fakeDocument(), root = doc.createElement('main'), ui = fakeUi(doc);
  const payload = workspacePayload([]);
  payload.products = [{
    record_kind: 'product', product_ref: 'KPR-AUTOSAVE-FR', candidate_ref: 'KSC-AUTOSAVE-FR',
    name: 'Earbuds', description: '', content_source: 'connector_raw', source_locale: 'en',
    lifecycle_status: 'candidate', is_active: false, work_status: 'editorial_to_complete',
    operator_group: 'correction', issues: ['editorial_to_complete'],
  }];
  payload.registry_page = { total: 1, limit: 50, offset: 0,
    has_next: false, has_previous: false };
  const confirm = jest.fn(() => true);
  const fetchFn = jest.fn(async (url, options = {}) => {
    let result = payload;
    if (url.includes('dossier_product_ref=')) result = {
      identity: { title_fr: '', description_fr: '', content_source: 'connector_raw', locale: 'en' },
    };
    if (url.includes('diagnose_product_ref=')) result = {
      phase: 'catalog_approval', certification: {
        certified, reasons: certified ? [] : ['media_missing'],
      },
    };
    if (options.method === 'POST') result = { ok: true };
    return { ok: true, status: 200, json: async () => result };
  });
  await workspace.mount({ root, document: doc, ui, fetch: fetchFn, confirm,
    location: { search: '' } });
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  await root.querySelector('[data-workspace-action="inspector-prepare-fr"]').click();
  const editor = root.querySelector('[data-catalog-fr-editor]');
  const title = editor.querySelector('[data-catalog-fr-field="name"]');
  const description = editor.querySelector('[data-catalog-fr-field="description"]');
  expect(editor.querySelector('[data-workspace-action="save-fr-editor"]').hidden).toBe(true);
  title.value = 'Écouteurs Bluetooth sans fil';
  description.value = 'Écouteurs testés et décrits en français.';
  // No Enregistrer or Confirmer click: leaving the field persists the correction.
  await description.listeners.change[0]();
  const requests = fetchFn.mock.calls.map(([url, opts = {}]) => ({ url, opts }));
  const posts = requests.filter(({ opts }) => opts.method === 'POST');
  expect(posts.map(({ url }) => url)).toContain(
    '/api/admin/workspaces/catalog/approval/KPR-AUTOSAVE-FR/prepare-fr'
  );
  expect(requests.some(({ url }) => url.includes('diagnose_product_ref=KPR-AUTOSAVE-FR'))).toBe(true);
  expect(posts.some(({ url }) => url.endsWith('/approve'))).toBe(certified);
  expect(confirm).not.toHaveBeenCalled();
});
