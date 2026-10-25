'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
// Dette WRITER-NOT-OWNER nominative : déclarer une écriture la rend visible, jamais autorisée.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/writer-not-owner-debt.json'), 'utf8')).entries;
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/business-graph-drift-baseline.json'), 'utf8')).baseline;
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/debt-zero-registry.json'), 'utf8')).files;

describe('registre nominatif WRITER-NOT-OWNER', () => {
  test('la baseline numérique égale exactement le nombre d’entrées (le cliquet ne peut que descendre)', () => {
    const declared = Object.entries(baseline).filter(([k]) => k.startsWith('WRITER-NOT-OWNER::')).reduce((a, [, v]) => a + v, 0);
    expect(declared).toBe(ledger.length);
  });

  test('chaque entrée est une dette documentée : sites existants, statut, risque et correction', () => {
    const statuses = new Set(['dette à résorber', 'délégation légitime à formaliser', 'écriture technique']);
    for (const e of ledger) {
      expect(e.owner).not.toBe(e.writer);
      expect(statuses.has(e.status)).toBe(true);
      expect(e.risk).toMatch(/^P[0-3] — /);
      expect(e.correction.length).toBeGreaterThan(10);
      for (const site of e.sites) {
        const [file, fn] = site.split('#');
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        expect(src).toMatch(new RegExp(`function ${fn}\\b`));
      }
    }
  });

  test('aucune identité table<-writer en double', () => {
    const ids = ledger.map(e => `${e.table}<-${e.writer}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('suivi par Debt Zero par identité : toute nouvelle entrée exige un accord humain', () => {
    expect(registry['governance/writer-not-owner-debt.json']).toEqual({ kind: 'identity-array', path: 'entries', identity: ['table', 'writer'] });
  });

  test('le ratchet compare les identités, pas seulement le total', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/business-graph-ratchet-check.js'), 'utf8');
    expect(src).toContain('writer-not-owner-debt.json');
    expect(src).toContain('résolue — retirer l\'entrée');
  });
});
