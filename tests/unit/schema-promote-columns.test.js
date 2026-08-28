'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  parseLiveColumnsByTable,
  extractMigrationColumnsForTable,
  planIntendedColumnPromotions,
  applyIntendedColumnPromotions,
} = require('../../scripts/schema-promote-columns');

const MARKER = '**Migration 104 (2026-07-12, `intended_migration_schema` — non vérifié live)**';
const ROW = `| \`products\` | Catalogue. ${MARKER} : + \`inventory_model\`. |`;

function liveSchema(productsColumns = [], otherColumns = []) {
  const render = (table, columns) => `CREATE TABLE public.${table} (\n${columns.map(c => `    ${c} text`).join(',\n')}\n);`;
  return [render('products', productsColumns), render('other_table', otherColumns)].join('\n\n');
}

describe('schema-promote-columns table-scoped proof', () => {
  test('keeps live columns scoped to their exact table', () => {
    const parsed = parseLiveColumnsByTable(
      liveSchema(['inventory_model', 'name_source'], ['sku_id'])
    );

    expect([...parsed.get('products')]).toEqual(['inventory_model', 'name_source']);
    expect(parsed.get('products').has('sku_id')).toBe(false);
    expect(parsed.get('other_table').has('sku_id')).toBe(true);
  });

  test('extracts ADD COLUMN and semantic COMMENT ON COLUMN for one table only', () => {
    const migration = `
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS inventory_model text;
COMMENT ON COLUMN public.products.fragility IS 'source unique';
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sku_id uuid;
`;

    expect([...extractMigrationColumnsForTable(migration, 'products')].sort())
      .toEqual(['fragility', 'inventory_model']);
    expect([...extractMigrationColumnsForTable(migration, 'order_items')])
      .toEqual(['sku_id']);
  });

  test('never accepts a same-named column that exists under another table', () => {
    const resolveMigration = () => [{
      name: '104_product_skus.sql',
      sql: 'ALTER TABLE public.products ADD COLUMN IF NOT EXISTS inventory_model text;',
    }];

    const plan = planIntendedColumnPromotions(
      ROW,
      liveSchema([], ['inventory_model']),
      resolveMigration
    );

    expect(plan.promotable).toHaveLength(0);
    expect(plan.waiting).toHaveLength(1);
    expect(plan.waiting[0].missing).toEqual(['inventory_model']);
  });

  test('promotes only when every migration column for the target table is live', () => {
    const resolveMigration = () => [{
      name: '104_product_skus.sql',
      sql: `
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS inventory_model text;
COMMENT ON COLUMN public.products.inventory_model IS 'mode';
`,
    }];

    const plan = planIntendedColumnPromotions(
      ROW,
      liveSchema(['inventory_model']),
      resolveMigration
    );

    expect(plan.invalid).toHaveLength(0);
    expect(plan.waiting).toHaveLength(0);
    expect(plan.promotable).toHaveLength(1);
    expect(plan.promotable[0]).toMatchObject({
      table: 'products',
      migration: '104',
      columns: ['inventory_model'],
    });

    const promoted = applyIntendedColumnPromotions(ROW, plan.promotable);
    expect(promoted).toContain('`verified_live_schema` — vérifié live Railway');
    expect(promoted).not.toContain('`intended_migration_schema` — non vérifié live');
  });

  test('refuses an ambiguous migration number instead of guessing', () => {
    const resolveMigration = () => [
      { name: '147_a.sql', sql: 'ALTER TABLE products ADD COLUMN a text;' },
      { name: '147_b.sql', sql: 'ALTER TABLE products ADD COLUMN b text;' },
    ];
    const ambiguousRow = ROW.replace(/104/g, '147');

    const plan = planIntendedColumnPromotions(
      ambiguousRow,
      liveSchema(['a', 'b']),
      resolveMigration
    );

    expect(plan.promotable).toHaveLength(0);
    expect(plan.invalid).toHaveLength(1);
    expect(plan.invalid[0].reason).toContain('numero ambigu');
  });
});
