'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','pilotage-decision.js'),'utf8');

describe('pilotage-decision visual hierarchy contract',()=>{
  test('keeps Pilotage to hero attention and one primary object only',()=>{
    expect(SRC).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    const renderStart=SRC.indexOf('function render(rootNode');
    const renderSource=SRC.slice(renderStart);
    const hero=renderSource.indexOf("data-dashboard-role', 'hero");
    const attention=renderSource.indexOf("data-dashboard-role', 'attention");
    const primary=renderSource.indexOf("data-dashboard-role', 'primary");
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    expect(renderSource).not.toContain("data-dashboard-role', 'secondary");
    expect(renderSource).not.toContain("cardSection(\n        doc,\n        'Causes structurelles'");
    expect(renderSource).not.toContain("cardSection(\n        doc,\n        'À traiter'");
  });
});

test('les liens du Pilotage vers fiches 360 / PO portent le retour vers le Pilotage ; plus de filtres ignorés', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/pilotage-decision.js'), 'utf8');
  expect(src).toContain("nav.withNavContext(href, 'Retour au pilotage')");
  expect(src).toContain("href: withReturn(row.href || '/admin/operations#operations-control-chain')");
  expect(src).toContain("href: withReturn(projected.href || '/admin/action-center')");
  expect(src).not.toContain('cost_status=');
  expect(src).not.toContain("'/admin/finance#finance-incomplete-costs'");
  expect(src).toContain("href: withReturn('/admin/operations'), actionLabel: 'Examiner les commandes →'");
});

describe('Pilotage — liens avec contexte (marché, période, scope) et retour avec query', () => {
  afterEach(() => { delete globalThis.location; delete globalThis.KomerceCanonicalNavigation; });

  test('un lien vers Finance/Opérations porte le contexte et un return_to avec query ; ancre conservée', () => {
    jest.resetModules();
    globalThis.location = { pathname: '/admin/pilotage', search: '?market=KM&period=7&simulation_scope=RCT1' };
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    const pilotage = require('../../public/dashboards/canonical/js/pilotage-decision.js');
    const base = { formatNumber: v => String(v), canonicalAdminHref: v => v };
    const payload = {
      view_blocks: [{ view: 'finance', title: 'Finance', url: '/admin/finance', kpis_summary: [] }],
      kpis: [{ key: 'cmds_actives', value: 3 }],
      control_chain: { stages: [{ key: 'order_created', order_count: 1, health: 'GREEN' }] },
    };
    const cards = pilotage.summaryCards(payload, base);
    const url = new URL(cards[0].href, 'http://x.test');
    expect(url.pathname).toBe('/admin/finance');
    expect(url.searchParams.get('market')).toBe('KM');
    expect(url.searchParams.get('period')).toBe('7');
    expect(url.searchParams.get('simulation_scope')).toBe('RCT1');
    expect(url.searchParams.get('return_to')).toBe('/admin/pilotage?market=KM&period=7&simulation_scope=RCT1');
    expect(url.searchParams.get('return_label')).toBe('Retour au pilotage');

    const stage = pilotage.controlStages(payload)[0];
    expect(stage.href).toMatch(/^\/admin\/operations\?market=KM&period=7&simulation_scope=RCT1&return_to=.*#operations-control-chain$/);
  });

  test('sans contexte, le lien reste simple ; une ancre locale et une valeur vide ne sont pas modifiées', () => {
    jest.resetModules();
    globalThis.location = { pathname: '/admin/pilotage', search: '' };
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    const nav = globalThis.KomerceCanonicalNavigation;
    expect(nav.withNavContext('/admin/finance', 'Retour')).toBe('/admin/finance?return_to=%2Fadmin%2Fpilotage&return_label=Retour');
    expect(nav.withNavContext('#pilotage-alerts', 'Retour')).toBe('#pilotage-alerts');
    expect(nav.withNavContext(undefined, 'Retour')).toBeUndefined();
    expect(nav.withNavContext('/admin/workspaces/pricing', 'Retour')).toBe('/admin/workspaces/pricing');
  });
});
