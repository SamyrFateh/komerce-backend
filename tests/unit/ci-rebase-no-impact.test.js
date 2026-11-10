'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const {
  qualifiesNoImpact,
  previousRunGreen,
  appendOutput,
} = require('../../scripts/ci-rebase-no-impact');

const ROOT = path.resolve(__dirname, '../..');

function base(overrides = {}) {
  return {
    previousGreen:true,
    ancestor:true,
    previousPrFiles:['routes/a.js'],
    currentPrFiles:['routes/a.js'],
    baseDeltaFiles:['services/unrelated.js'],
    previousPatchDigest:'same',
    currentPatchDigest:'same',
    impactPaths:['db.js', 'services/a.js'],
    ...overrides,
  };
}

describe('CI rebase no-impact proof', () => {
  test('erreur de preuve volumineuse : GITHUB_OUTPUT reste sur une ligne et échoue fermé', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ci-rebase-'));
    try {
      const output = path.join(dir, 'github_output');
      const newline = String.fromCharCode(10);
      appendOutput(output, { qualifies:false, reason:'proof-error:diff --git a/file b/file' + newline + 'index X' + newline + 'A'.repeat(2000) });
      const lines = fs.readFileSync(output, 'utf8').trim().split(newline);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('rebase_no_impact=false');
      expect(lines[1]).toMatch(/^rebase_no_impact_reason=proof-error:/);
      expect(lines[1].length).toBeLessThan(300);
    } finally { fs.rmSync(dir, { recursive:true, force:true }); }
  });

  test('réutilise le vert uniquement pour un base-sync réellement sans impact', () => {
    expect(qualifiesNoImpact(base())).toEqual({
      qualifies:true,
      reason:'green-base-sync-patch-and-impact-unchanged',
    });
  });

  test.each([
    ['ancien verdict non vert', { previousGreen:false }, 'previous-required-verdict-not-green'],
    ['ensemble de fichiers PR modifié', { currentPrFiles:['routes/b.js'] }, 'pr-file-set-changed'],
    ['patch PR modifié', { currentPatchDigest:'different' }, 'pr-patch-changed'],
    ['main touche directement la PR', { baseDeltaFiles:['routes/a.js'] }, 'base-touched-pr-file:routes/a.js'],
    ['main touche une dépendance arch', { baseDeltaFiles:['services/a.js'] }, 'base-touched-arch-impact:services/a.js'],
    ['main touche un fichier global', { baseDeltaFiles:['package-lock.json'] }, 'base-global-risk:package-lock.json'],
  ])('%s => CI complète', (_label, override, reason) => {
    expect(qualifiesNoImpact(base(override))).toEqual({ qualifies:false, reason });
  });

  test('accepte un rebase si patch, fichiers et impact de base sont inchangés', () => {
    expect(qualifiesNoImpact(base({ ancestor:false }))).toEqual({
      qualifies:true,
      reason:'green-base-sync-patch-and-impact-unchanged',
    });
  });

  test('un rebase reste fail-closed si le patch PR change', () => {
    expect(qualifiesNoImpact(base({
      ancestor:false,
      currentPatchDigest:'different',
    }))).toEqual({
      qualifies:false,
      reason:'pr-patch-changed',
    });
  });

  test('le workflow précédent doit avoir scope + Required verdict verts', () => {
    expect(previousRunGreen([
      { name:'Detect PR scope', conclusion:'success' },
      { name:'Required verdict', conclusion:'success' },
    ])).toBe(true);
    expect(previousRunGreen([
      { name:'Detect PR scope', conclusion:'success' },
      { name:'Required verdict', conclusion:'failure' },
    ])).toBe(false);
  });

  test('les workflows verrouillent auto-update interne et fast-path no-impact', () => {
    const auto = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-auto-update.yml'), 'utf8');
    const enforcement = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-enforcement.yml'), 'utf8');
    const sweep = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-sweep-behind.yml'), 'utf8');
    // La mise à jour eager pull_request_target est désactivée depuis #2882.
    // Les synchronisations BEHIND passent exclusivement par le sweep sérialisé.
    expect(auto).not.toMatch(/^\\s{2}pull_request_target:/m);
    expect(auto).not.toContain('/update-branch');
    expect(auto).not.toMatch(/^\\s{2}push:/m);
    expect(sweep).toContain('scripts/ci-pr-sweep.js');
    expect(sweep).toContain('PR_SYNC_TOKEN');
    expect(sweep).not.toContain('|| github.token');
    expect(enforcement).toContain('rebase_no_impact: ${{ steps.rebase_proof.outputs.rebase_no_impact }}');
    expect(enforcement).toContain("needs.changes.outputs.rebase_no_impact != 'true'");
    expect(enforcement).toContain('git fetch --no-tags --depth=128 origin "$PREVIOUS_HEAD" "$BASE_SHA" "$HEAD_SHA"');
  });
});
