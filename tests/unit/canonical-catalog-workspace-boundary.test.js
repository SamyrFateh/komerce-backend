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
  expect(index).toContain('/dashboards/canonical/js/catalog-workspace.js?v=261102-arbitration-1');
  expect(index).toContain('/dashboards/canonical/css/operations-workspace.css?v=261031-2');
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
  // The legacy commercial table is gone; the focused route to market pricing is preserved.
  expect(workspace).not.toContain('Marchés approuvés');
  expect(workspace).toContain('Continuer la mise en vente');
  expect(workspace).toContain('renderFocusedHandoff(rootNode, ui, doc, payload)');
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

test('Catalogue maître : une proposition FR et une correction contextuelle sans prépublication', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('Copier pour ChatGPT');
  expect(workspace).toContain('Coller la réponse');
  expect(workspace).toContain('openFrenchEditor');
  expect(workspace).toContain('/prepare-fr');
  expect(workspace).toContain('Appliquer la proposition');
  expect(workspace).not.toContain('function renderApproval(');
});

test('Catalogue maître : le registre identifie même les candidats sans KPR et conserve le contexte', () => {
  const workspace=read('public/dashboards/canonical/js/catalog-workspace.js');
  const decision=read('public/dashboards/canonical/js/catalog-workspace-decision.js');
  expect(workspace).toContain("text(doc, row.product_ref ? 'a' : 'span'");
  expect(workspace).toContain("params.set('product_ref', context.focusedProductRef)");
  expect(workspace).toContain('openCandidateInspector(context, slot, doc, row)');
  expect(decision).toContain('requestedProductRef');
});

test('Catalogue conserve un relais visible vers la décision marché après publication', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('Suite commerciale');
  expect(workspace).toContain('Publication Catalogue terminée · décision commerciale marché encore requise.');
  expect(workspace).toContain('/dashboards/canonical/market-catalog.html?');
  expect(workspace).toContain('product_ref');
});

test('Catalogue maître : la correction se fait dans le registre et pas dans une seconde file Raffinerie', () => {
  const workspace=read('public/dashboards/canonical/js/catalog-workspace.js');
  const css=read('public/dashboards/canonical/css/operations-workspace.css');
  expect(workspace).toContain('function renderProducts(');
  expect(workspace).toContain('function openCandidateInspector(');
  expect(workspace).toContain('function openProductInspector(');
  expect(workspace).toContain('renderRefineryMonitoring(');
  expect(workspace).not.toContain('function renderApproval(');
  expect(css).toContain('position: sticky');
});

test('Catalogue : préparation FR assistée et sans API IA payante', () => {
  const workspace=read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('Copier pour ChatGPT');
  expect(workspace).toContain('Aucun appel API depuis Komerce');
  expect(workspace).toContain('parseFrenchAssistantOutput');
  expect(workspace).toContain('globalThis.Translator');
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

test('la réponse ChatGPT se transforme automatiquement en champs FR', () => {
  const workspace = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace.parseFrenchAssistantOutput(
    '**Titre FR:** Haut homme décontracté à col montant\n**Description FR:** Vêtement pour extérieur et travail, préparé à partir de la source fournisseur.'
  )).toEqual({
    name: 'Haut homme décontracté à col montant',
    description: 'Vêtement pour extérieur et travail, préparé à partir de la source fournisseur.',
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

test('Catalogue global : les décisions commerciales sont dirigées vers Catalogue pays', () => {
  const workspace=read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain('Décisions marchés');
  expect(workspace).toContain('/dashboards/canonical/market-catalog.html?product_ref=');
  expect(workspace).not.toContain('function renderApproval(');
});

test('Catalogue affiche les raisons de certification lisibles au lieu du seul 422 générique', () => {
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain("error.reasons = Array.isArray(body.reasons)");
  expect(workspace).toContain("boutique_subcategory_missing: 'sous-catégorie Boutique absente'");
  expect(workspace).toContain("media_missing: 'média Catalogue absent'");
  expect(workspace).toContain('actionErrorMessage(error)');
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
  expect(row.textContent).not.toContain('Préparation automatique');
  expect(row.textContent).not.toContain('Classement boutique à confirmer');
  expect(row.textContent).toContain('Voir la source');
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
  expect(panel.textContent).toContain('À compléter');
  expect(panel.querySelector('[data-catalog-inline-editor]')).not.toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-classify"]')).not.toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-prepare-fr"]')).not.toBeNull();
  expect(panel.querySelector('[data-workspace-action="inspector-approve"]')).toBeNull();
  expect(fetchFn.mock.calls.map(([url]) => url).filter(url => url.includes('dossier_product_ref=KPR-000446'))).toHaveLength(1);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test('Finaliser un candidat prêt : blocage serveur visible, aucun POST si non certifié',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{
    record_kind:'product',product_ref:'KPR-000447',candidate_ref:'KSC-000447',
    name:'Produit prêt',lifecycle_status:'candidate',is_active:false,
    work_status:'approval_pending',operator_group:'review',issues:['approval_pending']
  }];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async(url,opts={})=>({
    ok:true,status:200,json:async()=>url.includes('diagnose_product_ref=')
      ? {phase:'catalog_approval',certification:{certified:false,reasons:['media_missing']}}
      : payload
  }));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const button=root.querySelector('[data-workspace-action="open-catalog-inspector"]');
  expect(button.textContent).toBe('Finaliser');
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  await button.click();
  const panel=root.querySelector('[data-catalog-product-inspector="KPR-000447"]');
  expect(panel).not.toBeNull();
  expect(panel.textContent).toContain('Encore nécessaire');
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
});

test('Finalisation candidate certifiée : GET, approbation auditée, rafraîchissement sans deuxième confirmation',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  let approved=false;
  payload.products=[{
    record_kind:'product',product_ref:'KPR-000448',candidate_ref:'KSC-000448',
    name:'Produit prêt',lifecycle_status:'candidate',is_active:false,
    work_status:'approval_pending',operator_group:'review',issues:['approval_pending']
  }];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const confirm=jest.fn(()=>true);
  const fetchFn=jest.fn(async(url,opts={})=>{
    let data=payload;
    if(url.includes('diagnose_product_ref='))data={phase:'catalog_approval',
      certification:{certified:true,reasons:[]}};
    else if(opts.method==='POST'){
      approved=true;data={ok:true,action:'catalog_candidate_approved'};
    }else if(approved){
      data={...payload,products:[{...payload.products[0],lifecycle_status:'active',
        is_active:true,work_status:'catalog_approved',operator_group:'validated',
        approval_audited:true,issues:[]}]};
    }
    return {ok:true,status:200,json:async()=>data};
  });
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,confirm,location:{search:''}});
  const button=root.querySelector('[data-workspace-action="open-catalog-inspector"]');
  expect(button.textContent).toBe('Finaliser');
  await button.click();
  expect(confirm).not.toHaveBeenCalled();
  const calls=fetchFn.mock.calls;
  expect(calls.filter(([url])=>url.includes('diagnose_product_ref='))).toHaveLength(1);
  const posts=calls.filter(([,opts={}])=>opts.method==='POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toContain('/api/admin/workspaces/catalog/approval/KPR-000448/approve');
  const refreshed=root.querySelector('[data-product-ref="KPR-000448"]');
  expect(refreshed.querySelector('[data-workspace-action="open-catalog-inspector"]').textContent)
    .toBe('Dossier produit');
});

test.each([
 ['catalog_approved_inactive','validated','Dossier produit'],
 ['approval_to_review','review','Voir fiche']
])('Correction terminée et produit désactivé : %s ne dit plus Compléter',async(status,group,expected)=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.products=[{
    record_kind:'product',product_ref:'KPR-000086',candidate_ref:'KSC-000086',
    name:'Protection téléphone FR',source_locale:'fr',content_source:'manual',
    lifecycle_status:'active',is_active:false,approval_audited:status==='catalog_approved_inactive',
    work_status:status,operator_group:group,issues:[]
  }];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async()=>({ok:true,status:200,json:async()=>payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const row=root.querySelector('[data-product-ref="KPR-000086"]');
  const button=row.querySelector('[data-workspace-action="open-catalog-inspector"]');
  expect(button.textContent).toBe(expected);
  expect(row.textContent).not.toContain('Compléter');
  expect(row.textContent).not.toContain('Contrôler les prérequis');
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
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
  expect(row.textContent).not.toContain('Média canonique à compléter');
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
  expect(row.textContent).not.toContain('Surveillance Sourcing');
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
  expect(row.textContent).not.toContain('Activation d’un candidat');
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
    requires_arbitration:true,issues:['sourcing_economic_category_missing']}];
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
  expect(row.textContent).toContain('Choisir une famille de calcul');
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
    requires_arbitration:true,issues:['sourcing_economic_category_missing']}];
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

test('KPR-000088: fiche source inactive FR a des champs directs et une catégorie modifiable',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.categories=[
    {key:'tech',label:'Tech',is_active:true,subcategories:[
      {key:'phone',label:'Téléphones',is_active:true},
      {key:'accessories',label:'Accessoires',is_active:true}
    ]},
    {key:'pet',label:'Animaux',is_active:true,subcategories:[
      {key:'pet-bedding',label:'Couchages',is_active:true}]}
  ];
  payload.products=[{
    record_kind:'product',product_ref:'KPR-000088',candidate_ref:'KSC-000169',
    name:'3Pcs Privacy Hydrogel Film',description:null,content_source:'connector_raw',source_locale:'en',
    boutique_category_key:'tech',boutique_subcategory_key:'phone',
    lifecycle_status:'active',is_active:false,work_status:'editorial_to_complete',
    operator_group:'correction',issues:['editorial_to_complete']
  }];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async(url,opts={})=>({
    ok:true,status:200,json:async()=>opts.method==='POST'?{ok:true,result:{}}:payload
  }));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const launch=root.querySelector('[data-workspace-action="open-catalog-inspector"]');
  expect(launch.textContent).toBe('Voir fiche');
  await launch.click();
  const panel=root.querySelector('[data-catalog-product-inspector="KPR-000088"]');
  expect(panel.textContent).not.toContain('Situation :');
  expect(panel.textContent).not.toContain('Aucune correction à apporter');
  expect(panel.querySelector('[data-catalog-inline-editor]')).not.toBeNull();
  const title=panel.querySelector('[data-catalog-quick-field="name"]');
  const description=panel.querySelector('[data-catalog-quick-field="description"]');
  expect(title).not.toBeNull();expect(description).not.toBeNull();
  expect(title.value).toContain('Film de protection d’écran hydrogel anti-espion');
  expect(description.value).toContain('protection d’écran hydrogel anti-espion');
  expect(panel.querySelector('[data-catalog-french-proposal-note]')).not.toBeNull();
  const proposal=panel.querySelector('[data-workspace-action="apply-catalog-fr-proposal"]');
  expect(proposal).not.toBeNull();
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  const cat=panel.querySelector('[data-catalog-quick-category]');
  const sub=panel.querySelector('[data-catalog-quick-subcategory]');
  expect(cat.value).toBe('tech');expect(sub.value).toBe('phone');
  expect(panel.querySelector('[data-catalog-subcategory-summary]').textContent)
    .toContain('2 sous-catégories de Tech');
  expect(panel.querySelectorAll('[data-catalog-subcategory-option]')).toHaveLength(2);
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  title.value='Film de protection hydrogel pour smartphone';
  description.value='Film de protection transparent compatible avec les téléphones indiqués.';
  await description.listeners.change[0]();
  const posts=fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe('/api/admin/workspaces/catalog/products/KPR-000088/update');
  expect(JSON.parse(posts[0][1].body)).toEqual({
    name:'Film de protection hydrogel pour smartphone',
    description:'Film de protection transparent compatible avec les téléphones indiqués.'
  });
  expect(posts[0][0]).not.toContain('/approve');
});

test('Catégorie Boutique: sélection directe auditée et pas de mutation à la seule ouverture',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.categories=[{key:'tech',label:'Tech',is_active:true,subcategories:[
    {key:'phone',label:'Téléphones',is_active:true},{key:'accessories',label:'Accessoires',is_active:true}
  ]}];
  payload.products=[{record_kind:'product',product_ref:'KPR-CAT-DIRECT',candidate_ref:'KSC-CAT-DIRECT',
    name:'Écran protecteur',content_source:'manual',source_locale:'fr',
    lifecycle_status:'candidate',is_active:false,work_status:'taxonomy_to_confirm',
    boutique_category_key:'tech',boutique_subcategory_key:'phone',
    issues:['taxonomy_to_confirm'],operator_group:'correction'}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async(url,opts={})=>({
    ok:true,status:200,json:async()=>opts.method==='POST'?{ok:true}:payload
  }));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const cat=root.querySelector('[data-catalog-quick-category]');
  const sub=root.querySelector('[data-catalog-quick-subcategory]');
  expect(cat.value).toBe('tech');
  expect(root.querySelector('[data-catalog-subcategory-summary]').textContent)
    .toContain('2 sous-catégories de Tech');
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  const choice=root.querySelector('[data-catalog-subcategory-option="accessories"]');
  expect(choice).not.toBeNull();
  await choice.click();
  expect(sub.value).toBe('accessories');
  const posts=fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST');
  expect(posts[0][0]).toContain('/products/KPR-CAT-DIRECT/classify');
  expect(JSON.parse(posts[0][1].body)).toEqual({category:'tech',subcategory:'accessories'});
});

test('Proposition FR longue, sans description fournisseur : un clic suffit, aucune sauvegarde à ouverture',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.categories=[{key:'tech',label:'Tech',is_active:true,subcategories:[
    {key:'phone',label:'Téléphones',is_active:true}
  ]}];
  payload.products=[{record_kind:'product',product_ref:'KPR-000088',candidate_ref:'KSC-000169',
    name:'3Pcs Privacy Hydrogel Film For Vivo V30 V40 V50 V60 V70 SE Pro Lite 4G 5G For Vivo V40E V60e V70 FE Anti-Spy Screen Protector',
    description:null,source_locale:'en',content_source:'connector_raw',
    lifecycle_status:'active',is_active:false,work_status:'editorial_to_complete',
    operator_group:'correction',issues:['editorial_to_complete'],
    boutique_category_key:'tech',boutique_subcategory_key:'phone'}];
  payload.registry_page={total:1,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async(url,opts={})=>({ok:true,status:200,
    json:async()=>opts.method==='POST'?{ok:true}:payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  await root.querySelector('[data-workspace-action="open-catalog-inspector"]').click();
  const title=root.querySelector('[data-catalog-quick-field="name"]');
  const desc=root.querySelector('[data-catalog-quick-field="description"]');
  expect(title.value).toContain('V40E');
  expect(title.value).toContain('lot de 3');
  expect(desc.value).toContain('Compatibilité exacte à vérifier');
  expect(fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST')).toHaveLength(0);
  const action=root.querySelector('[data-workspace-action="apply-catalog-fr-proposal"]');
  expect(action).not.toBeNull();
  await action.click();
  const posts=fetchFn.mock.calls.filter(([,opts={}])=>opts.method==='POST');
  expect(posts).toHaveLength(1);
  const body=JSON.parse(posts[0][1].body);
  expect(body.name).toEqual(title.value);
  expect(body.description).toEqual(desc.value);
  expect(body.description).not.toContain('lorem ipsum');
});

test('Ancienne URL Raffinerie : arrive sur le Catalogue maître, diagnostic séparé et lecture seule', async () => {
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(), root=doc.createElement('main'), ui=fakeUi(doc);
  const fetch=jest.fn(async ()=>({ok:true,status:200,json:async()=>workspacePayload([])}));
  await workspace.mount({location:{search:'?view=refinery'},root,document:doc,ui,fetch});
  expect(root.textContent).toContain('Catalogue global');
  expect(root.textContent).not.toContain('Produits actifs à réexaminer');
  expect(root.querySelector('[data-workspace-action="refinery-correct-active-fr"]')).toBeNull();
  expect(fetch.mock.calls.every(([, options])=>!options||options.method!=='POST')).toBe(true);
  expect(workspace.scheduleAutoFrenchPreparation({
    workspaceView:'catalog',autoFrenchRunning:false,autoFrenchAttempted:new Set(),
    autoFrenchFailed:new Set(),
  },{approval:[]})).toBe(false);
});

test('Catalogue : affiche seulement les vraies décisions et filtre côté serveur',async()=>{
  const workspace=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const doc=fakeDocument(),root=doc.createElement('main'),ui=fakeUi(doc);
  const payload=workspacePayload([]);
  payload.summary.operator_groups={correction:1,review:1,validated:0,processing:2,excluded:0};
  payload.summary.operator_arbitrations=1;
  payload.products=[
    {record_kind:'candidate',candidate_ref:'SC-TECH',name:'Candidat en cours',
      work_status:'processing',operator_group:'processing',requires_arbitration:false,issues:[]},
    {record_kind:'candidate',candidate_ref:'SC-DECISION',name:'Produit ambigu',
      work_status:'sourcing_review',operator_group:'review',requires_arbitration:true,issues:[]},
    {record_kind:'product',product_ref:'KPR-PROOF',name:'Preuve ancienne',
      work_status:'approval_to_review',operator_group:'review',requires_arbitration:false,issues:[]},
  ];
  payload.registry_page={total:3,limit:50,offset:0,has_next:false,has_previous:false};
  const fetchFn=jest.fn(async()=>({ok:true,status:200,json:async()=>payload}));
  await workspace.mount({root,document:doc,ui,fetch:fetchFn,location:{search:''}});
  const technical=root.querySelector('[data-candidate-ref="SC-TECH"]');
  const decision=root.querySelector('[data-candidate-ref="SC-DECISION"]');
  const proof=root.querySelector('[data-product-ref="KPR-PROOF"]');
  expect(technical.textContent).not.toContain('À examiner');
  expect(technical.textContent).not.toContain('Candidat fournisseur · aucune validation Catalogue');
  expect(decision.textContent).toContain('Valider le classement Boutique');
  expect(proof.textContent).not.toContain('Preuve d’approbation Catalogue à régulariser');
  const quick=root.querySelectorAll('.kmc-catalog-quick-chip').find(x=>x.textContent.includes('À arbitrer'));
  expect(quick.textContent).toContain('1');
  await quick.click();
  const requested=fetchFn.mock.calls.map(([url])=>String(url));
  expect(requested.some(url=>url.includes('status=arbitration'))).toBe(true);
});
