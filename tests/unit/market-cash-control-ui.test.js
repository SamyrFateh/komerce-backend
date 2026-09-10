'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('market cash-control UI', () => {
  test('Autonomie pays charge le composant cash via assets externes CSP-safe', () => {
    const html = read('public/dashboards/canonical/market-autonomy.html');
    expect(html).toContain('/dashboards/canonical/css/market-cash-control.css');
    expect(html).toContain('/dashboards/canonical/js/market-cash-control.js');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  test('la politique est lue et modifiée dans le Market ID résolu serveur', () => {
    const js = read('public/dashboards/canonical/js/market-cash-control.js');
    expect(js).toContain("request('/api/admin/dashboard/context')");
    expect(js).toContain('/api/market-delegation/markets/${encodeURIComponent(marketCode)}/cash-control-policy');
    expect(js).toContain("method: 'PUT'");
    expect(js).toContain('cash_enabled: enabled.checked');
    expect(js).toContain('confirmation_mode: select.value');
    expect(js).not.toContain('market_id');
    expect(js).not.toContain('marketId');
  });

  test('le partenaire choisit SINGLE ou DUAL_ALWAYS sans seuil monétaire implicite', () => {
    const js = read('public/dashboards/canonical/js/market-cash-control.js');
    expect(js).toContain("['SINGLE', 'Validation simple · 1 personne habilitée']");
    expect(js).toContain("['DUAL_ALWAYS', 'Validation double · 2 personnes distinctes']");
    expect(js).not.toMatch(/DUAL_ABOVE_THRESHOLD/i);
    expect(js).not.toMatch(/\b\w*threshold_minor\b/i);
    expect(js).not.toMatch(/\b(?:amount|total)_kmf\b/i);
  });

  test('la mutation n’est offerte que quand le serveur renvoie can_manage', () => {
    const js = read('public/dashboards/canonical/js/market-cash-control.js');
    expect(js).toContain('const canManage = Boolean(payload.can_manage)');
    expect(js).toContain("feedback.textContent = 'Lecture seule · la modification exige cash_control.policy.manage.'");
    expect(js).toContain('enabled.disabled = !canManage');
    expect(js).toContain('select.disabled = !canManage');
  });

  test('la section s’insère avant Équipe & délégation quand celle-ci est déjà montée', () => {
    const js = read('public/dashboards/canonical/js/market-cash-control.js');
    expect(js).toContain("root.querySelector('[data-market-team]')");
    expect(js).toContain('root.insertBefore(section, teamSection)');
    expect(js).toContain('section.dataset.marketCashControl');
  });
});
