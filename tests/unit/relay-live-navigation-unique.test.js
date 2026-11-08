'use strict';
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js', name), 'utf8');

describe('Relais Live — navigation unifiée', () => {
  test('le shell ne produit pas un deuxième rail sur le poste Relais', () => {
    const policy = read('navigation-policy-v4.js');
    expect(policy).toMatch(/domainId === 'live' && String\(global\.location\?\.pathname \|\| ''\) === '\/admin\/relais-live'/);
    expect(policy).toContain('return []; // Le rail Flux / Remises / Incidents / Historique');
  });

  test('quatre espaces métiers et pas de liens doublés sous le Kanban', () => {
    const relay = read('relay-live.js');
    for (const label of ['Flux Relais', 'Remises', 'Incidents & SAV', 'Historique']) {
      expect(relay).toContain("name:'" + label + "'");
    }
    expect(relay).not.toContain('kmc-relay-overview-tail');
    expect(relay).toContain('Contrôler les arrivages');
    expect(relay).toContain('Ouvrir les remises');
  });

  test('le comptoir et l atelier métier offrent les mêmes liens de retour Relais', () => {
    const workspace = read('operations-workspace.js');
    expect(workspace).toContain("if(context.mode==='relay-execution') {\n      const nav=doc.createElement('nav');");
    expect(workspace).toContain("header.querySelector('.kmc-workspace-nav')?.remove()");
    for (const label of ['Flux Relais', 'Remises', 'Incidents & SAV', 'Historique']) {
      expect(workspace).toContain("['" + label + "'");
    }
    expect(workspace).toContain('context.marketCode');
  });
});
