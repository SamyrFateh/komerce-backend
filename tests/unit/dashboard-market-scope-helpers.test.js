'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  buildFiltersClause,
  buildSignalMarketClause,
} = require('../../services/dashboard-metrics/_helpers');

describe('dashboard metrics — MarketScope helpers', () => {
  test('market_id est bindé comme filtre interne sur orders', () => {
    const result = buildFiltersClause({ market_id: 'market-cm' });
    expect(result.where).toContain('o.market_id = $1');
    expect(result.params).toEqual(['market-cm']);
    expect(result.nextParamIndex).toBe(2);
  });

  test('market_id garde un index stable après les filtres historiques', () => {
    const result = buildFiltersClause({
      from: '2026-08-01',
      status: 'confirmed',
      market_id: 'market-cg',
    }, 'ord');

    expect(result.where).toContain('ord.created_at >= $1');
    expect(result.where).toContain('ord.status::text = $2');
    expect(result.where).toContain('ord.market_id = $3');
    expect(result.params).toEqual(['2026-08-01', 'confirmed', 'market-cg']);
  });

  test('sans market_id le prédicat signal reste global et sans paramètre', () => {
    expect(buildSignalMarketClause({}, 's', 3)).toEqual({
      where: '1=1',
      params: [],
      nextParamIndex: 3,
    });
  });

  test('un signal market-scoped doit prouver son rattachement via une entité scoppable', () => {
    const result = buildSignalMarketClause({ market_id: 'market-km' }, 'sig', 2);

    expect(result.params).toEqual(['market-km']);
    expect(result.nextParamIndex).toBe(3);
    expect(result.where).toContain("sig.entity_type = 'order'");
    expect(result.where).toContain("sig.entity_type = 'parcel'");
    expect(result.where).toContain("sig.entity_type = 'cash_collection'");
    expect(result.where).toContain('scope_o.market_id = $2');
    expect(result.where).not.toContain("entity_type = 'product'");
  });
});
