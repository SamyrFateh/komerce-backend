'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/398_hub_stage_notes_append_only.sql'), 'utf8');

describe('Hub stage journal — immutable storage contract', () => {
  test('reuses canonical order_comments without creating a parallel journal', () => {
    expect(migration).toMatch(/ALTER TABLE public\.order_comments/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS hub_stage_key/);
    expect(migration).not.toMatch(/CREATE TABLE/i);
  });
  test('immutable stage notes cannot be updated, and ordinary direct deletes are rejected', () => {
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON public\.order_comments/);
    expect(migration).toMatch(/OLD\.hub_stage_key IS NOT NULL/);
    expect(migration).toMatch(/TG_OP = 'UPDATE'/);
    expect(migration).toMatch(/HUB_STAGE_NOTE_IMMUTABLE/);
    expect(migration).toMatch(/EXISTS \(SELECT 1 FROM public\.orders WHERE id = OLD\.order_id\)/);
  });
  test('the scope keys match the six canonical Hub board stages', () => {
    for (const stage of ['po','supplier','reception','cartons','departure','remaining']) {
      expect(migration).toContain("'"+stage+"'");
    }
  });
});
