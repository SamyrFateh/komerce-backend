'use strict';
// Isolated Chromium proof: true Catalogue JS/CSS with read-only fixture data.
// No Railway access and no business POST is permitted.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'test-results/catalog-contextual-1440');
fs.mkdirSync(output, { recursive: true });

const catalog = {
  scope: { mode: 'global_catalog_registry' },
  summary: { operator_groups: { correction: 1, review: 1, validated: 1, processing: 1, excluded: 0 } },
  categories: [{ key: 'maison', label: 'Maison', is_active: true, subcategories: [
    { key: 'luminaire', label: 'Luminaire', is_active: true },
    { key: 'decor', label: 'Décoration', is_active: true },
  ] }, { key: 'tech', label: 'Tech', is_active: true, subcategories: [
    { key: 'phone', label: 'Téléphones', is_active: true },
    { key: 'phone-accessories', label: 'Accessoires téléphone', is_active: true },
  ] }],
  products: [
    { record_kind: 'candidate', candidate_ref: 'KSC-TEST-RAW',
      product_ref: null, name: 'Produit source reçu', supplier_name: 'CJdropshipping',
      candidate_state: 'raw_imported', operator_group: 'processing',
      work_status: 'processing', issues: [] },
    { record_kind: 'candidate', candidate_ref: 'KSC-TEST-READY',
      product_ref: null, name: 'Lampe LED de bureau', supplier_name: 'CJdropshipping',
      supplier_product_id: 'CJ-LED', supplier_category: 'Home > Lighting',
      supplier_name_original: 'LED Desk Lamp', supplier_description: 'Desk lamp',
      candidate_state: 'scanned', sourcing_decision: 'TEST', sourcing_confidence: 'high',
      operator_group: 'review', work_status: 'sourcing_review', issues: [] },
    { record_kind: 'candidate', candidate_ref: 'KSC-ECON-REVIEW',
      product_ref: null, name: 'Accessoire à classifier', supplier_name: 'CJdropshipping',
      supplier_product_id: 'CJ-CAT', supplier_category: 'Electronics > Cables',
      candidate_state: 'scanned', sourcing_decision: 'WATCH',
      source_category_review_required: true, operator_group: 'correction',
      work_status: 'sourcing_category_review',
      issues: ['sourcing_economic_category_missing'] },
    { record_kind: 'product', product_ref: 'KPR-TEST-DRAFT',
      candidate_ref: 'KSC-TEST-DRAFT', name: 'Lampe LED brouillon',
      supplier_name: 'CJdropshipping', supplier_category: 'Home > Lighting',
      name_source: 'LED desk lamp', description_source: 'Adjustable LED desk lamp.',
      source_locale: 'en', content_source: 'connector_raw',
      lifecycle_status: 'candidate', is_active: false, needs_review: false,
      work_status: 'taxonomy_to_confirm', operator_group: 'correction',
      active_media_count: 0, total_media_count: 0, source_media_count: 1,
      media_status: 'source_recoverable',
      issues: ['taxonomy_to_confirm','editorial_to_complete','media_missing'] },
    { record_kind: 'product', product_ref: 'KPR-000088',
      candidate_ref: 'KSC-000169', name: '3Pcs Privacy Hydrogel Film For Vivo V30 V40 V50 V60 V70 SE Pro Lite 4G 5G For Vivo V40E V60e V70 FE Anti-Spy Screen Protector',
      supplier_name: 'AliExpress', source_locale: 'en', content_source: 'connector_raw',
      boutique_category_key: 'tech', boutique_subcategory_key: 'phone',
      lifecycle_status: 'active', is_active: false, work_status: 'editorial_to_complete',
      operator_group: 'correction', issues: ['editorial_to_complete'] },
    { record_kind: 'product', product_ref: 'KPR-TEST-APPROVED', name: 'Luminaire validé',
      supplier_name: 'CJdropshipping', boutique_category_key: 'maison',
      boutique_subcategory_key: 'luminaire', boutique_category_label: 'Maison',
      boutique_subcategory_label: 'Luminaire',
      lifecycle_status: 'active', is_active: true, needs_review: false,
      work_status: 'catalog_approved', operator_group: 'validated', issues: [] },
  ],
  registry_page: { total: 6, limit: 50, offset: 0, has_previous: false, has_next: false },
  commercial_products: [], approval: [], approval_page: { total: 0 },
  curation: {}, pricing_parameters: {}, commercial: {}, approval_breakdown: {},
};

const dossierFixture = {
  'KPR-TEST-DRAFT': {
    product_ref:'KPR-TEST-DRAFT',
    identity:{title_fr:'Lampe LED de bureau',description_fr:'Lampe LED articulée pour un bureau.',
      locale:'fr',content_source:'manual',needs_review:false,customs_category:'household',
      boutique_category_key:'maison',boutique_subcategory_key:'luminaire',taxonomy_active:true},
    supplier:{name:'CJdropshipping',reference:'CJ-LED',source_contract_v2:true,sourcing_decision:'TEST'},
    availability:{lifecycle_status:'candidate',is_active:false,is_available:false,
      inventory_model:'SKU',stock:999,stock_is_authoritative:false,
      has_variants:true,weight_kg:0.8,dimensions_cm:'25 x 15 x 10',
      fragility:'low',requires_secure_transport:false},
    purchasing:{active_supplier_skus:1,complete_supplier_skus:1,supplier_identity_complete:true},
    media:{active_canonical:1,gallery:[{url:'https://img.komerce.test/lamp.svg',
      alt:'Lampe LED blanche',role:'PRODUCT'}],gallery_truncated:false},
    variants:{inventory_model:'SKU',stock_semantics:'sellable_sku',truncated:false,
      rows:[{sku:'LAMP-WHITE',supplier_sku:'CJ-WHITE',supplier_unit_ref:'CJ-U-1',
        variant_combo:{couleur:'Blanc'},stock:6,is_active:true}]},
    economics:{reference_cost_kmf:1800,reference_price_kmf:2990,reference_price_is_market_decision:false},
    catalogue_gate:{phase:'catalog_approval',technically_certified:false,reasons:['media_missing']},
    markets:[],market_data_scope:'not_queried_before_approval',
  },
  'KPR-TEST-APPROVED': {
    product_ref:'KPR-TEST-APPROVED',
    identity:{title_fr:'Luminaire validé',description_fr:'Lampe de table.',
      locale:'fr',content_source:'manual',needs_review:false,customs_category:'household',
      boutique_category_key:'maison',boutique_subcategory_key:'luminaire',taxonomy_active:true},
    supplier:{name:'CJdropshipping',reference:'CJ-VEND',source_contract_v2:true,sourcing_decision:'TEST'},
    availability:{lifecycle_status:'active',is_active:true,is_available:true,
      inventory_model:'LEGACY_VARIANTS',stock:7,stock_is_authoritative:true,
      has_variants:true,weight_kg:1.5,dimensions_cm:'30 x 15 x 10',
      fragility:'low',requires_secure_transport:false},
    purchasing:{active_supplier_skus:1,complete_supplier_skus:1,supplier_identity_complete:true},
    media:{active_canonical:1,gallery:[{url:'https://img.komerce.test/lamp.svg',
      alt:'Luminaire blanc',role:'PRODUCT'}],gallery_truncated:false},
    variants:{inventory_model:'LEGACY_VARIANTS',
      stock_semantics:'legacy_variant_axes_not_combinatorial',truncated:false,
      rows:[{variant_type:'couleur',variant_value:'Blanc',sku:'LAMP-LEGACY',stock:3,is_active:null}]},
    economics:{reference_cost_kmf:2100,reference_price_kmf:4300,reference_price_is_market_decision:false},
    catalogue_gate:{phase:'other_lifecycle',technically_certified:null,reasons:[]},
    markets:[{code:'KM',currency:'KMF',commercial_exposure:'ENABLED',
      price_status:'LOCAL_ACTIVE',local_price_amount:4300,local_price_currency:'KMF'}],
    market_data_scope:'active_catalogue_product',
  },
};

const frame = `<html lang="fr"><head>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body class="kmc-shell-v4" data-kmc-surface="catalog-workspace"><main id="canonical-admin-root"></main></body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('https://img.komerce.test/**', route => route.fulfill({
      contentType:'image/svg+xml',
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220"><rect width="220" height="220" fill="#f0f4fa"/><rect x="42" y="63" width="136" height="90" rx="10" fill="#7698bb"/><rect x="70" y="43" width="80" height="19" rx="6" fill="#294668"/></svg>',
    }));
    await page.setContent(frame);
    await page.addStyleTag({ content: `
      html,body{margin:0;max-width:100%;font-family:Arial,sans-serif;color:#1d3556;}
      *,*:before,*:after{box-sizing:border-box}
      main{width:100%;min-width:0;padding:12px;}
      .kmc-section{margin-block:12px}.kmc-section-body{min-width:0;}
    ` });
    for (const file of ['operations-workspace.css','catalog-workspace-wide-v1.css']) {
      await page.addStyleTag({ path: path.join(root, 'public/dashboards/canonical/css', file) });
    }
    await page.addScriptTag({ path: path.join(root, 'public/dashboards/canonical/js/catalog-workspace.js') });
    await page.evaluate(async fixtures => {
      const { payload, dossiers } = fixtures;
      const doc = document;
      const ui = {
        Section: { create({title,description}) {
          const element = doc.createElement('section');
          element.className = 'kmc-section';
          const header = doc.createElement('header');
          header.appendChild(Object.assign(doc.createElement('h2'), { textContent: title }));
          if (description) header.appendChild(Object.assign(doc.createElement('p'), { textContent: description }));
          element.appendChild(header);
          const slot = doc.createElement('div');
          slot.className = 'kmc-section-body';
          element.appendChild(slot);
          return { element, slot };
        } },
        MetricStrip: { render() {} },
      };
      window.__catalogMutationCount = 0;
      const fetch = async (url, options = {}) => {
        if (options.method && options.method !== 'GET') {
          window.__catalogMutationCount += 1;
          throw new Error('Mutation prohibited in isolated Chromium');
        }
        if (url.includes('?dossier_product_ref=')) {
          const ref = decodeURIComponent(url.split('?dossier_product_ref=')[1].split('&')[0]);
          return {ok:true,status:200,json:async()=>dossiers[ref] || {product_ref:ref}};
        }
        if (url.includes('/boutique-category-options')) return {
          ok: true, status: 200, json: async () => ({
            categories: [
              {category:'maison',category_label:'Maison',subcategory:'luminaire',subcategory_label:'Luminaire'},
              {category:'maison',category_label:'Maison',subcategory:'decor',subcategory_label:'Décoration'},
            ],
            suggestions: [
              {category:'maison',category_label:'Maison',subcategory:'luminaire',
               subcategory_label:'Luminaire',confidence:'high',reason:'Objet fournisseur corroboré'},
            ],
          }),
        };
        if (url.includes('/category-options')) return {
          ok: true, status: 200, json: async () => ({
            categories: [{key:'electronics',label:'Électronique'},
              {key:'household',label:'Maison'}],
            suggestions: [{key:'electronics',label:'Électronique',confidence:'high'}],
          }),
        };
        return { ok: true, status: 200, json: async () => payload };
      };
      await window.KomerceCanonicalCatalogWorkspace.mount({
        root:doc.getElementById('canonical-admin-root'),
        document:doc, ui, fetch, location:{search:''},
        confirm:()=>false, prompt:()=>null,
      });
    }, {payload:catalog,dossiers:dossierFixture});

    // One Hero on the main Catalogue, restored on all its internal tabs.
    const hero = page.locator('.kmc-catalog-compact-header[data-dashboard-role="hero"]');
    assert.equal(await hero.count(), 1, 'Catalogue must retain exactly one Hero');
    assert.equal(await hero.locator('h1').innerText(), 'Catalogue global');
    assert((await hero.locator('.kmc-workspace-subtitle').innerText()).includes('Catalogue marché'));
    const heroStyle = await hero.evaluate(el => ({
      height: el.getBoundingClientRect().height,
      image: getComputedStyle(el, '::before').backgroundImage,
    }));
    assert(heroStyle.height >= 140, 'Catalogue Hero has been collapsed: ' + JSON.stringify(heroStyle));
    assert(heroStyle.image.includes('commerce-hero-gold.svg'),
      'Catalogue Hero illustration is missing: ' + JSON.stringify(heroStyle));
    assert.equal(await page.locator('tr[data-candidate-ref]').count(), 3);
    assert.equal(await page.locator('tr[data-product-ref]').count(), 3);
    await page.screenshot({ path: path.join(output, 'catalogue-unifie.png'), fullPage: true });

    await page.locator('[data-candidate-ref="KSC-TEST-READY"] [data-workspace-action="inspect-candidate"]').click();
    const candidate = page.locator('[data-catalog-candidate-inspector="KSC-TEST-READY"]');
    await candidate.waitFor({ state: 'visible' });
    // La suggestion est affichée dès l'ouverture : pas de clic « Recharger ».
    await candidate.locator('[data-catalog-candidate-category-choice] option').first().waitFor({state:'attached'});
    assert((await candidate.locator('[data-catalog-candidate-category-choice] option').first().innerText()).includes('Proposé'));
    assert(await candidate.locator('[data-workspace-action="candidate-apply-boutique-suggestion"]').isVisible());
    await page.screenshot({ path: path.join(output, 'candidat-suggestion-contextuelle.png'), fullPage: true });
    await candidate.locator('[data-workspace-action="close-inspector"]').click();

    await page.locator('[data-candidate-ref="KSC-ECON-REVIEW"] [data-workspace-action="inspect-candidate"]').click();
    const economic=page.locator('[data-catalog-candidate-inspector="KSC-ECON-REVIEW"]');
    await economic.waitFor({state:'visible'});
    await economic.locator('[data-workspace-action="candidate-economic-category-review"]').click();
    assert((await economic.locator('[data-catalog-economic-category-choice] option').first().innerText())
      .includes('Proposé'));
    assert((await economic.innerText()).toLowerCase().includes('famille de calcul'));
    await page.screenshot({
      path:path.join(output,'candidat-categorie-economique-contextuelle.png'),fullPage:true,
    });
    await economic.locator('[data-workspace-action="close-inspector"]').click();

    await page.locator('[data-product-ref="KPR-TEST-DRAFT"] [data-workspace-action="open-catalog-inspector"]').click();
    const product = page.locator('[data-catalog-product-inspector="KPR-TEST-DRAFT"]');
    await product.waitFor({ state: 'visible' });
    assert((await product.innerText()).includes('À compléter'));
    const inline = product.locator('[data-catalog-inline-editor]');
    await inline.waitFor({state:'visible'});
    assert(await inline.locator('[data-catalog-quick-field="name"]').isVisible());
    assert(await inline.locator('[data-catalog-quick-field="description"]').isVisible());
    assert(await inline.locator('[data-catalog-quick-category]').isVisible());
    assert(await inline.locator('[data-catalog-quick-subcategory]').isVisible());
    assert(!(await product.innerText()).includes('Aucune correction à apporter'));
    assert(!(await product.innerText()).includes('Situation :'));
    assert.equal(await product.locator('[data-catalog-economic-summary]').count(),0);
    await page.screenshot({ path: path.join(output, 'dossier-actions-correction-visibles.png'), fullPage: true });
    await product.locator('[data-catalog-complementary-info] > summary').click();
    assert((await product.innerText()).includes('Médias source identifiés'));
    await product.locator('[data-catalog-canonical-gallery] img').first().waitFor();
    assert.equal(await product.locator('[data-catalog-canonical-gallery] img').count(),1);
    assert((await product.innerText()).includes('25 x 15 x 10'));
    assert((await product.innerText()).includes('Géré par les SKU'));
    await product.locator('[data-catalog-variants] summary').click();
    assert((await product.locator('[data-catalog-variants]').innerText()).includes('LAMP-WHITE'));
    assert((await product.locator('[data-catalog-variants]').innerText()).includes('Stock : 6'));
    await page.screenshot({ path: path.join(output, 'produit-corrections-contextuelles.png'), fullPage: true });
    assert(!(await product.locator('[data-workspace-action="inspector-classify"]').isVisible()));
    assert(await product.locator('[data-catalog-quick-category]').isVisible());
    await page.screenshot({ path: path.join(output, 'classement-boutique-reutilise.png'), fullPage: true });
    await product.locator('[data-workspace-action="close-inspector"]').click();
    await page.locator('[data-product-ref="KPR-000088"] [data-workspace-action="open-catalog-inspector"]').click();
    const inactive = page.locator('[data-catalog-product-inspector="KPR-000088"]');
    await inactive.waitFor({state:'visible'});
    assert(await inactive.locator('[data-catalog-quick-field="name"]').isVisible());
    assert(await inactive.locator('[data-catalog-quick-field="description"]').isVisible());
    assert(await inactive.locator('[data-catalog-quick-category]').isVisible());
    assert(await inactive.locator('[data-catalog-quick-subcategory]').isVisible());
    const proposedTitle=await inactive.locator('[data-catalog-quick-field="name"]').inputValue();
    const proposedDescription=await inactive.locator('[data-catalog-quick-field="description"]').inputValue();
    assert(proposedTitle.includes('Film de protection d’écran hydrogel anti-espion'),
      'Expected a French starter, not a blank editor');
    assert(proposedTitle.includes('V40E') && proposedTitle.includes('lot de 3'),
      'Supplier compatibility and quantity should be preserved');
    assert(proposedDescription.includes('Compatibilité exacte à vérifier'),
      'No unsourced compatibility promise');
    assert(await inactive.locator('[data-workspace-action="apply-catalog-fr-proposal"]').isVisible());
    assert((await inactive.locator('[data-catalog-subcategory-summary]').innerText()).includes('sous-catégories'));
    await inactive.locator('[data-catalog-subcategory-summary]').click();
    assert(await inactive.locator('[data-catalog-subcategory-option="phone"]').isVisible());
    assert(!(await inactive.innerText()).includes('Aucune correction à apporter'));
    await page.screenshot({path:path.join(output,'kpr-000088-completion-directe.png'),fullPage:true});
    await inactive.locator('[data-workspace-action="close-inspector"]').click();
    await page.locator('[data-product-ref="KPR-TEST-APPROVED"] [data-workspace-action="open-catalog-inspector"]').click();
    const approved = page.locator('[data-catalog-product-inspector="KPR-TEST-APPROVED"]');
    await approved.locator('[data-catalog-complementary-info] > summary').click();
    await approved.locator('[data-catalog-canonical-gallery] img').first().waitFor();
    assert((await approved.innerText()).includes('LOCAL_ACTIVE'));
    assert(!(await approved.innerText()).includes('4300'),
      'Global Catalogue must not display a market price amount');
    await approved.locator('[data-catalog-variants] summary').click();
    assert((await approved.innerText()).includes('ne constituent pas nécessairement des combinaisons vendables'));
    await page.screenshot({ path: path.join(output, 'produit-approuve-marches.png'), fullPage: true });
    const dims = await page.evaluate(() => ({
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      writes: window.__catalogMutationCount,
    }));
    assert(dims.scrollWidth <= dims.viewport + 2, 'Horizontal outer overflow: ' + JSON.stringify(dims));
    assert.equal(dims.writes, 0);
    console.log(JSON.stringify({ verdict: 'PASS', viewport: 1440,
      sourceRows: 3, productRows: 2, suggestedClassification: true,
      economicCategoryInline: true,
      inPlaceCorrection: true, existingDialogReused: true, mediaRecoveryAction: true,
      visibleFrenchCorrection: true, frenchEditorOpened: true,
      canonicalGallery: true, skuStockTruth: true, approvedMarketDossier: true,
      businessWrites: 0 }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error('FAIL contextual Chromium', error); process.exit(1); });
