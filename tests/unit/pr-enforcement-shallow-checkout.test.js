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

  test('les gates qui comparent base/head fetchent uniquement le commit de base', () => {
    const targetedFetches = workflow.match(/git fetch --no-tags --depth=1 origin "\$BASE_SHA"/g) || [];
    expect(targetedFetches).toHaveLength(3);
  });

  test('les trois checkouts concernés restent explicitement shallow', () => {
    const shallow = workflow.match(/fetch-depth: 1/g) || [];
    expect(shallow).toHaveLength(3);
  });

  test('schema-freshness récupère seulement l’historique de la branche de base, sans blobs', () => {
    expect(workflow).toContain('name: Fetch base branch history for schema baseline');
    expect(workflow).toContain('git fetch --no-tags --filter=blob:none --unshallow origin "$BASE_REF"');
    expect(workflow).toContain('BASE_REF: ${{ github.event.pull_request.base.ref }}');
  });

  test('FAST-4 ne déplace aucun gate Boutique existant', () => {
    expect(workflow).toContain('run: node public/boutique/scripts/check-body-classes.js');
    expect(workflow).toContain('run: node scripts/arch-doctrine-sanitize-check.js --diff="$BASE_SHA"');
  });
});