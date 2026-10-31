'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const pricingEngine = require('../../services/pricing-engine');
const pricingCdr = require('../../services/pricing-cdr');
const db = require('../../db');

jest.mock('../../services/pricing-engine', () => ({
  recommend: jest.fn(),
}));
jest.mock('../../services/pricing-cdr', () => ({
  loadGlobalConfig: jest.fn(),
}));
jest.mock('../../services/market-local-price-resolution-service', () => ({
  resolveActiveProductMarketPricing: jest.fn(),
}));
jest.mock('../../utils/currency', () => ({
  projectAmount: jest.fn(async value => Number(value)),
}));
jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const corridor = require('../../services/pricing-market-corridor');
const list = require('../../public/dashboards/canonical/js/market-catalog-pricing-list');

const market = {id:'00000000-0000-4000-8000-000000000001',code:'KM',currency:'KMF',name:'Comores'};

beforeEach(() => {
  pricingCdr.loadGlobalConfig.mockResolvedValue({});
  pricingEngine.recommend.mockResolvedValue({
    landed_relay_cost_kmf: 15000, variable_cost_complete_kmf: 16000,
    contribution_kmf: 9000, minimum_safe_price_kmf: 17600,
    data_quality: 'estimated', strategy_risk: 'contributive',
  });
  db.query.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('FROM products')) return {rows:[{id:'00000000-0000-4000-8000-000000000002',product_ref:'KPR-1',name:'Produit',category:'audio',price_kmf:24000,cost_kmf:12000,weight_kg:1,is_active:true}]};
    if (text.includes('FROM market_price_observations')) return {rows:[
      {observation_ref:'L1',observed_amount:23000,currency:'KMF',price_kmf:23000},
      {observation_ref:'L2',observed_amount:25000,currency:'KMF',price_kmf:25000},
      {observation_ref:'L3',observed_amount:28000,currency:'KMF',price_kmf:28000},
    ]};
    if (text.includes('FROM product_market_price_drafts')) return {rows:[{status:'LOCAL_ACTIVE',amount:27000,currency:'KMF'}]};
    throw new Error('Unexpected SQL '+text);
  });
});

test('prix libre au-dessus du repère haut, sans autorisation supplémentaire', async () => {
  const result = await corridor.previewMarketPrice({market,productRef:'KPR-1',amount:32000});
  expect(result).toMatchObject({
    can_proceed:true, below_variable:false, requires_acknowledgement:false,
    contribution_local:16000,
  });
  expect(result.warnings).toContain('ABOVE_OBSERVED_MARKET');
  expect(list.priceMessage(result)).toMatch(/Au-dessus/);
});

test('erreur de saisie destructrice refusée côté serveur', async () => {
  pricingEngine.recommend.mockResolvedValueOnce({
    landed_relay_cost_kmf:15000,variable_cost_complete_kmf:16000,
    minimum_safe_price_kmf:17600,strategy_risk:'destructive',
  });
  const result = await corridor.previewMarketPrice({market,productRef:'KPR-1',amount:2500});
  expect(result.can_proceed).toBe(false);
  expect(result.below_variable).toBe(true);
});

test('prix sous le marché et chute anormale exigent une confirmation', async () => {
  const result = await corridor.previewMarketPrice({market,productRef:'KPR-1',amount:18000});
  expect(result.can_proceed).toBe(true);
  expect(result.warnings).toContain('BELOW_OBSERVED_MARKET');
  expect(result.warnings).toContain('SHARP_DROP_FROM_ACTIVE');
  expect(result.requires_acknowledgement).toBe(true);
});

test('aucune donnée de coût ne devient un zéro autorisant une publication', async () => {
  pricingEngine.recommend.mockResolvedValueOnce({
    landed_relay_cost_kmf:null,variable_cost_complete_kmf:null,
    minimum_safe_price_kmf:null,strategy_risk:null,
  });
  const result = await corridor.previewMarketPrice({market,productRef:'KPR-1',amount:25000});
  expect(result.can_proceed).toBe(false);
  expect(result.variable_cost_local).toBeNull();
});

test('le client demande une prévisualisation serveur et ne recalcule pas le coût économique', () => {
  const fs=require('fs');
  const path=require('path');
  const file=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/market-catalog-pricing-list.js'),'utf8');
  expect(file).toContain('/local-price/price-preview');
  expect(file).toContain('/local-price/change-active');
  expect(file).toContain('row.contribution_at_proposed_local');
  expect(file).not.toMatch(/input\.max\s*=/);
});
