'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCheck, scanMigration, BASELINE, CURRENCY_CODES } = require('../../scripts/check-currency-format');

/** Fabrique un faux dépôt avec un dossier migrations/ isolé. */
function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'currency-gate-'));
  fs.mkdirSync(path.join(root, 'migrations'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'migrations', name), content);
  }
  return root;
}

describe('check-currency-format — gate anti-dette devise', () => {
  test('accepte le format cible : montant numeric + colonne currency', () => {
    const root = makeRepo({
      '211_ok.sql': `CREATE TABLE t (
  amount    NUMERIC(24,6) NOT NULL,
  currency  TEXT NOT NULL
);`,
    });
    expect(runCheck({ root, print: false })).toMatchObject({ ok: true, violations: [] });
  });

  test('refuse une colonne suffixée d’une devise dans un CREATE TABLE', () => {
    const root = makeRepo({ '211_ko.sql': 'CREATE TABLE t (\n  total_kmf INTEGER NOT NULL\n);' });
    const result = runCheck({ root, print: false });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatchObject({ column: 'total_kmf' });
  });

  test('refuse un ADD COLUMN inline sur une seule ligne', () => {
    // Forme courante que la première version du gate ratait — trouvée par
    // test de mutation, pas par relecture.
    const root = makeRepo({ '211_ko.sql': 'ALTER TABLE t ADD COLUMN IF NOT EXISTS bonus_aed INTEGER;' });
    const result = runCheck({ root, print: false });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatchObject({ column: 'bonus_aed' });
  });

  test('ignore les mentions en commentaire', () => {
    // Un commentaire qui explique la dette ne doit pas être compté comme une
    // colonne : sinon documenter le problème deviendrait une violation.
    const root = makeRepo({ '211_ok.sql': '-- price_kmf reste en integer, voir audit devise.\nCREATE TABLE t (id UUID);' });
    expect(runCheck({ root, print: false }).ok).toBe(true);
  });

  test('ne juge jamais l’historique : migrations <= BASELINE ignorées', () => {
    // check-migration-immutability.js interdit de réécrire le passé ; ce gate
    // ne doit donc pas transformer l'existant en échec permanent.
    const root = makeRepo({ [`${BASELINE}_historique.sql`]: 'CREATE TABLE t (\n  legacy_kmf INTEGER\n);' });
    const result = runCheck({ root, print: false });
    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(0);
  });

  test('ne confond pas un suffixe métier avec un code devise', () => {
    // Le jeu de devises est explicite plutôt que /[a-z]{3}$/ : sinon
    // `poids_net` ou `total_ttc` déclencheraient de faux positifs.
    const root = makeRepo({
      '211_ok.sql': `CREATE TABLE t (
  poids_net  NUMERIC(10,2),
  total_ttc  NUMERIC(10,2),
  delai_max  INTEGER
);`,
    });
    expect(runCheck({ root, print: false }).ok).toBe(true);
  });

  test('couvre toutes les devises manipulées par Komerce', () => {
    for (const code of CURRENCY_CODES) {
      const root = makeRepo({ '211_ko.sql': `CREATE TABLE t (\n  montant_${code} INTEGER\n);` });
      expect(runCheck({ root, print: false }).ok).toBe(false);
    }
  });

  test('tolère une colonne DROP puis re-ADD dans la MÊME migration — recréation, pas création', () => {
    // Cas réel (migration 221) : customs_delta_kmf est une colonne GÉNÉRÉE,
    // et Postgres refuse d'altérer le type de ses sources tant qu'elle
    // existe. La seule voie est DROP + recréation à l'identique. La compter
    // comme violation forcerait à renommer la colonne (changement de contrat)
    // ou à contourner le gate.
    const root = makeRepo({
      '211_ok.sql': [
        'ALTER TABLE t DROP COLUMN calc_kmf;',
        'ALTER TABLE t ADD COLUMN calc_kmf NUMERIC(14,2);',
      ].join('\n'),
    });
    expect(runCheck({ root, print: false }).ok).toBe(true);
  });

  test('mais une VRAIE nouvelle colonne reste refusée, même dans une migration qui fait des DROP', () => {
    // L'exception ne doit pas devenir une échappatoire : dropper une colonne
    // ne doit pas autoriser à en ajouter une autre au mauvais format.
    const root = makeRepo({
      '211_ko.sql': [
        'ALTER TABLE t DROP COLUMN calc_kmf;',
        'ALTER TABLE t ADD COLUMN calc_kmf NUMERIC(14,2);',
        'ALTER TABLE t ADD COLUMN nouveau_total_kmf INTEGER;',
      ].join('\n'),
    });
    const result = runCheck({ root, print: false });
    expect(result.ok).toBe(false);
    expect(result.violations.map(v => v.column)).toEqual(['nouveau_total_kmf']);
  });

  test('scanMigration remonte la ligne exacte, pour un message actionnable', () => {
    const root = makeRepo({ '211_ko.sql': 'CREATE TABLE t (\n  id UUID,\n  fee_eur NUMERIC(12,2)\n);' });
    const offenders = scanMigration(path.join(root, 'migrations', '211_ko.sql'));
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(3);
  });
});
