'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const audit = require('../../scripts/cm-cg-market-delegation-audit');

const ROOT = path.join(__dirname, '..', '..');

describe('CG/CM market delegation audit', () => {
  test('scope is hard-coded to CG/CM and query is read-only', async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };

    await expect(audit.auditState(db)).resolves.toEqual({
      target_codes: ['CG', 'CM'],
      rows: [],
    });

    expect(audit.TARGET_CODES).toEqual(['CG', 'CM']);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/^\s*SELECT\b/);
    expect(calls[0].sql).toMatch(/market_operating_assignments/);
    expect(calls[0].sql).toMatch(/assignment_memberships/);
    expect(calls[0].sql).toMatch(/is_operating_lead/);
    expect(calls[0].params).toEqual([['CG', 'CM']]);
  });

  test('script declares no business mutation', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-delegation-audit.js'),
      'utf8'
    );
    const sql = source.match(/\`SELECT[\s\S]*?\`/)[0];
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
  });
});
