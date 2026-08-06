'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/alerts-contract-check.test.js
 *
 * Mission ALERTS_CONTRACT_RECOVERY §13 — negative tests du gate
 * `npm run alerts:contract:check`. Le gate doit détecter LE PATTERN
 * legacy `alerts(level, source, message, payload)`, pas une liste figée
 * de fichiers connus : chaque cas ci-dessous écrit un fixture jetable
 * dans un faux répertoire runtime, puis vérifie que le scan le classe
 * correctement.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanForLegacyAlertWriters } = require('../../scripts/alerts-contract-check');

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-gate-'));
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

describe('alerts-contract-check gate — negative tests (mission §13)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = makeTmpRoot();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('A — INSERT legacy simple (une ligne) → BLOCK', () => {
    writeFile(
      tmpRoot,
      'services/offender-a.js',
      `db.query(\`INSERT INTO alerts (level, source, message, payload) VALUES ($1,$2,$3,$4)\`, args);`
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toContain('services/offender-a.js');
  });

  test('B — INSERT legacy multiline → BLOCK', () => {
    writeFile(
      tmpRoot,
      'services/offender-b.js',
      [
        'const sql = `INSERT INTO alerts (level, source, message, payload)',
        '  VALUES ($1, $2, $3, $4)`;',
      ].join('\n')
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toContain('services/offender-b.js');
  });

  test('C — lowercase insert into alerts → BLOCK', () => {
    writeFile(
      tmpRoot,
      'services/offender-c.js',
      'db.query(`insert into alerts (level, source, message, payload) values ($1,$2,$3,$4)`);'
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toContain('services/offender-c.js');
  });

  test('D — legacy + created_at → BLOCK', () => {
    writeFile(
      tmpRoot,
      'utils/offender-d.js',
      'db.query(`INSERT INTO alerts (level, source, message, payload, created_at) VALUES ($1,$2,$3,$4,NOW())`);'
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toContain('utils/offender-d.js');
  });

  test('E — current schema insert (createAlert) → PASS', () => {
    writeFile(
      tmpRoot,
      'services/clean-e.js',
      [
        'async function createAlert(dbOrClient, alert) {',
        '  return dbOrClient.query(',
        '    `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description)',
        '     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,',
        '    [alert.type, alert.entityType, alert.entityId, alert.severity, alert.title, alert.description]',
        '  );',
        '}',
      ].join('\n')
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).not.toContain('services/clean-e.js');
  });

  test('F — documentation historique (hors répertoires runtime scannés) → PASS', () => {
    writeFile(
      tmpRoot,
      'docs/_archive/alerts-compat-pr563/README.md',
      'Ancien contrat : INSERT INTO alerts (level, source, message, payload).'
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toEqual([]);
  });

  test('G — fixture negative explicitement déclarée → PASS', () => {
    writeFile(
      tmpRoot,
      'services/negative-fixture-g.js',
      [
        '// ALERTS_CONTRACT_CHECK_NEGATIVE_FIXTURE',
        '// Fixture de test volontairement legacy, non exécutée en runtime.',
        'const legacySample = "INSERT INTO alerts (level, source, message, payload) VALUES ($1,$2,$3,$4)";',
      ].join('\n')
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).not.toContain('services/negative-fixture-g.js');
  });

  test('H — runtime nouveau writer legacy dans un fichier inconnu (pas dans la liste des 15) → BLOCK', () => {
    writeFile(
      tmpRoot,
      'services/brand-new-writer-never-seen-before.js',
      'client.query(`INSERT INTO alerts (level, source, message, payload) VALUES ($1,$2,$3,$4)`);'
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toContain('services/brand-new-writer-never-seen-before.js');
  });

  test('directories hors périmètre runtime (ex: scripts/) ne sont pas scannés', () => {
    writeFile(
      tmpRoot,
      'scripts/some-tool.js',
      'const legacy = "INSERT INTO alerts (level, source, message, payload)";'
    );
    const offenders = scanForLegacyAlertWriters(tmpRoot);
    expect(offenders).toEqual([]);
  });
});

describe('alerts-contract-check gate — état réel du repo', () => {
  test('LEGACY_ALERT_RUNTIME_WRITERS = 0 sur le repo courant', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const offenders = scanForLegacyAlertWriters(repoRoot);
    expect(offenders).toEqual([]);
  });
});
