'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CANONICAL_INDEX = fs.readFileSync(
  path.resolve(__dirname, '../../../dashboards/canonical/index.html'),
  'utf8'
);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function policy(marketCode, overrides = {}) {
  return {
    version: `${marketCode}-E2E-V1`,
    window_days: 30,
    maturity_threshold: 0.9,
    coverage_threshold: 1,
    max_disposition_ratio: 0.05,
    disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR',
    effective_from: '2026-08-01T00:00:00.000Z',
    effective_to: null,
    source: 'e2e_business_fixture',
    evidence_ref: `E2E-${marketCode}-DECISION`,
    rationale: `Scénario E2E contrôlé ${marketCode}`,
    recorded_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function decisionFixture(marketCode, scenario) {
  const currentPolicy = policy(marketCode);
  const base = {
    market_id: `market-${marketCode.toLowerCase()}`,
    policy: currentPolicy,
    canonical_period: {
      from: '2026-08-08T12:00:00.000Z',
      to: '2026-09-07T12:00:00.000Z',
      bounds: '[from,to)',
      width_days: 30,
      source: 'server_policy_window',
    },
    evaluated_at: '2026-09-07T12:00:00.000Z',
  };

  if (scenario === 'covered') {
    return {
      ...base,
      decision_status: 'COVERED',
      authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
      reason: 'COVERAGE_THRESHOLD_MET',
      coverage: {
        coverage_status: 'COVERED',
        coverage_ratio: 1.12,
        authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
        reason: 'COVERAGE_THRESHOLD_MET',
        numerator_contribution_kmf: 560000,
        denominator_n3_kmf: 500000,
        maturity: { maturity_ratio: 0.96, mature_orders: 24 },
        contribution: { mature_order_count: 24 },
      },
    };
  }

  if (scenario === 'uncovered') {
    return {
      ...base,
      decision_status: 'UNCOVERED',
      authorization: 'DENY_NEW_UNDER_CDR_POSITION',
      reason: 'COVERAGE_THRESHOLD_NOT_MET',
      coverage: {
        coverage_status: 'UNCOVERED',
        coverage_ratio: 0.82,
        authorization: 'DENY_NEW_UNDER_CDR_POSITION',
        reason: 'COVERAGE_THRESHOLD_NOT_MET',
        numerator_contribution_kmf: 410000,
        denominator_n3_kmf: 500000,
        maturity: { maturity_ratio: 0.97, mature_orders: 31 },
        contribution: { mature_order_count: 31 },
      },
    };
  }

  return {
    ...base,
    decision_status: 'NOT_DECISIONAL',
    authorization: 'DENY_NEW_UNDER_CDR_POSITION',
    reason: 'RISK_PERIOD_NOT_DECISIONAL',
    coverage: {
      coverage_status: 'NOT_DECISIONAL',
      coverage_ratio: null,
      authorization: 'DENY_NEW_UNDER_CDR_POSITION',
      reason: 'RISK_PERIOD_NOT_DECISIONAL',
      numerator_contribution_kmf: null,
      denominator_n3_kmf: 500000,
      maturity: { maturity_ratio: 0.94, mature_orders: 18 },
      contribution: { mature_order_count: 18 },
    },
  };
}

async function mountScenario(page, { marketCode, scenario, canManagePolicy = true }) {
  const decision = decisionFixture(marketCode, scenario);
  const currentPolicy = decision.policy;

  await page.route('**/admin/workspaces/pricing', route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    return route.fulfill({ status: 200, contentType: 'text/html', body: CANONICAL_INDEX });
  });

  await page.route('**/api/auth/me', route => json(route, {
    id: `operator-${marketCode.toLowerCase()}`,
    role: 'market_operator',
    email: `${marketCode.toLowerCase()}-manager@komerce.test`,
  }));

  await page.route('**/api/admin/dashboard/context', route => json(route, {
    actor: { id: `operator-${marketCode.toLowerCase()}`, role: 'market_operator' },
    access: {
      mode: 'market',
      allowedMarkets: [marketCode],
      defaultMarket: marketCode,
      capabilities: ['dashboard.read', 'pricing.read'],
    },
  }));

  await page.route(new RegExp(`/api/admin/workspaces/pricing/market/${marketCode}/decision$`), route => json(route, decision));
  await page.route(new RegExp(`/api/admin/workspaces/pricing/market/${marketCode}/decision-policy/history$`), route => json(route, {
    market_code: marketCode,
    policies: [currentPolicy],
  }));
  await page.route(new RegExp(`/api/admin/workspaces/pricing/market/${marketCode}$`), route => json(route, {
    scope: { market_code: marketCode },
    summary: {},
    access: { read_only: !canManagePolicy },
    capabilities: {
      cost_overrides: canManagePolicy,
      reset_to_global: canManagePolicy,
      market_decision: true,
      manage_decision_policy: canManagePolicy,
    },
    cost_components: [],
  }));

  await page.goto('http://localhost:3000/admin/workspaces/pricing');
  await expect(page.getByRole('heading', { name: 'Décision marché' })).toBeVisible();
}

async function expectDecisionBeforeCosts(page) {
  const order = await page.locator('.kmc-section-title').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  expect(order.indexOf('Décision marché')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('Atelier des coûts')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('Décision marché')).toBeLessThan(order.indexOf('Atelier des coûts'));
}

test.describe('Pricing Workspace — décision économique pays', () => {
  test('Cameroun couvert : le manager voit le feu vert et les chiffres qui le justifient', async ({ page }) => {
    await mountScenario(page, { marketCode: 'CM', scenario: 'covered' });

    const hero = page.locator('.kmc-market-decision-hero');
    await expect(hero).toHaveClass(/is-positive/);
    await expect(hero).toContainText('Marché couvert');
    await expect(hero).toContainText('Position sous CDR autorisée par le gate serveur');
    await expect(page.getByText('1,12×', { exact: true })).toBeVisible();
    await expect(page.getByText('560 000 KMF', { exact: true })).toBeVisible();
    await expect(page.getByText('500 000 KMF', { exact: true })).toBeVisible();
    await expect(page.getByText('96 %', { exact: true })).toBeVisible();
    await expect(page.getByText('CM-E2E-V1', { exact: true })).toBeVisible();
    await expect(page.getByText('Enregistrer une nouvelle version de politique')).toBeVisible();
    await expectDecisionBeforeCosts(page);
  });

  test('Congo sous-couvert : le système interdit une nouvelle position sous CDR sans masquer la contribution', async ({ page }) => {
    await mountScenario(page, { marketCode: 'CG', scenario: 'uncovered' });

    const hero = page.locator('.kmc-market-decision-hero');
    await expect(hero).toHaveClass(/is-warning/);
    await expect(hero).toContainText('Couverture insuffisante');
    await expect(hero).toContainText('Nouvelle position sous CDR bloquée par le gate serveur');
    await expect(page.getByText('0,82×', { exact: true })).toBeVisible();
    await expect(page.getByText('410 000 KMF', { exact: true })).toBeVisible();
    await expect(page.getByText('500 000 KMF', { exact: true })).toBeVisible();
    await expect(page.getByText('97 %', { exact: true })).toBeVisible();
    await expectDecisionBeforeCosts(page);
  });

  test('Cameroun incomplet : vérité risque absente = NOT_DECISIONAL, jamais un faux feu vert', async ({ page }) => {
    await mountScenario(page, { marketCode: 'CM', scenario: 'not_decisional', canManagePolicy: false });

    const hero = page.locator('.kmc-market-decision-hero');
    await expect(hero).toHaveClass(/is-critical/);
    await expect(hero).toContainText('Décision impossible');
    await expect(hero).toContainText('La vérité de risque de la période n’est pas encore décisionnelle.');
    await expect(hero).toContainText('Nouvelle position sous CDR bloquée par le gate serveur');
    await expect(page.getByText('—', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Marché couvert')).toHaveCount(0);
    await expect(page.getByText('Enregistrer une nouvelle version de politique')).toHaveCount(0);
    await expectDecisionBeforeCosts(page);
  });
});
