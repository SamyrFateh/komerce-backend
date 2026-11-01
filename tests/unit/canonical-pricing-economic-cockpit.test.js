'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

test('Atelier économique charge la surface cockpit fidèle au mock approuvé', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/pricing-economic-cockpit.js?v=261031-fixed-label-1');
  expect(index).toContain('/dashboards/canonical/css/pricing-economic-cockpit.css?v=261023-1');
  expect(source).toContain('Charges structurelles à couvrir');
  expect(source).toContain('Coûts variables');
  expect(source).toContain('Charges fixes directes');
  expect(source).toContain('Charges fixes mutualisées');
  expect(source).toContain('Portefeuille produits');
  expect(source).toContain('Sensibilité prix');
  expect(source).toContain('Données marché');
  expect(source).toContain('Montant / mois');
  expect(source).toContain('Coût global');
  expect(source).toContain('Prix retenu');
  expect(source).not.toContain('Affiner les observations marché');
  expect(source).not.toContain('Prix final marché retenu');
  expect(css).toContain('.kmc-cockpit-costs');
  expect(css).toContain('.kmc-cockpit-portfolio-table');
  expect(css).toContain('.kmc-cockpit-detail-grid');
  expect(css).toContain('MOCK PARITY FINAL');
  expect(css).toContain('background: #0b84f3');
  expect(source).toContain('options.root.replaceChildren(cockpit)');
  expect(source).toContain("options.root.dataset.pricingMockContract = 'exclusive'");
  expect(source).not.toContain('outerAdvancedNodes');
  expect(source).not.toContain('pricingCockpitLegacyHidden');
  expect(source).not.toContain('createAdvancedDetails');
  expect(source).not.toContain('advanced.open');
  // Au refresh, l'ancien pricing-workspace ne doit jamais peindre le root visible.
  expect(source).toContain("const stagingRoot = options.document.createElement('div')");
  expect(source).toContain('const payload = await originalMount({ ...options, root: stagingRoot })');
  expect(source).toContain('await enhance(rootObject, workspace, options, payload)');
  expect(source).not.toContain('const payload = await originalMount(options)');
  expect(source).not.toContain('findWorkshop');
});

test('mutualisé reste un périmètre et peut être variable ou fixe', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  expect(source).toContain("economicNature(component) === 'variable'");
  expect(source).toContain("economicNature(component) === 'fixed' && allocationPerimeter(component) === 'direct'");
  expect(source).toContain("economicNature(component) === 'fixed' && allocationPerimeter(component) === 'mutualized'");
  expect(source).toContain('Toute quote-part mutualisée est calculée par Market ID');
});

test('les valeurs calculées sont grisées et le prix final marché est le levier produit', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');
  expect(source).toContain('Coûts variables hors achat');
  expect(source).toContain('economics.variable_cost_outside_purchase_kmf');
  expect(source).toContain("'Prix retenu'");
  expect(source).toContain('dataset.finalMarketPrice');
  expect(source).toContain('Les ajustements sont enregistrés automatiquement. Les valeurs grisées sont calculées par le moteur');
  expect(css).toContain('.kmc-cockpit-cell.is-derived');
  expect(css).toContain('.kmc-cockpit-final-price');
  expect(source).not.toMatch(/variable_cost_complete_kmf\s*-\s*.*purchase/i);
});

test('le cockpit lit corridor, décision et quotes-parts serveur sans fallback pays silencieux', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  expect(source).toContain('/corridor?product_ref=');
  expect(source).toContain('`${endpoint}/decision${qs}`');
  expect(source).toContain("period ? `?period=${encodeURIComponent(period)}` : ''");
  expect(source).toContain('decision?.coverage?.structure');
  expect(source).toContain('charge.market_share_kmf');
  expect(source).toContain('Quote-part marché');
  expect(source).toContain('point?.economics?.contribution_unit_kmf');
  expect(source).toContain('Référence globale (informative)');
  expect(source).toContain('Non utilisée comme vérité locale.');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
});

test('trois familles : même édition sur la ligne, N3 audité et mutualisé par autorité globale', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const panel = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-structure-event-panel.js'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');

  expect(source).toContain("row.dataset.inlineCostRow = item.editKey");
  expect(source).toContain("row.dataset.inlineStructureRow = String(item.chargeId)");
  expect(source).toContain("edit.dataset.editStructureCharge");
  expect(source).toContain("edit.dataset.structureScope");
  expect(source).toContain('inline: Boolean(inlineOptions?.inlineContainer)');
  expect(source).toContain("payload.capabilities?.can_manage_structure_events === true");
  expect(source).toContain("payload.access?.role === 'global_admin'");
  expect(source).toContain("const basePath = isMutualized ? globalEndpoint : marketEndpoint;");
  expect(source).toContain("card.dataset.readOnly = String(!canManageGroup)");
  expect(source).toContain("expand.closest('[data-cost-summary]')");

  expect(panel).toContain("overlay.dataset.structureInlineEditor");
  expect(panel).toContain("built.form.requestSubmit()");
  expect(panel).toContain("Une référence de preuve est obligatoire.");
  expect(panel).toContain("Options avancées · devise, source, notes");
  expect(index).toContain('/dashboards/canonical/js/pricing-structure-event-panel.js');
  expect(index).toContain('/dashboards/canonical/css/pricing-structure-event-panel.css');
});

test('Moteur économique : édition par ligne, Valeur/Provenance en détail', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../../public/dashboards/canonical');
  const source = fs.readFileSync(path.join(dir, 'js/pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'css/pricing-economic-cockpit.css'), 'utf8');
  expect(source).toContain('dataset.inlineCostForm');
  expect(source).toContain('kmc-economic-family-grid');
  expect(source).toContain("'Valeur', 'Provenance'");
  expect(source).toContain("'Surcharge pays'");
  expect(source).toContain('kmc-cockpit-secondary');
  expect(source).toContain('economicPreview');
  expect(css).toContain('.kmc-cockpit-secondary');
});

test('formulaire : statut serveur et sécurités de validation', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/pricing-economic-cockpit.js'), 'utf8');
  expect(src).toContain('dataset.editInlineCost');
  expect(src).toContain('dataset.inlineCostForm');
  expect(src).toContain('Valeur invalide : rien n’a été enregistré');
});

test('familles : colonnes stables et édition contextuelle', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/css/pricing-economic-cockpit.css'), 'utf8');
  const enhanced = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/css/pricing-atelier-views.css'), 'utf8');
  expect(enhanced).toContain('.kmc-economic-family-grid');
  expect(enhanced).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
  expect(enhanced).toContain('kmc-inline-cost-form');
  expect(enhanced).toContain('kmc-economic-family-preview-row');
});

test('trois colonnes : un libellé, la dernière valeur, une action ou un état lecture seule, sans masque au détail', () => {
  const js = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-atelier-views.css'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  expect(js).toContain("const preview = el(doc, 'div', 'kmc-economic-family-preview')");
  expect(js).toContain("item.readOnly");
  expect(js).toContain("kmc-inline-cost-readonly");
  expect(js).toContain("readOnlyHint");
  expect(js).toContain("edit.dataset.editInlineCost");
  expect(js).toContain("edit.dataset.editStructureCharge");
  expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(80px, auto) 79px;');
  expect(css).toContain('grid-column: 3;');
  expect(css).toContain('grid-column: auto;');
  expect(css).toContain('overflow-x: auto;');
  expect(index).toContain('pricing-atelier-views.css?v=261031-fixed-label-1');
  expect(index).toContain('pricing-economic-cockpit.js?v=261031-fixed-label-1');
});

test('ajustements : enregistrement automatique (prix à la validation, coûts par champ), jamais à la frappe ni vide', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/pricing-economic-cockpit.js'), 'utf8');
  expect(src).toContain("cockpit.addEventListener('change'");
  expect(src).toContain('form.requestSubmit()');
  expect(src).toContain("form.addEventListener('change'");
  expect(src).toContain('valeur non enregistrée');
  expect(src).toContain('Montant invalide : prix non enregistré.');
});

test('Atelier des prix : aucun bouton « Ajouter un produit » (la création relève du Catalogue)', () => {
  const dir = require('path').join(__dirname, '../../public/dashboards/canonical');
  const src = require('fs').readFileSync(require('path').join(dir, 'js/pricing-economic-cockpit.js'), 'utf8');
  expect(src).not.toContain('Ajouter un produit');
  expect(src).not.toContain('create-product');
});

describe('L4 — unité par valeur, signe, prix non décidé, applicabilité des frais', () => {
  const cockpit = require('../../public/dashboards/canonical/js/pricing-economic-cockpit.js');
  function node(tag) {
    return { tag, className: '', textContent: '', children: [], dataset: {}, attributes: {},
      get lastChild() { return this.children[this.children.length - 1]; },
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener() {} };
  }
  const doc = { createElement: node };
  const row = (corridor) => cockpit.portfolioProductRow(doc, { product_ref: 'P1', name: 'Coque' }, corridor);
  const norm = t => String(t).replace(/[\u202f\u00a0]/g, ' ');
  const cells = r => r.children.map(c => norm(c.textContent));
  const base = (market, economics, selected = {}) => ({
    market, product: { purchase_cost_kmf: 4000 },
    corridor: { local: { low: { observed_amount: 9, currency: market.currency }, target: { observed_amount: 10, currency: market.currency }, high: null } },
    selected: { economics, ...selected },
  });

  test('en-têtes : aucune unité imposée (chaque valeur porte la sienne)', () => {
    const head = cockpit.portfolioHeader ? cockpit.portfolioHeader(doc) : null;
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/pricing-economic-cockpit.js'), 'utf8');
    expect(src).not.toMatch(/'Prix retenu\\n\(FCFA\)'|\(FCFA\)/);
    expect(head === null || head.children.every(c => !/FCFA/.test(c.textContent))).toBe(true);
  });

  test('CM : bornes et prix en XAF, coûts en KMF, prix absent = « Non décidé » (jamais price_kmf)', () => {
    const r = row(base({ currency: 'XAF' }, { contribution_unit_kmf: -429 }, { price_kmf: 6000 }));
    const text = cells(r);
    expect(text).toContain('4 000 KMF');
    expect(text.some(t => /XAF$/.test(t))).toBe(true);
    const price = norm(r.children[7].children[0].textContent);
    expect(price).toMatch(/^Non décidé/);
    expect(price).not.toMatch(/6\s?000/);
  });

  test('prix local décidé : affiché dans la devise du marché (DJ -> DJF)', () => {
    const r = row(base({ currency: 'DJF' }, { contribution_unit_kmf: 1342 }, { local_amount: 12500, local_currency: 'DJF' }));
    expect(norm(r.children[7].children[0].textContent)).toMatch(/12 500 DJF/);
  });

  test('contribution : négative = critique, nulle = neutre, positive = ton nominal ; total jamais calculé ici', () => {
    const tone = c => r => r.children[8].className;
    expect(tone()(row(base({ currency: 'KMF' }, { contribution_unit_kmf: -429, quantity_sold: 3 })))).toContain('is-negative');
    expect(tone()(row(base({ currency: 'KMF' }, { contribution_unit_kmf: 0 })))).toContain('is-zero');
    const pos = row(base({ currency: 'KMF' }, { contribution_unit_kmf: 1342, quantity_sold: 3 }));
    expect(pos.children[8].className).not.toMatch(/is-negative|is-zero/);
    expect(pos.children[10].textContent).toBe('—');
    expect(row(base({ currency: 'KMF' }, { contribution_unit_kmf: 1342 })).children[9].textContent).toBe('—');
  });

  test('frais de paiement hérités du global : « Applicabilité non vérifiée pour ce marché » ; surcharge pays : non', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/pricing-economic-cockpit.js'), 'utf8');
    expect(src).toContain("component.inherited === true && component.category === 'payment'");
    expect(src).toContain('Applicabilité non vérifiée pour ce marché');
  });

  test('enregistrement : message unique (automatique), plus de bouton « Enregistrer maintenant »', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/pricing-economic-cockpit.js'), 'utf8');
    expect(src).toContain('enregistrés automatiquement');
    expect(src).not.toContain('Enregistrer maintenant');
    expect(src).not.toContain('cockpitSaveAll');
  });
});
