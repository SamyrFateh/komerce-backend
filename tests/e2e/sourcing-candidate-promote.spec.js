'use strict';

/** @test-kind e2e @test-runner playwright @test-requires none
 * Promotion Sourcing → brouillon Catalogue. Chromium local, API simulée.
 * Aucun staging, SQL métier ou fournisseur externe.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const JS = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js');
const CANDIDATE_REF = 'KSC-TEST-HUB-01';

async function mount(page, { promoteStatus = 201 } = {}) {
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ path: path.join(JS, 'sourcing-workspace.js') });
  await page.evaluate(async ({ candidateRef, status }) => {
    const payload = {
      summary: { sourcing_sources: 0, imports: 1, candidates_total: 1, candidates_promoted: 0 },
      candidates: [{
        candidate_ref: candidateRef,
        product_name: 'Produit manuel Hub de recette',
        supplier_name: 'Fournisseur central Hub',
        state: 'scanned',
        komerce_category: 'maison',
        scan_result: { sourcing_decision: 'TEST' },
      }],
      imports: [],
    };
    window.__promotionRequests = [];
    const ui = {
      MetricStrip: { render: (root, { items }) => {
        const strip = document.createElement('div');
        strip.textContent = items.map(item => `${item.label}: ${item.value}`).join(' · ');
        root.appendChild(strip);
      } },
      Section: { create: ({ title, description }) => {
        const element = document.createElement('section');
        const heading = document.createElement('h2');
        heading.textContent = title;
        element.appendChild(heading);
        const copy = document.createElement('p');
        copy.textContent = description;
        element.appendChild(copy);
        const slot = document.createElement('div');
        element.appendChild(slot);
        return { element, slot };
      } },
    };
    const fetch = async (url, options = {}) => {
      window.__promotionRequests.push({ url, method: options.method || 'GET', body: options.body || null });
      if (String(options.method || 'GET').toUpperCase() === 'POST') {
        if (status !== 201) return { ok: false, status, json: async () => ({ error: 'Accès Sourcing refusé', code: 'sourcing_global_access_denied' }) };
        return { ok: true, status: 201, json: async () => ({
          ok: true,
          action: 'promote_candidate',
          result: { candidate_ref: candidateRef, product_ref: 'KPR-009901' },
        }) };
      }
      return { ok: true, status: 200, json: async () => payload };
    };
    await window.KomerceCanonicalSourcingWorkspace.mount({
      root: document.getElementById('root'), document, ui, fetch,
      locationSearch: '?tab=candidates', user: { role: 'admin' },
    });
  }, { candidateRef: CANDIDATE_REF, status: promoteStatus });
}

test.describe('Sourcing candidate promotion — Chromium', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('transmet un candidat TEST, garde le fournisseur serveur et affiche le produit inactif', async ({ page }) => {
    await mount(page);
    const card = page.locator(`[data-sourcing-candidate="${CANDIDATE_REF}"]`);
    const promote = card.locator('[data-sourcing-promote]');
    await expect(card).toBeVisible();
    await expect(promote).toHaveText('Transmettre au Catalogue');
    await promote.click();
    await expect(card.locator('[data-sourcing-product-ref="KPR-009901"]')).toBeVisible();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('KPR-009901 créé inactif');
    await expect(card.locator('[data-sourcing-promote]')).toHaveCount(0);
    const requests = await page.evaluate(() => window.__promotionRequests);
    expect(requests.filter(request => request.method === 'POST')).toEqual([{
      url: expect.stringContaining(`/candidates/${CANDIDATE_REF}/promote`),
      method: 'POST',
      body: '{}',
    }]);
    expect(requests.some(request => JSON.stringify(request).includes('supplier_id'))).toBe(false);
  });

  test('un refus serveur reste visible et ne crée pas de référence produit', async ({ page }) => {
    await mount(page, { promoteStatus: 403 });
    const card = page.locator(`[data-sourcing-candidate="${CANDIDATE_REF}"]`);
    await card.locator('[data-sourcing-promote]').click();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('Accès Sourcing refusé');
    await expect(card.locator('[data-sourcing-product-ref]')).toHaveCount(0);
  });
});
