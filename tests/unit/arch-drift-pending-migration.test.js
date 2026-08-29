'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../../scripts/lib/arch-drift-core');

describe('arch drift pending migration classification', () => {
  test('migration-backed missing table is pending, unrelated missing table remains blocking', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-arch-drift-'));
    fs.mkdirSync(path.join(root, 'docs', 'db'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });

    fs.writeFileSync(
      path.join(root, 'docs', 'db', 'railway-live-schema.sql'),
      'CREATE TABLE public.live_table (id uuid);\n'
    );
    fs.writeFileSync(
      path.join(root, 'docs', 'SCHEMA.md'),
      '| Table | Rôle |\n|---|---|\n| `live_table` | live |\n'
    );
    fs.writeFileSync(
      path.join(root, 'docs', 'komerce-arch-header-graph.json'),
      JSON.stringify({
        nodes: [
          {
            type: 'file',
            file: 'services/a.js',
            dbRead: ['pending_table', 'missing_table'],
            dbWrite: [],
          },
        ],
      })
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'arch-debt-budget.json'),
      JSON.stringify({ knownDriftAllowlist: {}, ratchet: { liveTablesUndocumented: 0 } })
    );
    fs.writeFileSync(
      path.join(root, 'migrations', '200_pending.sql'),
      'CREATE TABLE pending_table (id uuid);\n'
    );

    const result = core.analyze(root);
    expect(result.fictionPendingMigration.map(f => f.token)).toEqual(['pending_table']);
    expect(result.fictionUnlisted.map(f => f.token)).toEqual(['missing_table']);
  });
});
