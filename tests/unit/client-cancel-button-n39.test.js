/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../public/boutique/js/b-tracking.js'), 'utf8');

describe('N39 : bouton Annuler côté client (Mon Komerce)', () => {
  test('branché sur la route existante, sans rejeu automatique, après confirmation', () => {
    expect(src).toContain("'/api/orders/' + encodeURIComponent(order.id) + '/cancel'");
    expect(src).toContain('{ retries: 0 }');
    expect(src).toContain('window.confirm(');
  });
  test('refus serveur affiché explicitement ; commandes terminées sans bouton ; rendu privé uniquement', () => {
    expect(src).toContain("'Annulation refusée : '");
    expect(src).toContain("['cancelled', 'refunded', 'collected']");
    expect(src).toMatch(/privateResources !== null\) \{ appendPickupCodeAction\(container, order\); appendCancelAction\(container, order\)/);
  });
});

describe('Dépôt de caisse : point d\'entrée du responsable marché', () => {
  const j = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/finance-journal-workspace.js'), 'utf8');
  test('onglet Garde des espèces monte le workspace comptabilité (bouton Enregistrer la réception)', () => {
    expect(j).toContain("id: 'custody'");
    expect(j).toContain('KomerceCanonicalFinanceAccountingWorkspace');
    expect(j).toContain('custodyView.mount({ ...options, root: content })');
  });
});
