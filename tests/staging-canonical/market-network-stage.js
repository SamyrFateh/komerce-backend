/**
 * @komerce-arch-lite
 * @role canonical-staging-market-network-screen-oracle
 * @domain dashboard
 * @layer e2e-helper
 * @owner backend-core
 * @purpose Rejouer l'étape Réseau local sans recréer un scénario métier ni accorder de droits.
 * @impact-areas dashboard, market-autonomy, staging-only
 */
'use strict';

/** @test-kind e2e @test-runner playwright @test-requires staging */

const MARKET_CODE = /^[A-Z]{2}$/;
const SCREEN_PATH = '/dashboards/canonical/market-autonomy.html';

function classifyNetworkStage({ workspaceVisible, sectionVisible, relaisStatus, providersStatus, accessRequired }) {
  if (!workspaceVisible) return { verdict: 'BLOCKED', reason: 'MARKET_AUTONOMY_WORKSPACE_UNAVAILABLE' };
  const readGranted = relaisStatus === 200 || providersStatus === 200;
  const readDenied = relaisStatus === 403 && providersStatus === 403;
  if (readGranted && sectionVisible) return { verdict: 'SCREEN_PASS', reason: 'VISIBLE_WITH_SERVER_AUTHORITY' };
  if (readGranted) return { verdict: 'BLOCKED', reason: 'NETWORK_SCREEN_MISSING_WITH_READ_AUTHORITY' };
  if (readDenied && !sectionVisible && !accessRequired) {
    return { verdict: 'NOT_PROVEN', reason: 'BOTH_NETWORK_READS_FORBIDDEN_FOR_ACTOR' };
  }
  if (readDenied && accessRequired) {
    return { verdict: 'BLOCKED', reason: 'REQUIRED_NETWORK_CAPABILITY_MISSING' };
  }
  if (readDenied && sectionVisible) return { verdict: 'BLOCKED', reason: 'SCREEN_VISIBLE_WITHOUT_NETWORK_READ' };
  return { verdict: 'BLOCKED', reason: 'NETWORK_API_OR_SCREEN_UNEXPECTED_STATE' };
}

async function inspectMarketNetwork(page, { origin, market, accessRequired = false, timeout = 12000 }) {
  if (!MARKET_CODE.test(market)) throw new Error('INVALID_CANONICAL_MARKET_CODE');
  // Navigation humaine obligatoire : l'URL préserve le Market ID sélectionné ;
  // les GET suivants ne servent que d'oracles indépendants, jamais à muter le métier.
  const target = `${SCREEN_PATH}?market=${encodeURIComponent(market)}`;
  const entry = await page.goto(origin + target, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const workspace = page.locator('#market-autonomy-root.kmc-workspace');
  await workspace.waitFor({ state: 'attached', timeout }).catch(() => null);
  const workspaceVisible = await workspace.isVisible().catch(() => false);
  const section = page.locator('[data-market-network]');
  if (workspaceVisible) await section.waitFor({ state: 'attached', timeout }).catch(() => null);
  const sectionVisible = await section.isVisible().catch(() => false);
  const prefix = `/api/market-delegation/markets/${encodeURIComponent(market)}/network`;
  const [relais, providers] = await Promise.all([
    page.request.get(prefix + '/relais', { timeout: 20000 }).catch(() => null),
    page.request.get(prefix + '/providers', { timeout: 20000 }).catch(() => null)
  ]);
  const relaisStatus = relais?.status() ?? null;
  const providersStatus = providers?.status() ?? null;
  const classification = classifyNetworkStage({
    workspaceVisible, sectionVisible, relaisStatus, providersStatus, accessRequired
  });
  return {
    market, target, actualPath: new URL(page.url()).pathname,
    entryHttp: entry?.status() ?? null, workspaceVisible, sectionVisible,
    relaisStatus, providersStatus, ...classification
  };
}

module.exports = { SCREEN_PATH, classifyNetworkStage, inspectMarketNetwork };
