'use strict';

/** @test-kind e2e @test-runner playwright @test-requires none
 * Arbitrage manuel d’un candidat WATCH dans le Sourcing canonique.
 * Chromium local, API simulée ; aucun staging ni fournisseur externe.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const JS = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js');
const CANDIDATE_REF = 'KSC-000812';

async function mount(page) {
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ path: path.join(JS, 'sourcing-workspace.js') });
  await page.evaluate(async candidateRef => {
    const payload = {
      summary: { sourcing_sources: 1, imports: 1, candidates_total: 1, candidates_promoted: 0 },
      candidates: [{
        candidate_ref: candidateRef,
        product_name: 'Jeu de tournevis de recette',
        supplier_name: 'Fournisseur central Hub',
        state: 'scanned',
        purchase_price: 10,
        currency: 'EUR',
        scan_at: '2026-11-21T08:00:00.000Z',
        scan_result: { sourcing_decision: 'WATCH' },
      }],
      imports: [],
    };
    window.__candidateRequests = [];
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
      const method = String(options.method || 'GET').toUpperCase();
      window.__candidateRequests.push({ url, method, body: options.body || null });
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({
        ok: true, action: url.endsWith('/watchlist') ? 'watchlist_candidate' : 'reject_candidate',
        result: { state: url.endsWith('/watchlist') ? 'watchlist' : 'rejected' },
      }) };
      return { ok: true, status: 200, json: async () => payload };
    };
    await window.KomerceCanonicalSourcingWorkspace.mount({
      root: document.getElementById('root'), document, ui, fetch,
      locationSearch: '?tab=candidates', user: { role: 'admin' },
    });
  }, CANDIDATE_REF);
}

test.describe('Sourcing candidate WATCH actions — Chromium', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('met en veille un candidat WATCH par la route canonique', async ({ page }) => {
    await mount(page);
    const row = page.locator(`[data-sourcing-candidate="${CANDIDATE_REF}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Décision fournisseur : à surveiller');
    await row.locator('[data-sourcing-watchlist]').click();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('placé en surveillance');
    const requests = await page.evaluate(() => window.__candidateRequests.filter(item => item.method === 'POST'));
    expect(requests).toEqual([{
      url: expect.stringContaining(`/candidates/${CANDIDATE_REF}/watchlist`),
      method: 'POST', body: '{}',
    }]);
  });

  test('écarte un candidat WATCH avec une raison facultative', async ({ page }) => {
    await mount(page);
    const row = page.locator(`[data-sourcing-candidate="${CANDIDATE_REF}"]`);
    await row.locator('[data-sourcing-reject]').click();
    const dialog = page.getByRole('dialog', { name: `Écarter le candidat · ${CANDIDATE_REF}` });
    await dialog.locator('[data-sourcing-reject-reason]').fill('Famille fournisseur non exploitable');
    await dialog.locator('[data-sourcing-reject-submit]').click();
    await expect(page.locator('[data-workspace-feedback]')).toContainText('écarté du suivi actif');
    const requests = await page.evaluate(() => window.__candidateRequests.filter(item => item.method === 'POST'));
    expect(requests).toEqual([{
      url: expect.stringContaining(`/candidates/${CANDIDATE_REF}/reject`),
      method: 'POST',
      body: JSON.stringify({ reason: 'Famille fournisseur non exploitable' }),
    }]);
  });
});
