#!/usr/bin/env node
'use strict';

/**
 * Générateur canonique de la matrice E2E Feature First.
 *
 *   docs/testing/FEATURE_E2E_MATRIX.md    — lecture humaine
 *   docs/testing/FEATURE_E2E_MATRIX.json  — consommable par un gate
 *
 * Rien n'est saisi à la main : tout est dérivé des sources réelles
 * (features/*.feature.js, capabilities/*.capability.js, arborescence tests/**,
 * public/boutique/tests/e2e/**). Éditer les fichiers produits est une erreur —
 * relancer ce script.
 *
 * Usage :
 *   node scripts/gen-feature-e2e-matrix.js          # écrit
 *   node scripts/gen-feature-e2e-matrix.js --check  # échoue si périmé
 *
 * ── Taxonomie des preuves (§1 du chantier) ────────────────────────────────
 *   unit         tests/unit/**              mocks internes — ne prouve aucun parcours
 *   integration  tests/integration/**       couches réelles, base réelle en CI
 *   contract     tests/contract/**          conformité de contrat API
 *   invariant    tests/invariants/**        invariant exécutable référencé par un manifest
 *   e2e-api      tests/e2e-api/**           E2E fonctionnel : entrée publique -> effet métier
 *   e2e-browser  public/boutique/tests/e2e  Playwright — harnais DISTANT (BASE_URL requis)
 *
 * ── Statuts ───────────────────────────────────────────────────────────────
 *   PROVEN         au moins un E2E fonctionnel possédé, OU un invariant
 *                  exécutable ET une preuve d'intégration/contrat.
 *   PARTIAL        des tests existent, mais aucun ne traverse les couches
 *                  réelles (unitaire seul).
 *   MISSING        aucune preuve exécutable rattachée.
 *   NOT_APPLICABLE feature dépréciée — aucun comportement à prouver.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'testing');
const OUT_MD = path.join(OUT_DIR, 'FEATURE_E2E_MATRIX.md');
const OUT_JSON = path.join(OUT_DIR, 'FEATURE_E2E_MATRIX.json');

const LOTS = {
  1: ['auth', 'auth-identity', 'auth-passkey', 'catalog', 'shared-cart', 'orders', 'payments'],
  2: ['purchasing', 'logistics', 'inventory', 'customs', 'refunds', 'wallet',
      'loyalty', 'unsold-resolution'],
  3: ['business-rules', 'economic-engine', 'notifications', 'documents',
      'recommendations', 'incident-management', 'decision-signals', 'dashboard',
      'platform-ops', 'infrastructure', 'sourcing'],
};

const CATEGORIES = [
  ['unit', (t) => t.startsWith('tests/unit/')],
  ['integration', (t) => t.startsWith('tests/integration/')],
  ['contract', (t) => t.startsWith('tests/contract/')],
  ['invariant', (t) => t.startsWith('tests/invariants/')],
  ['notifications', (t) => t.startsWith('tests/notifications/')],
  ['e2e-api', (t) => t.startsWith('tests/e2e-api/')],
  ['boutique-unit', (t) => t.startsWith('public/boutique/tests/unit/')],
];

function categorise(testPath) {
  const hit = CATEGORIES.find(([, match]) => match(testPath.replace(/\\/g, '/')));
  return hit ? hit[0] : 'autre';
}

function loadManifests() {
  const out = [];
  for (const [dir, suffix, kind] of [
    ['features', '.feature.js', 'feature'],
    ['capabilities', '.capability.js', 'capability'],
  ]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of fs.readdirSync(abs).filter((f) => f.endsWith(suffix))) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const m = require(path.join(abs, file));
      out.push({ manifest: `${dir}/${file}`, kind, m });
    }
  }
  return out;
}

function lotOf(name) {
  for (const [lot, members] of Object.entries(LOTS)) {
    if (members.includes(name)) return Number(lot);
  }
  return null;
}

function analyse({ manifest, kind, m }) {
  const tests = (m.files && m.files.tests) || [];
  const invariants = (m.invariants || []).map((i) => (typeof i === 'string' ? { statement: i } : i));
  const executableInvariants = invariants.filter((i) => i.test);

  // Les tests d'invariant sont référencés par le champ `invariants[].test` et
  // ne figurent pas toujours dans files.tests : les compter comme preuves,
  // sinon payments (2 invariants exécutables) apparaîtrait à tort « unitaire
  // seul ».
  const allProofs = [...new Set([...tests, ...executableInvariants.map((i) => i.test)])];

  const byCategory = {};
  for (const t of allProofs) {
    const c = categorise(t);
    (byCategory[c] = byCategory[c] || []).push(t);
  }

  const missingFiles = allProofs.filter((t) => !fs.existsSync(path.join(ROOT, t)));

  const hasE2E = Boolean(byCategory['e2e-api']);
  const hasRealLayer = Boolean(
    byCategory.integration || byCategory.contract || byCategory.invariant
  );

  let status;
  if (m.status === 'deprecated') status = 'NOT_APPLICABLE';
  else if (hasE2E) status = 'PROVEN';
  else if (executableInvariants.length && hasRealLayer) status = 'PROVEN';
  else if (tests.length && hasRealLayer) status = 'PARTIAL';
  else if (tests.length) status = 'PARTIAL';
  else status = 'MISSING';

  const gaps = [];
  if (status === 'NOT_APPLICABLE') {
    gaps.push('Feature dépréciée — ne pas lui inventer de comportement (chantier §3).');
  } else {
    if (!hasE2E) gaps.push('Aucun E2E fonctionnel possédé.');
    if (!hasRealLayer) gaps.push('Aucune preuve traversant les couches réelles (unitaire seul).');
    const proseOnly = invariants.length - executableInvariants.length;
    if (proseOnly > 0) {
      gaps.push(`${proseOnly}/${invariants.length} invariant(s) non exécutable(s).`);
    }
    if (missingFiles.length) {
      gaps.push(`${missingFiles.length} test(s) déclaré(s) mais absent(s) du disque.`);
    }
  }

  return {
    name: m.name,
    manifest,
    kind,
    type: m.type || null,
    domain: m.domain || null,
    lifecycle: m.status || null,
    lot: lotOf(m.name),
    exposedRoutes: ((m.contract && m.contract.exposes) || []).length,
    invariants: {
      declared: invariants.length,
      executable: executableInvariants.length,
      tests: executableInvariants.map((i) => i.test),
    },
    tests: { declared: tests.length, proofs: allProofs.length, byCategory, missingFiles },
    status,
    gaps,
  };
}

function countBrowserSpecs() {
  const dir = path.join(ROOT, 'public', 'boutique', 'tests', 'e2e');
  if (!fs.existsSync(dir)) return { total: 0, authenticated: 0 };
  let total = 0;
  let authenticated = 0;
  const walk = (d, inAuth) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p, inAuth || entry.name === 'authenticated');
      else if (entry.name.endsWith('.spec.js')) { total++; if (inAuth) authenticated++; }
    }
  };
  walk(dir, false);
  return { total, authenticated };
}

function build() {
  const rows = loadManifests().map(analyse).sort((a, b) => {
    const la = a.lot || 99;
    const lb = b.lot || 99;
    return la - lb || a.name.localeCompare(b.name);
  });

  const tally = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return {
    version: 'FEM-1.0',
    generator: 'scripts/gen-feature-e2e-matrix.js',
    note: 'Fichier généré — ne pas éditer à la main, relancer le générateur.',
    harnesses: {
      'e2e-api': {
        runner: 'scripts/run-e2e-feature-tests.js',
        commands: {
          feature: 'npm run test:e2e:feature -- --feature=<nom>',
          lot: 'npm run test:e2e:lot -- --lot=<1|2|3>',
          all: 'npm run test:e2e:features',
        },
        requires: 'DATABASE_URL vers une base de test (garde fail-closed : tests/helpers/e2eDbKit.js)',
      },
      integration: { runner: 'scripts/run-integration-tests.js', command: 'npm run test:integration' },
      'e2e-browser': {
        location: 'public/boutique (paquet npm distinct)',
        command: 'npm run test:e2e:business (depuis public/boutique)',
        requires: 'BASE_URL vers un environnement de staging + compte de test',
        specs: countBrowserSpecs(),
      },
    },
    tally,
    features: rows,
  };
}

function renderMarkdown(data) {
  const L = [];
  L.push('# Matrice E2E Feature First');
  L.push('');
  L.push('> Fichier **généré** par `scripts/gen-feature-e2e-matrix.js`. Ne pas éditer à la main.');
  L.push('');
  L.push('## Bilan');
  L.push('');
  L.push('| Statut | Features |');
  L.push('|---|---|');
  for (const s of ['PROVEN', 'PARTIAL', 'MISSING', 'NOT_APPLICABLE']) {
    L.push(`| \`${s}\` | ${data.tally[s] || 0} |`);
  }
  L.push('');
  L.push('## Harnais exécutables');
  L.push('');
  L.push('| Harnais | Commande | Prérequis |');
  L.push('|---|---|---|');
  L.push(`| E2E API (Feature First) | \`${data.harnesses['e2e-api'].commands.all}\` | ${data.harnesses['e2e-api'].requires} |`);
  L.push(`| Intégration | \`${data.harnesses.integration.command}\` | \`DATABASE_URL\` (voir \`.github/workflows/ci.yml\`) |`);
  L.push(`| E2E navigateur | \`${data.harnesses['e2e-browser'].command}\` | ${data.harnesses['e2e-browser'].requires} |`);
  L.push('');
  L.push(`E2E navigateur : ${data.harnesses['e2e-browser'].specs.total} specs Playwright, dont ${data.harnesses['e2e-browser'].specs.authenticated} sous \`authenticated/\`.`);
  L.push('');

  for (const lot of [1, 2, 3, null]) {
    const rows = data.features.filter((r) => r.lot === lot);
    if (!rows.length) continue;
    L.push(`## ${lot ? `Lot ${lot}` : 'Hors lot'}`);
    L.push('');
    L.push('| Feature | Nature | Cycle | Routes | Invariants (exéc./décl.) | Preuves exécutables | Couverture | Gap |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const proofs = Object.entries(r.tests.byCategory)
        .map(([c, list]) => `${c}:${list.length}`)
        .sort()
        .join(' ') || '—';
      L.push([
        `\`${r.name}\``,
        `${r.kind}${r.type ? ` / ${r.type}` : ''}`,
        r.lifecycle || '—',
        r.exposedRoutes,
        `${r.invariants.executable}/${r.invariants.declared}`,
        proofs,
        `\`${r.status}\``,
        r.gaps.join(' '),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    L.push('');
  }

  L.push('## Lecture');
  L.push('');
  L.push('- `unit` ne prouve aucun parcours : mocks internes, aucune traversée de couche.');
  L.push('- `PROVEN` exige un E2E fonctionnel possédé, ou un invariant exécutable adossé à une preuve d\'intégration/contrat.');
  L.push('- Un fichier de test appartient à **exactement une** feature (`files.tests`). Les features traversées par un scénario vertical sont documentées dans l\'en-tête du scénario, jamais par une seconde déclaration d\'ownership.');
  L.push('');
  return L.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const data = build();
  const md = renderMarkdown(data);
  const json = `${JSON.stringify(data, null, 2)}\n`;

  if (check) {
    const stale = [];
    if (!fs.existsSync(OUT_MD) || fs.readFileSync(OUT_MD, 'utf8') !== md) stale.push(path.relative(ROOT, OUT_MD));
    if (!fs.existsSync(OUT_JSON) || fs.readFileSync(OUT_JSON, 'utf8') !== json) stale.push(path.relative(ROOT, OUT_JSON));
    if (stale.length) {
      console.error(`✖ Matrice E2E périmée : ${stale.join(', ')}`);
      console.error('  → node scripts/gen-feature-e2e-matrix.js');
      process.exitCode = 1;
      return;
    }
    console.log('✔ Matrice E2E à jour.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_MD, md);
  fs.writeFileSync(OUT_JSON, json);
  const t = data.tally;
  console.log(
    `✔ Matrice E2E générée — ${data.features.length} features · ` +
    `PROVEN ${t.PROVEN || 0} · PARTIAL ${t.PARTIAL || 0} · ` +
    `MISSING ${t.MISSING || 0} · N/A ${t.NOT_APPLICABLE || 0}`
  );
  console.log(`  ${path.relative(ROOT, OUT_MD)} + ${path.relative(ROOT, OUT_JSON)}`);
}

main();
