'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/market-team.js'), 'utf8');

describe('market-team — libellés des capacités', () => {
  test('l\'habilitation à recevoir des espèces est libellée avec son plafond par personne', () => {
    expect(src).toContain("'cash.custody.receive': 'Recevoir des espèces en garde (plafond par personne)'");
  });

  test('le contrôle des encaissements reste libellé', () => {
    expect(src).toContain("'cash_control.policy.manage': 'Gérer le contrôle des encaissements'");
  });
});
