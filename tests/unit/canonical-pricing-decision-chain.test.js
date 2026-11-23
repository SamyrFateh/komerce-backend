'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

test('la chaîne économique canonical consomme les projections serveur sans recalcul métier navigateur', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-decision-chain.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-decision-chain.css'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/pricing-decision-chain.js?v=261122-1');
  expect(index).toContain('/dashboards/canonical/css/pricing-decision-chain.css?v=261010-9');
  expect(source).toContain('/corridor?product_ref=');
  expect(source).toContain('`${endpoint}/decision`');
  expect(source).toContain('economics.variable_cost_complete_kmf');
  expect(source).toContain('economics.contribution_unit_kmf');
  expect(source).toContain('state.period_contribution_kmf');
  expect(source).toContain('state.period_n3_kmf');
  expect(source).toContain('state.coverage_ratio');
  expect(source).toContain('state.period_result_kmf');
  expect(source).toContain('le navigateur ne les multiplie pas entre eux');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
  expect(css).toContain('.kmc-decision-chain-unit');
  expect(css).toContain('.kmc-decision-chain-period');
});

test('absence de corridor local ne promeut jamais la concurrence globale en vérité pays', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-decision-chain.js'), 'utf8');
  const service = fs.readFileSync(path.join(ROOT, 'services', 'pricing-market-corridor.js'), 'utf8');

  expect(source).toContain('Aucune observation locale');
  expect(source).toContain('Référence globale informative');
  expect(service).toContain("status: scope === 'market' ? 'LOCAL_EVIDENCE_MISSING' : 'NO_REFERENCE'");
  expect(service).toContain("authority: 'OBSERVED_REFERENCE_NOT_GATE'");
  expect(service).toContain('Aucune donnée locale : la référence globale reste informative');
});

test('les mutations de preuve marché et de prix restent des actions Workspace pays autorisées côté serveur', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-decision-chain.js'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'routes', 'admin-pricing-workspace.js'), 'utf8');

  expect(source).toContain('/price-observations`');
  expect(source).toContain('/local-price`');
  expect(source).toContain('/local-price/activate`');
  // Les observations restent strictement déléguées. Exception ciblée :
  // l'Admin central vérifié peut décider du prix via Catalogue pays, tandis
  // que les opérateurs restent soumis aux capabilities exactes.
  expect(route).toContain("router.post('/market/:marketCode/price-observations', requireLocalStrategyCapability('market.observation.record')");
  expect(route).toContain("router.post('/market/:marketCode/price-observations/:observationRef/deactivate', requireLocalStrategyCapability('market.observation.record')");
  expect(route).toContain("router.post('/market/:marketCode/products/:productRef/local-price', requireCatalogPriceCapability('pricing.decide')");
  expect(route).toContain("router.post('/market/:marketCode/products/:productRef/local-price/activate', requireCatalogPriceCapability('pricing.activate')");
  expect(route).toContain('manage_market_price_observations');
});

describe('fil P1 : prix pays actif → exposition au Catalogue pays', () => {
  afterEach(() => { delete globalThis.KomerceCanonicalNavigation; });
  const chain = () => {
    jest.resetModules();
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    return require('../../public/dashboards/canonical/js/pricing-decision-chain.js');
  };
  const corridor = (source = 'LOCAL_ACTIVE') => ({ market: { code: 'CM' }, product: { product_ref: 'PRD-1' }, selected: { source } });
  const globalCtx = { access: { mode: 'global', allowedMarkets: ['CM'] } };

  test('lien market-catalog.html?market=&product_ref= seulement si LOCAL_ACTIVE et capability accordée', () => {
    const { exposureLink } = chain();
    expect(exposureLink(corridor(), { adminContext: globalCtx })).toBe('/dashboards/canonical/market-catalog.html?market=CM&product_ref=PRD-1');
    const delegated = { access: { mode: 'market', defaultMarket: 'CM', allowedMarkets: ['CM'], delegatedCapabilities: { CM: ['catalog.expose'] } } };
    expect(exposureLink(corridor(), { adminContext: delegated })).toContain('market=CM');
  });

  test('aucun lien : prix pas LOCAL_ACTIVE, capability absente, contexte absent ou marché inconnu', () => {
    const { exposureLink } = chain();
    expect(exposureLink(corridor('BASE_CATALOG'), { adminContext: globalCtx })).toBeNull();
    const without = { access: { mode: 'market', defaultMarket: 'CM', allowedMarkets: ['CM'], delegatedCapabilities: { CM: ['pricing.decide'] } } };
    expect(exposureLink(corridor(), { adminContext: without })).toBeNull();
    expect(exposureLink(corridor(), {})).toBeNull();
    expect(exposureLink({ selected: { source: 'LOCAL_ACTIVE' }, product: { product_ref: 'P' } }, { adminContext: globalCtx })).toBeNull();
  });
});


test('le fil économique distingue résultat réel positif, négatif, zéro et inconnu sans fausse couleur', () => {
  const { flowBlock } = require('../../public/dashboards/canonical/js/pricing-decision-chain.js');
  const doc = {
    createElement(tagName) {
      return {
        tagName, className: '', textContent: '', dataset: {}, children: [],
        appendChild(node) { this.children.push(node); return node; },
      };
    },
  };
  const decision = {
    flow_break_even: {
      status: 'READY',
      observed_mix: {},
      economic_state: { period_result_kmf: null },
    },
  };
  const resultStep = () => {
    const block = flowBlock(doc, {}, decision);
    const resultRow = block.children.find(child => child.className === 'kmc-decision-chain-result');
    return resultRow.children.find(child => child.dataset?.decisionChainStep === 'period-result');
  };
  const resultValue = () => resultStep().children.find(child => child.tagName === 'strong').textContent;
  expect(resultValue()).toBe('—');
  expect(resultStep().className).toContain('is-derived');

  decision.flow_break_even.economic_state.period_result_kmf = -280;
  expect(resultValue()).toBe('-280 KMF');
  expect(resultStep().className).toContain('is-warning');

  decision.flow_break_even.economic_state.period_result_kmf = 280;
  expect(resultValue()).toBe('280 KMF');
  expect(resultStep().className).toContain('is-positive');

  decision.flow_break_even.economic_state.period_result_kmf = 0;
  expect(resultValue()).toBe('0 KMF');
  expect(resultStep().className).toContain('is-derived');

  decision.flow_break_even.economic_state.period_result_kmf = '';
  expect(resultValue()).toBe('—');
  decision.flow_break_even.economic_state.period_result_kmf = 280;
  decision.flow_break_even.status = 'NOT_DECISIONAL';
  expect(resultValue()).toBe('—');
  expect(resultStep().className).toContain('is-derived');
});
