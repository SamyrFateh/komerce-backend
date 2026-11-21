'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(ROOT, 'scripts/recette/dashboard-final-intersession-readonly.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/dashboard-final-intersession-readonly.yml'), 'utf8');

describe('Dashboard final readonly certificate runner policy', () => {
  it('parses as executable JavaScript without running it in CI unit gates', () => {
    expect(() => new vm.Script(script)).not.toThrow();
  });
  it('cannot write business tables and proves both transactional notification outcomes', () => {
    expect(workflow).toContain("default_transaction_read_only=on");
    expect(script).toContain("BEGIN READ ONLY");
    expect(script).toContain("SELECT pg_notify($1,$2)");
    expect(script).toContain("ROLLBACK");
    expect(script).toContain("COMMIT");
    expect(script).toContain("ROLLBACK_LEAK_ADMIN");
    expect(script).toContain("ADMIN_CANONICAL_REFETCH_MISSING");
    expect(script).toContain("HUB_CANONICAL_REFETCH_MISSING");
    expect(script).toContain("DASHBOARD_HTTP_429");
    expect(script).not.toMatch(/(?:client|pg)\.query\(\s*['"`]\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  });
  it('uses owner-only issue, original target pin and the G6 staging serialization lock', () => {
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain("komerce-g6-canonical-real-transaction");
    expect(workflow).toContain("staging-chromium-deployment-preflight.js");
    expect(workflow).toContain("secrets.RAILWAY_DATABASE_URL");
    expect(workflow).toContain("vars.STAGING_DB_PIN");
  });
});
