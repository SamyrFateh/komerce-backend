'use strict';

/** @test-kind e2e @test-runner playwright @test-requires none
 * Upload canonique Catalogue Chromium local, API simulée ; jamais de staging.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const JS = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js');

async function mount(page, role = 'admin') {
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ path: path.join(JS, 'catalog-workspace.js') });
  await page.evaluate(async roleName => {
    const productRef = 'KPR-000254';
    const payload = {
      summary: { commercial_approved: 0, commercial_closed_lots: 0, approval_pending: 1, needs_review: 0, commercial_markets: 0 },
      curation: { published_products: 0 }, approval: [], approval_breakdown: { TEST: 1 },
      approval_strategy: { value_density_used: false },
      approval_page: { total: 0, limit: 50, offset: 0, has_previous: false, has_next: false },
      registry_page: { total: 1, limit: 50, offset: 0, has_next: false, has_previous: false },
      products: [{ record_kind: 'product', product_ref: productRef, candidate_ref: 'KSC-000813',
        name: 'Lampe de recette', supplier_name: 'Fournisseur central Hub',
        lifecycle_status: 'candidate', is_active: false, work_status: 'media_to_complete',
        operator_group: 'correction', issues: ['media_missing'], active_media_count: 0,
        media_status: 'preview_only', source_media_count: 0 }], categories: [],
    };
    const dossier = {
      product_ref: productRef, identity: { title_fr: 'Lampe de recette', description_fr: 'Une description française.' },
      supplier: { name: 'Fournisseur central Hub', reference: null, source_contract_v2: true,
        source_kind: 'central_hub_manual', sourcing_decision: 'TEST' },
      availability: { lifecycle_status: 'candidate', is_active: false, is_available: false,
        inventory_model: 'LEGACY_VARIANTS', stock_is_authoritative: true },
      purchasing: { active_supplier_skus: 0, complete_supplier_skus: 0, supplier_identity_complete: false },
      editorial: {}, media: { product_id: '11111111-1111-4111-8111-111111111111',
        sourcing_linked: true, active_canonical: 0, gallery: [] },
      variants: { rows: [], stock_semantics: 'legacy_variant_axes_not_combinatorial' },
      catalogue_gate: { phase: 'catalog_approval', technically_certified: false, reasons: ['media_missing'] },
      markets: [], market_data_scope: 'not_queried_before_approval',
    };
    window.__mediaCalls = [];
    const ui = {
      MetricStrip: { render: (_root, { items }) => { const n = document.createElement('div'); n.textContent = items.map(x => `${x.label}: ${x.value}`).join(' · '); document.getElementById('root').appendChild(n); } },
      Section: { create: ({ title, description }) => {
        const element = document.createElement('section');
        const heading = document.createElement('h2'); heading.textContent = title; element.appendChild(heading);
        const copy = document.createElement('p'); copy.textContent = description; element.appendChild(copy);
        const slot = document.createElement('div'); element.appendChild(slot); return { element, slot };
      } },
    };
    const fetch = async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      window.__mediaCalls.push({ url, method, isFormData: options.body instanceof FormData,
        keys: options.body instanceof FormData ? [...options.body.keys()] : [] });
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true, action: 'catalog_media_uploaded' }) };
      if (String(url).includes('dossier_product_ref=')) return { ok: true, status: 200, json: async () => dossier };
      return { ok: true, status: 200, json: async () => payload };
    };
    await window.KomerceCanonicalCatalogWorkspace.mount({ root: document.getElementById('root'), document,
      ui, fetch, location: { search: '' }, user: { role: roleName } });
  }, role);
}

test.describe('Catalogue — média canonique Hub', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('un admin peut téléverser une image comme multipart canonique', async ({ page }) => {
    await mount(page);
    await page.locator('[data-workspace-action="open-catalog-inspector"]').click();
    await page.locator('details[data-catalog-complementary-info] > summary').click();
    const form = page.locator('[data-catalog-media-upload]');
    await expect(form).toBeVisible();
    await expect(form.locator('[data-catalog-media-upload-submit]')).toBeDisabled();
    await form.locator('[data-catalog-media-upload-file]').setInputFiles({
      name: 'lampe.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    await form.locator('[data-catalog-media-upload-submit]').click();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('image canonique enregistrée');
    const calls = await page.evaluate(() => window.__mediaCalls.filter(call => call.method === 'POST'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: expect.stringContaining('/products/KPR-000254/media'), method: 'POST', isFormData: true, keys: ['image'],
    });
  });

  test('le formulaire de mutation n’est pas rendu aux autres rôles', async ({ page }) => {
    await mount(page, 'market_operator');
    await page.locator('[data-workspace-action="open-catalog-inspector"]').click();
    await page.locator('details[data-catalog-complementary-info] > summary').click();
    await expect(page.locator('[data-catalog-media-upload]')).toHaveCount(0);
  });
});
