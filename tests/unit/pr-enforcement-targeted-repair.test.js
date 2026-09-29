'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '..', '.github', 'workflows', 'pr-enforcement.yml'),
  'utf8'
);

describe('PR enforcement — targeted repair rerun', () => {
  test('reads previous run evidence but stays read-only', () => {
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('name: Detect safe targeted unit-test repair');
    expect(workflow).toContain('actions/workflows/pr-enforcement.yml/runs');
    expect(workflow).toContain('r.head_sha !== head');
    expect(workflow).toContain('PREVIOUS_HEAD="${PREVIOUS_META#* }"');
    expect(workflow).toContain('actions/jobs/$BACKEND_JOB_ID/logs');
  });

  test('a safe repair runs only the exact failing unit tests inside Backend gates', () => {
    expect(workflow).toContain('name: Target only the repaired failing unit tests');
    expect(workflow).toContain('UNIT_REPAIR_FILES: ${{ needs.changes.outputs.unit_repair_files }}');
    expect(workflow).toContain('npx jest $TEST_FILES --runInBand --silent');
    expect(workflow).toContain("if: (needs.changes.outputs.backend == 'true') && needs.changes.outputs.unit_repair_only != 'true'");
  });

  test('previously green heavy jobs stay skipped on a proven repair push', () => {
    expect(workflow).toContain("if: needs.changes.outputs.unit_repair_only != 'true' && needs.changes.outputs.dashboard == 'true'");
    expect(workflow).toContain("if: needs.changes.outputs.unit_repair_only != 'true' && needs.changes.outputs.governance == 'true'");
    expect(workflow).toContain("if: needs.changes.outputs.unit_repair_only != 'true' && (needs.changes.outputs.backend == 'true'");
  });

  test('the classifier remains fail-closed and falls back to full CI', () => {
    expect(workflow).toContain('unit_repair_only=false');
    expect(workflow).toContain('Previous workflow metadata unavailable; full CI retained.');
    expect(workflow).toContain('Previous backend log unavailable; full CI retained.');
  });
});
