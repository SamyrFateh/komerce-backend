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
    { record_kind: 'product', product_ref: 'KPR-TEST-APPROVED', name: 'Luminaire validé',
      supplier_name: 'CJdropshipping', boutique_category_key: 'maison',
      boutique_subcategory_key: 'luminaire', boutique_category_label: 'Maison',
      boutique_subcategory_label: 'Luminaire',
      lifecycle_status: 'active', is_active: true, needs_review: false,
      work_status: 'catalog_approved', operator_group: 'validated', issues: [] },
  ],
  registry_page: { total: 4, limit: 50, offset: 0, has_previous: false, has_next: false },
  commercial_products: [], approval: [], approval_page: { total: 0 },
  curation: {}, pricing_parameters: {}, commercial: {}, approval_breakdown: {},
};

const frame = `<html lang="fr"><head>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body class="kmc-shell-v4"><main id="canonical-admin-root"></main></body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    await page.evaluate(async payload => {
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
        return { ok: true, status: 200, json: async () => payload };
      };
      await window.KomerceCanonicalCatalogWorkspace.mount({
        root:doc.getElementById('canonical-admin-root'),
        document:doc, ui, fetch, location:{search:''},
        confirm:()=>false, prompt:()=>null,
      });
    }, catalog);

    assert.equal(await page.locator('tr[data-candidate-ref]').count(), 2);
    assert.equal(await page.locator('tr[data-product-ref]').count(), 2);
    await page.screenshot({ path: path.join(output, 'catalogue-unifie.png'), fullPage: true });

    await page.locator('[data-candidate-ref="KSC-TEST-READY"] [data-workspace-action="inspect-candidate"]').click();
    const candidate = page.locator('[data-catalog-candidate-inspector="KSC-TEST-READY"]');
    await candidate.waitFor({ state: 'visible' });
    await candidate.locator('[data-workspace-action="candidate-boutique-review"]').click();
    assert((await candidate.locator('[data-catalog-candidate-category-choice] option').first().innerText()).includes('Proposé'));
    await page.screenshot({ path: path.join(output, 'candidat-suggestion-contextuelle.png'), fullPage: true });
    await candidate.locator('[data-workspace-action="close-inspector"]').click();

    await page.locator('[data-product-ref="KPR-TEST-DRAFT"] [data-workspace-action="open-catalog-inspector"]').click();
    const product = page.locator('[data-catalog-product-inspector="KPR-TEST-DRAFT"]');
    await product.waitFor({ state: 'visible' });
    assert((await product.innerText()).includes('Classement Boutique à corriger'));
    assert.equal(await product.locator('[data-workspace-action="inspector-classify"]').count(), 1);
    assert.equal(await product.locator('[data-workspace-action="inspector-prepare-fr"]').count(), 1);
    assert.equal(await product.locator('[data-workspace-action="inspector-recover-media"]').count(), 1);
    assert((await product.innerText()).includes('Médias source identifiés'));
    await page.screenshot({ path: path.join(output, 'produit-corrections-contextuelles.png'), fullPage: true });
    await product.locator('[data-workspace-action="inspector-classify"]').click();
    const dialog = page.locator('#kmc-catalog-classification-dialog');
    await dialog.waitFor({ state: 'visible' });
    assert((await dialog.innerText()).includes('Catégorie fournisseur'));
    await page.screenshot({ path: path.join(output, 'classement-boutique-reutilise.png'), fullPage: true });

    const dims = await page.evaluate(() => ({
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      writes: window.__catalogMutationCount,
    }));
    assert(dims.scrollWidth <= dims.viewport + 2, 'Horizontal outer overflow: ' + JSON.stringify(dims));
    assert.equal(dims.writes, 0);
    console.log(JSON.stringify({ verdict: 'PASS', viewport: 1440,
      sourceRows: 2, productRows: 2, suggestedClassification: true,
      inPlaceCorrection: true, existingDialogReused: true, mediaRecoveryAction: true, businessWrites: 0 }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error('FAIL contextual Chromium', error); process.exit(1); });
