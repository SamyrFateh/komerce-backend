'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const {
  qualifiesNoImpact,
  previousRunGreen,
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
    expect(auto).toContain('pull_request_target:');
    expect(auto).not.toMatch(/^\s{2}push:/m);
    expect(auto).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(auto).toContain('/update-branch');
    expect(auto).toContain('COMPARE_URL=');
    expect(auto).toContain('compare/$BASE_SHA...$HEAD_SHA');
    expect(auto).toContain('BEHIND_BY=');
    expect(auto).not.toContain('/pulls?state=open&base=main&per_page=100');
    expect(auto).not.toContain('Auto-update open PRs after main advances');
    expect(auto).toContain('expected_head_sha');
    expect(auto).toContain('PR_SYNC_TOKEN');
    expect(auto).not.toContain('GH_TOKEN: ${{ github.token }}');
    expect(auto).not.toContain('|| github.token');
    expect(enforcement).toContain('rebase_no_impact: ${{ steps.rebase_proof.outputs.rebase_no_impact }}');
    expect(enforcement).toContain("needs.changes.outputs.rebase_no_impact != 'true'");
    expect(enforcement).toContain('git fetch --no-tags --depth=128 origin "$PREVIOUS_HEAD" "$BASE_SHA" "$HEAD_SHA"');
  });
});
