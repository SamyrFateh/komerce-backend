'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'market-network.js'), 'utf8');

describe('market-network (Réseau local) — île et rattachement agent', () => {
  test('marché insulaire : sélecteur d\'île alimenté par island_options du serveur, obligatoire, remplace le champ libre', () => {
    expect(ui).toContain('relaisData.island_options || []');
    expect(ui).toContain('islandOptions.forEach((code)');
    expect(ui).toContain('islandSelect.required = true');
    expect(ui).toContain("L’île du relais est obligatoire.");
    expect(ui).toContain('island_code: islandSelect.value');
    expect(ui).toContain('...(islandOptions.length ? [] : [[\'island\'');
  });
  test('rattachement : geste réservé à network.update, agents issus du serveur, POST sur la route gouvernée', () => {
    expect(ui).toContain("relais.is_active && canUpdate && agents.length");
    expect(ui).toContain('/network/relais-agents');
    expect(ui).toContain('/network/relais/${encodeURIComponent(relais.id)}/agents');
    expect(ui).toContain('body: { user_id: select.value }');
    expect(ui).not.toMatch(/market_id|marketId/);
  });
});
