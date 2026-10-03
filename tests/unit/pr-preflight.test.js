'use strict';

const { buildPlan } = require('../../scripts/pr-preflight');

function labels(scope) {
  return buildPlan({
    backend: false,
    dashboard: false,
    boutique: false,
    governance: false,
    migrations: false,
    changedFiles: [],
    ...scope,
  }, 'base-sha', 'head-sha').map(step => step.label);
}

test('preflight garde un socle unique de gates carte-first et debt-zero', () => {
  expect(labels({})).toEqual(expect.arrayContaining([
    'Feature registry',
    'Feature card schema',
    'Touched files ownership',
    'Docs history',
    'Feature audit',
    'Debt Zero',
  ]));
});

test('preflight backend ajoute les preuves rapides sans lancer le from-scratch DB', () => {
  const plan = labels({ backend: true });
  expect(plan).toEqual(expect.arrayContaining([
    'Touched tests / completion-at-contact',
    'Backend code quality',
    'Backend feature guard',
    'Contract consumer check',
  ]));
  expect(plan.join(' ')).not.toMatch(/From-scratch|integration|E2E API/i);
});

test('preflight gouvernance réutilise les gates architecture existants', () => {
  expect(labels({ governance: true })).toEqual(expect.arrayContaining([
    'Architecture graph refresh',
    'Architecture header hygiene',
    'Headers ↔ SQL',
    'Business graph ratchet',
  ]));
});

test('preflight boutique réutilise le check rapide du workspace', () => {
  expect(labels({ boutique: true })).toContain('Boutique fast gates');
});

describe('parité CI (PR 1 — preflight au niveau de la CI)', () => {
  test('backend rejoue audit, certification, Security 360 et tests liés comme la CI', () => {
    expect(labels({ backend: true })).toEqual(expect.arrayContaining([
      'Npm audit gate',
      'Catalog + sourcing certification invariants',
      'Security 360 freshness and ratchet',
      'Related unit tests',
    ]));
  });

  test('les tests liés reçoivent aussi les migrations, ce qui force la suite complète en local', () => {
    const plan = buildPlan({
      backend: true, migrations: true, backendFiles: ['services/a.js'], migrationFiles: ['migrations/999_a.sql'], changedFiles: ['x'],
    }, 'base-sha', 'head-sha');
    const related = plan.find(step => step.label === 'Related unit tests');
    expect(related.argv).toEqual(['scripts/run-staged-related-tests.js', '--files', 'services/a.js,migrations/999_a.sql']);
  });

  test('migrations : historique complet exigé puis gates de schéma de la CI', () => {
    const plan = labels({ migrations: true });
    expect(plan).toEqual(expect.arrayContaining([
      'Migration history depth', 'Migration immutability', 'Schema freshness', 'Schema intent documentation',
    ]));
    expect(plan.indexOf('Migration history depth')).toBeLessThan(plan.indexOf('Schema freshness'));
    expect(plan).not.toContain('Schema anti-resurrection');
    expect(labels({ migrations: true, schemaDump: true })).toContain('Schema anti-resurrection');
  });

  test('gouvernance : projections hydratées puis tous les gates du job governance', () => {
    const plan = labels({ governance: true });
    expect(plan).toEqual(expect.arrayContaining([
      'Governance projections hydration', 'Hub authority gate', 'Feature slice guard',
      'Business graph semantic check', 'Business graph dependency disposition',
      'Feature 360 projection check', 'Agent remediation contract', 'Agent remediation index check',
    ]));
    expect(labels({ governance: true, backend: true })).not.toContain('Feature slice guard');
  });

  test('dashboard, boutique, golden et preuves isolées rejouent leurs gates CI', () => {
    expect(labels({ dashboard: true })).toContain('Dashboard 360 structural ratchet');
    expect(labels({ golden: true })).toContain('Golden CDR parity');
    expect(labels({ boutique: true, boutiqueCss: true, boutiqueJs: true })).toEqual(expect.arrayContaining([
      'Boutique global ownership', 'Boutique selector ownership', 'Boutique runtime CSS var ownership',
      'Boutique CSS vars', 'Boutique z-index contract', 'Boutique sticky integrity', 'Sanitization on added front lines',
    ]));
    expect(labels({ boutique: true })).not.toContain('Boutique CSS vars');
    expect(labels({ providerProofOnly: true })).toEqual(expect.arrayContaining([
      'Provider proof syntax', 'Provider proof unit contract', 'Provider offline inventory',
    ]));
    expect(labels({ cjPilotProofOnly: true })).toContain('CJ pilot report syntax');
  });

  test('le registre de routes est hydraté avant l’audit et le contrôle d’arbre ferme toujours le plan', () => {
    const plan = labels({});
    expect(plan.indexOf('Route registry hydration')).toBeLessThan(plan.indexOf('Feature audit'));
    expect(plan[plan.length - 1]).toBe('Tree unchanged (derived artifacts)');
    expect(plan).toContain('Impact suppression hygiene');
  });

  test('le preflight ne lance jamais la preuve from-scratch DB ni la couverture globale', () => {
    const all = labels({
      backend: true, dashboard: true, boutique: true, governance: true, migrations: true, golden: true,
    }).join(' ');
    expect(all).not.toMatch(/From-scratch|test:integration|coverage/i);
  });
});

describe('contrôles en processus', () => {
  const cp = require('child_process');
  const preflight = require('../../scripts/pr-preflight');
  let spawn;

  function fakeGit(handlers) {
    spawn = jest.spyOn(cp, 'spawnSync').mockImplementation((bin, argv) => {
      const key = argv.join(' ');
      for (const [pattern, out] of handlers) {
        if (key.startsWith(pattern)) return typeof out === 'function' ? out(argv) : { status: 0, stdout: out };
      }
      return { status: 0, stdout: '' };
    });
  }

  afterEach(() => { if (spawn) spawn.mockRestore(); spawn = null; });

  test('historique superficiel : arrêt explicite avec la commande à lancer', () => {
    fakeGit([['rev-parse --is-shallow-repository', 'true']]);
    expect(() => preflight.assertFullHistory()).toThrow(/git fetch --unshallow origin/);
  });

  test('historique complet : aucune erreur', () => {
    fakeGit([['rev-parse --is-shallow-repository', 'false']]);
    expect(() => preflight.assertFullHistory()).not.toThrow();
  });

  test('trackedChanges hache les fichiers suivis modifiés et marque les supprimés', () => {
    fakeGit([
      ['diff --name-only HEAD', 'a.js\ngone.js'],
      ['hash-object -- a.js', 'h-a'],
      ['hash-object -- gone.js', () => ({ status: 1, stderr: 'missing' })],
    ]);
    expect([...preflight.trackedChanges()]).toEqual([['a.js', 'h-a'], ['gone.js', 'deleted']]);
  });

  test('un fichier suivi réécrit par un gate bloque et nomme l’artefact', () => {
    fakeGit([
      ['diff --name-only HEAD', 'docs/SECURITY_360.json'],
      ['hash-object -- docs/SECURITY_360.json', 'new'],
    ]);
    expect(() => preflight.assertTreeUnchanged(new Map()))
      .toThrow(/docs\/SECURITY_360\.json.*Régénérer et committer/);
  });

  test('une projection restaurée par la CI est remise en état si elle était propre, sans bloquer', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const calls = [];
    fakeGit([
      ['diff --name-only HEAD', 'docs/FEATURE_360.json'],
      ['hash-object -- docs/FEATURE_360.json', 'regenerated'],
      ['checkout -- docs/FEATURE_360.json', (argv) => { calls.push(argv.join(' ')); return { status: 0, stdout: '' }; }],
    ]);
    expect(() => preflight.assertTreeUnchanged(new Map())).not.toThrow();
    expect(calls).toEqual(['checkout -- docs/FEATURE_360.json']);
    log.mockRestore();
  });

  test('une projection déjà modifiée avant le preflight n’est jamais écrasée', () => {
    const calls = [];
    fakeGit([
      ['diff --name-only HEAD', 'docs/FEATURE_360.json'],
      ['hash-object -- docs/FEATURE_360.json', 'after'],
      ['checkout', (argv) => { calls.push(argv.join(' ')); return { status: 0, stdout: '' }; }],
    ]);
    preflight.assertTreeUnchanged(new Map([['docs/FEATURE_360.json', 'before']]));
    expect(calls).toEqual([]);
  });

  test('un fichier modifié avant et inchangé ensuite ne bloque pas ; une modification annulée par un gate bloque', () => {
    fakeGit([
      ['diff --name-only HEAD', 'services/a.js'],
      ['hash-object -- services/a.js', 'same'],
    ]);
    expect(() => preflight.assertTreeUnchanged(new Map([['services/a.js', 'same']]))).not.toThrow();
    spawn.mockRestore();
    fakeGit([['diff --name-only HEAD', '']]);
    expect(() => preflight.assertTreeUnchanged(new Map([['services/b.js', 'x']]))).toThrow(/services\/b\.js/);
  });

  test('runPlan exécute les étapes en processus et préfixe leur erreur', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const ok = jest.fn();
    expect(() => preflight.runPlan([{ label: 'A', fn: ok, argv: [] }])).not.toThrow();
    expect(ok).toHaveBeenCalled();
    expect(() => preflight.runPlan([{ label: 'B', fn: () => { throw new Error('boom'); }, argv: [] }]))
      .toThrow('B : boom');
    const skipped = jest.fn();
    preflight.runPlan([{ label: 'C', fn: skipped, argv: [] }], true);
    expect(skipped).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
