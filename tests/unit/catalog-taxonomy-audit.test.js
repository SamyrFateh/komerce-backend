'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { publicActor, recordTaxonomyMutation } = require('../../services/catalog-taxonomy-audit');

test('publicActor ne conserve que l’identité nécessaire à l’audit', () => {
  expect(publicActor({ id: 'actor-1', role: 'admin', email: 'secret@example.test' })).toEqual({
    user_id: 'actor-1',
    role: 'admin',
  });
  expect(publicActor(null)).toEqual({ user_id: null, role: null });
});

test('recordTaxonomyMutation écrit un fait append-only avec avant/après et acteur', async () => {
  const q = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'audit-id', created_at: '2026-10-05T00:00:00Z' }] }) };
  const before = { key: 'maison', label: 'Maison' };
  const after = { key: 'maison', label: 'Maison & Déco' };

  await recordTaxonomyMutation(q, {
    action: 'CATEGORY_UPDATED',
    entityType: 'category',
    categoryKey: 'maison',
    actor: { id: '11111111-1111-4111-8111-111111111111', role: 'admin' },
    sourceSurface: 'canonical_catalog_workspace',
    before,
    after,
  });

  expect(q.query).toHaveBeenCalledTimes(1);
  const [sql, params] = q.query.mock.calls[0];
  expect(String(sql)).toContain('INSERT INTO catalog_taxonomy_audit');
  expect(params).toEqual([
    'CATEGORY_UPDATED',
    'category',
    'maison',
    null,
    '11111111-1111-4111-8111-111111111111',
    'admin',
    'canonical_catalog_workspace',
    JSON.stringify(before),
    JSON.stringify(after),
  ]);
});

test('migration 282 crée un ledger append-only borné aux actions de taxonomie', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'migrations', '282_catalog_taxonomy_audit.sql'),
    'utf8'
  );
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.catalog_taxonomy_audit');
  expect(sql).toContain('actor_user_id');
  expect(sql).toContain('before_snapshot');
  expect(sql).toContain('after_snapshot');
  expect(sql).toContain("'SUBCATEGORY_DELETED'");
  expect(sql).not.toMatch(/UPDATE\s+public\.catalog_taxonomy_audit/i);
  expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.catalog_taxonomy_audit/i);
});
