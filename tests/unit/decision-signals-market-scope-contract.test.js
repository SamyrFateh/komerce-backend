'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('CAP-003 — decision-signals Market ID contract', () => {
  test('migration 218 adds nullable canonical market authority without inventing historical scope', () => {
    const sql = read('migrations/218_decision_signals_market_scope.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS market_id UUID NULL REFERENCES markets\(id\)/i);
    expect(sql).toMatch(/NULL = global fact/i);
    expect(sql).not.toMatch(/UPDATE\s+signals\s+SET\s+market_id/i);
    expect(sql).not.toMatch(/FROM\s+orders[\s\S]*UPDATE\s+signals/i);
  });

  test('active fact uniqueness includes market_id and therefore allows the same product fact in different markets', () => {
    const sql = read('migrations/218_decision_signals_market_scope.sql');
    expect(sql).toMatch(/DROP INDEX IF EXISTS idx_signals_active_fact_unique/i);
    expect(sql).toMatch(/ON signals\(signal_type, market_id, entity_type, entity_id\) NULLS NOT DISTINCT/i);
    expect(sql).toMatch(/status IN \('open','acknowledged','snoozed'\)/i);
  });

  test('decision_signal.manage is MARKET/DELEGABLE/LIVE and audited', () => {
    const { CAPABILITIES } = require('../../config/market-delegation-capabilities');
    expect(CAPABILITIES).toContainEqual(expect.objectContaining({
      capability: 'decision_signal.manage',
      class: 'DELEGATION',
      domain: 'pilotage',
      authority_scope: 'MARKET',
      delegation_mode: 'DELEGABLE',
      requires_audit: true,
      status: 'LIVE',
    }));
  });

  test('migration 219 promotes manager-shaped memberships only and audits the promotion', () => {
    const sql = read('migrations/219_market_delegation_decision_signal_manage_live.sql');
    expect(sql).toContain("'decision_signal.manage'");
    expect(sql).toContain("mc.capability = 'team.grant'");
    expect(sql).toContain("mc.capability = 'team.revoke'");
    expect(sql).toContain("mc.capability = 'network.read'");
    expect(sql).toContain('ceiling_template_capabilities');
    expect(sql).toContain('assignment_capability_ceiling');
    expect(sql).toContain('CAPABILITY_GRANTED_BY_PROMOTION');
    expect(sql).toContain('migration-219');
  });

  test('market Action Center has no market generate route: lifecycle only', () => {
    const route = read('routes/admin-action-center.js');
    expect(route).toContain("'/market/:marketCode'");
    expect(route).toContain("'/market/:marketCode/signals/:signalRef/acknowledge'");
    expect(route).toContain("'/market/:marketCode/signals/:signalRef/snooze'");
    expect(route).toContain("'/market/:marketCode/signals/:signalRef/resolve'");
    expect(route).not.toContain("'/market/:marketCode/generate'");
    expect(route).toContain("resolveMarketAuthority(req, 'decision_signal.manage')");
  });

  test('Canonical UI selects a country endpoint only from server AdminContext mode/allowedMarkets', async () => {
    const ui = require('../../public/dashboards/canonical/js/action-center');
    const adminContext = {
      access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM' },
    };
    expect(ui.selectedMarketCode(adminContext, { href: 'https://komerce.co/admin/action-center?market=CG' })).toBe('CM');

    const runtime = await ui.resolveRuntimeScope({
      adminContext,
      fetch: jest.fn(),
      location: { href: 'https://komerce.co/admin/action-center' },
    });
    expect(runtime).toMatchObject({
      mode: 'market',
      marketCode: 'CM',
      endpoint: '/api/admin/action-center/market/CM',
    });
  });

  test('global AdminContext remains on the explicitly global endpoint', async () => {
    const ui = require('../../public/dashboards/canonical/js/action-center');
    const runtime = await ui.resolveRuntimeScope({
      adminContext: { access: { mode: 'global', allowedMarkets: ['CM', 'CG'], defaultMarket: null } },
      fetch: jest.fn(),
      location: { href: 'https://komerce.co/admin/action-center?market=CM' },
    });
    expect(runtime).toMatchObject({ mode: 'global', marketCode: null, endpoint: '/api/admin/action-center' });
  });
});
