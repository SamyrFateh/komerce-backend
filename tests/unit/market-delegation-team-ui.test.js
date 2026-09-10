'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('market-delegation team UI', () => {
  test('Autonomie pays charge la surface équipe avec scripts/styles externes CSP-safe', () => {
    const html = read('public/dashboards/canonical/market-autonomy.html');
    expect(html).toContain('/dashboards/canonical/css/market-team.css');
    expect(html).toContain('/dashboards/canonical/js/market-team.js');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  test('la page invitation conserve le lien pendant login, permet de créer un compte client puis accepte explicitement', () => {
    const html = read('public/dashboards/canonical/team-invite.html');
    const js = read('public/dashboards/canonical/js/team-invite.js');

    expect(html).toContain('/dashboards/canonical/js/team-invite.js');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(js).toContain("global.fetch('/api/auth/me'");
    expect(js).toContain("'/login.html?next='");
    expect(js).toContain("request('/api/auth/register'");
    expect(js).toContain('full_name: fullName.value.trim()');
    expect(js).toContain('email: email.value.trim()');
    expect(js).toContain('phone: phone.value.trim()');
    expect(js).toContain('password: password.value');
    expect(js).toContain('/api/market-delegation/team/invitations/');
    expect(js).toContain('/accept');
    expect(js).toContain("method: 'POST'");
    expect(js).not.toMatch(/role\s*:\s*['\"]market_operator['\"]/);
  });

  test('après acceptation le token est retiré et le Market ID vient du contexte serveur', () => {
    const js = read('public/dashboards/canonical/js/team-invite.js');
    expect(js).toContain("global.history.replaceState({}, '', '/dashboards/canonical/team-invite.html?accepted=1')");
    expect(js).toContain("request('/api/admin/dashboard/context')");
    expect(js).toContain('access.allowedMarkets');
    expect(js).not.toContain('market_id');
    expect(js).not.toContain('marketId');
  });

  test('la gestion équipe ne peut sélectionner que des capabilities renvoyées au grantor', () => {
    const js = read('public/dashboards/canonical/js/market-team.js');
    expect(js).toContain('const available = [...team.actor_capabilities].sort()');
    expect(js).toContain("'cash_control.policy.manage': 'Gérer le contrôle des encaissements'");
    expect(js).toContain('/team/invitations');
    expect(js).toContain('/capabilities');
    expect(js).not.toContain('market_id');
    expect(js).not.toContain('marketId');
  });
});
