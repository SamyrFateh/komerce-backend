'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

test('la section Protection des encaissements conserve l’ancre du menu', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/market-cash-control.js'), 'utf8');
  expect(source).toContain("section.id = 'market-cash-control'");
});

require('../helpers/canon-market-domain-modules').proveDeniedModule('market-cash-control','KomerceMarketCashControl');
