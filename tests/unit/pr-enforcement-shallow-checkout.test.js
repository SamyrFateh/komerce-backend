'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '..', '.github', 'workflows', 'pr-enforcement.yml'),
  'utf8'
);

describe('PR enforcement — shallow checkout ratchet', () => {
  test('aucun checkout ne réclame tout l’historique Git', () => {
    expect(workflow).not.toContain('fetch-depth: 0');
  });

  test('les gates hors migration qui comparent base/head fetchent uniquement le commit de base', () => {
    const targetedFetches = workflow.match(/git fetch --no-tags --depth=1 origin "\$BASE_SHA"/g) || [];
    expect(targetedFetches).toHaveLength(2);
  });

  test('les trois checkouts concernés restent explicitement shallow', () => {
    const shallow = workflow.match(/fetch-depth: 1/g) || [];
    expect(shallow).toHaveLength(3);
  });

  test('migration/schema fait un seul fetch blobless head+base pour restaurer la baseline', () => {
    expect(workflow).toContain('name: Fetch PR history for migration/schema gates');
    expect(workflow).toContain('git fetch --no-tags --filter=blob:none --unshallow origin');
    expect(workflow).toContain('refs/heads/${HEAD_REF}:refs/remotes/origin/${HEAD_REF}');
    expect(workflow).toContain('refs/heads/${BASE_REF}:refs/remotes/origin/${BASE_REF}');
    expect(workflow).toContain('HEAD_REF: ${{ github.event.pull_request.head.ref }}');
    expect(workflow).toContain('BASE_REF: ${{ github.event.pull_request.base.ref }}');
    expect(workflow).not.toContain('name: Fetch base branch history for schema baseline');
  });

  test('FAST-4 ne déplace aucun gate Boutique existant', () => {
    expect(workflow).toContain('run: node public/boutique/scripts/check-body-classes.js');
    expect(workflow).toContain('run: node scripts/arch-doctrine-sanitize-check.js --diff="$BASE_SHA"');
  });
});