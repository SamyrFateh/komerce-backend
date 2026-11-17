'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { classifyNetworkStage, SCREEN_PATH } = require('../staging-canonical/market-network-stage');

describe('canonical Réseau local — verdicts sans PASS métier implicite', () => {
  const base = { workspaceVisible: true, sectionVisible: true, relaisStatus: 200, providersStatus: 403, accessRequired: true };
  test('pointe vers le parcours de marché existant', () => {
    expect(SCREEN_PATH).toBe('/dashboards/canonical/market-autonomy.html');
  });
  test('surface visible avec GET autorisé = preuve écran seulement', () => {
    expect(classifyNetworkStage(base)).toEqual({ verdict: 'SCREEN_PASS', reason: 'VISIBLE_WITH_SERVER_AUTHORITY' });
  });
  test('écran manquant malgré droit de lecture = BLOCKED', () => {
    expect(classifyNetworkStage({ ...base, sectionVisible: false })).toEqual({
      verdict: 'BLOCKED', reason: 'NETWORK_SCREEN_MISSING_WITH_READ_AUTHORITY'
    });
  });
  test('droit réseau requis et serveur refuse = BLOCKED, jamais permission simulée', () => {
    expect(classifyNetworkStage({ ...base, relaisStatus: 403, providersStatus: 403, sectionVisible: false }))
      .toEqual({ verdict: 'BLOCKED', reason: 'REQUIRED_NETWORK_CAPABILITY_MISSING' });
  });
  test('acteur non habilité = NOT_PROVEN, jamais PASS', () => {
    expect(classifyNetworkStage({ ...base, relaisStatus: 403, providersStatus: 403, sectionVisible: false, accessRequired: false }))
      .toEqual({ verdict: 'NOT_PROVEN', reason: 'BOTH_NETWORK_READS_FORBIDDEN_FOR_ACTOR' });
  });
  test('un écran visible sans droit serveur est un incident', () => {
    expect(classifyNetworkStage({ ...base, relaisStatus: 403, providersStatus: 403, accessRequired: false }))
      .toEqual({ verdict: 'BLOCKED', reason: 'SCREEN_VISIBLE_WITHOUT_NETWORK_READ' });
  });
  test('un workspace d’autonomie inaccessible reste BLOCKED', () => {
    expect(classifyNetworkStage({ ...base, workspaceVisible: false }))
      .toEqual({ verdict: 'BLOCKED', reason: 'MARKET_AUTONOMY_WORKSPACE_UNAVAILABLE' });
  });
});
