'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 *
 * « Mon Market » — quatre projections en lecture seule (performance, coûts, douane, comptes de paiement).
 * API simulée : le script réel est injecté dans une page minimale, sans serveur ni base.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const SCRIPT = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'market-readonly-views.js');
const BASE = '/api/market-delegation/markets/CM';

const CONTEXT = { access: { allowedMarkets: ['CM'], defaultMarket: 'CM' } };
const PERFORMANCE = {
  market: { code: 'CM', name: 'Cameroun', currency: 'XAF' }, status: 'AVAILABLE', reason: null,
  period: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
  activity: { mature_order_count: 12, revenue_kmf: 1500000, transaction_variable_cost_kmf: 90000 },
  contribution: { before_risk_kmf: 400000, reconciled_kmf: 380000, actual_risk_cost_kmf: 20000 },
  structure_costs: { market_n3_total_kmf: 120000, decisional: true },
  coverage: { ratio: 3.1, status: 'COVERED', numerator_contribution_kmf: 380000, denominator_n3_kmf: 120000 },
  settlement_basis: { source: 'CENTRAL_ATTESTATION', note: 'Le règlement reste une attestation centrale.' },
  evaluated_at: '2026-10-05T10:00:00.000Z',
};
const COSTS = {
  market_code: 'CM', currency_basis: 'KMF', period: { from: null, to: null }, truncated: true, not_covered: ['purchase_rebilling'],
  totals: { direct_kmf: '1000.00', group_attributed_kmf: '250.50', total_kmf: '1250.50' },
  lines: [
    { event_id: 'e1', origin: 'MARKET_DIRECT', charge_family: 'Local', charge_name: 'Loyer entrepôt', economic_from: '2026-09-01T00:00:00Z', economic_to: '2026-10-01T00:00:00Z', amount_kmf: '1000.00' },
    { event_id: 'e2', origin: 'GROUP_ATTRIBUTED', charge_family: 'Siège', charge_name: 'Hébergement', economic_from: '2026-09-01T00:00:00Z', economic_to: '2026-10-01T00:00:00Z', amount_kmf: '250.50' },
  ],
};
const CUSTOMS = {
  market_code: 'CM', read_only: true, truncated: false,
  shipments: [{ id: 's1', reference: 'EXP-CM-001', shipment_date: '2026-09-12', transitaire_name: 'Transit Douala', transport_mode: 'maritime', cif_value_kmf: '800000.00', customs_paid_kmf: '90000.00', freight_kmf: '40000.00', total_weight_kg: '310.5', effective_rate_pct: '11.25', status: 'cleared', is_active: true, parcels_linked: 7 }],
};
const ACCOUNTS = {
  market_code: 'CM', read_only: true,
  accounts: [{ id: 'a1', provider: 'orange_money', adapter: null, currency: 'XAF', account_holder: 'Yves SARL', legal_seller: 'Yves SARL', market_operator_entity: 'Yves Opérations', refund_bearer: 'MARKET', external_account_id: 'OM-123', legal_basis_ref: 'contrat-2026-01', status: 'ACTIVE', verified_at: '2026-10-02T09:00:00Z' }],
};

async function mount(page, responses) {
  const calls = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    calls.push({ method: route.request().method(), path: url.pathname });
    if (url.pathname === '/api/admin/dashboard/context') return route.fulfill({ json: CONTEXT });
    const hit = responses[url.pathname.replace(BASE + '/', '')];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'inconnu' } });
    return route.fulfill({ status: hit.status || 200, json: hit.body });
  });
  await page.goto('http://localhost/blank');
  await page.setContent('<main id="market-autonomy-root" class="kmc-workspace"></main>');
  await page.addScriptTag({ path: SCRIPT });
  return calls;
}

const ALL = { performance: { body: PERFORMANCE }, 'cost-statement': { body: COSTS }, 'customs-shipments': { body: CUSTOMS }, 'payment-accounts': { body: ACCOUNTS } };

test.describe('Mon Market — projections en lecture seule', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('http://localhost/blank', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  });

  test('les quatre sections affichent les valeurs du serveur, sans bouton ni écriture', async ({ page }) => {
    const calls = await mount(page, ALL);
    for (const key of ['performance', 'cost-statement', 'customs', 'payment-accounts']) {
      await expect(page.locator(`[data-market-readonly="${key}"]`)).toHaveCount(1);
    }
    const perf = page.locator('[data-market-readonly="performance"]');
    await expect(perf).toContainText('1 500 000 KMF');
    await expect(perf).toContainText('380');
    await expect(perf).toContainText('Le règlement reste une attestation centrale.');
    const costs = page.locator('[data-market-readonly="cost-statement"]');
    await expect(costs).toContainText('Total 1 250,5 KMF');
    await expect(costs).toContainText('Loyer entrepôt');
    await expect(costs).toContainText('Part attribuée par le siège');
    await expect(costs).toContainText('refacturation des achats');
    await expect(costs).toContainText('Liste tronquée');
    const customs = page.locator('[data-market-readonly="customs"]');
    await expect(customs).toContainText('EXP-CM-001');
    await expect(customs).toContainText('800 000 KMF');
    await expect(customs).toContainText('11.25 %');
    const accounts = page.locator('[data-market-readonly="payment-accounts"]');
    await expect(accounts).toContainText('orange_money');
    await expect(accounts).toContainText('Yves SARL');
    await expect(accounts).toContainText('Le Market');
    await expect(accounts).toContainText('contrat-2026-01');
    await expect(page.locator('[data-market-readonly] button, [data-market-readonly] input, [data-market-readonly] form')).toHaveCount(0);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
    expect(calls.filter(c => c.path.endsWith('/payment-accounts'))).toHaveLength(1);
    expect(await page.content()).not.toMatch(/credentials_ref|vault\//);
  });

  test('état vide honnête et performance non décisionnelle avec le motif du serveur', async ({ page }) => {
    await mount(page, {
      performance: { body: { ...PERFORMANCE, status: 'NOT_DECISIONAL', reason: 'MARKET_DECISION_POLICY_REQUIRED', activity: null, contribution: null, structure_costs: null, coverage: null } },
      'cost-statement': { body: { ...COSTS, lines: [], truncated: false, totals: { direct_kmf: '0.00', group_attributed_kmf: '0.00', total_kmf: '0.00' } } },
      'customs-shipments': { body: { ...CUSTOMS, shipments: [] } },
      'payment-accounts': { body: { ...ACCOUNTS, accounts: [] } },
    });
    await expect(page.locator('[data-market-readonly="performance"]')).toContainText('Performance non décisionnelle');
    await expect(page.locator('[data-market-readonly="performance"]')).toContainText('MARKET_DECISION_POLICY_REQUIRED');
    await expect(page.locator('[data-market-readonly="cost-statement"]')).toContainText('Aucune charge sur cette période.');
    await expect(page.locator('[data-market-readonly="customs"]')).toContainText('Aucun envoi sur cette période.');
    await expect(page.locator('[data-market-readonly="payment-accounts"]')).toContainText('Aucun compte de paiement déclaré');
  });

  test('capacité absente (403) : la section disparaît ; erreur serveur : message explicite, jamais un faux zéro', async ({ page }) => {
    await mount(page, {
      ...ALL,
      'customs-shipments': { status: 403, body: { error: 'refus', code: 'CAPABILITY_REQUIRED' } },
      'cost-statement': { status: 500, body: { error: 'Erreur interne', code: 'INTERNAL' } },
    });
    await expect(page.locator('[data-market-readonly="performance"]')).toHaveCount(1);
    await expect(page.locator('[data-market-readonly="customs"]')).toHaveCount(0);
    const costs = page.locator('[data-market-readonly="cost-statement"]');
    await expect(costs).toContainText('Erreur interne · INTERNAL');
    await expect(costs).not.toContainText('0 KMF');
  });
});
