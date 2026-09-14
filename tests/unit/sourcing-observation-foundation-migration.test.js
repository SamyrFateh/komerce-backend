'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '../../migrations/226_sourcing_observation_foundation.sql'
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('migration 226 — sourcing observation foundation', () => {
  test('creates the six foundation tables and observation grain', () => {
    const text = sql();
    for (const table of [
      'sourcing_sources',
      'sourcing_source_provides',
      'sourcing_source_execution_modes',
      'sourcing_captures',
      'sourcing_observations',
      'sourcing_observation_evidence',
    ]) {
      expect(text).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\b`, 'i'));
    }
    expect(text).toMatch(/CREATE TYPE public\.sourcing_observation_grain AS ENUM \('product', 'offer', 'unit'\)/i);
  });

  test('keeps source capabilities relational and guards api execution with units', () => {
    const text = sql();
    expect(text).toMatch(/CHECK \(acquisition IN \('pull', 'push'\)\)/i);
    expect(text).toMatch(/CHECK \(continuity IN \('recurring', 'one_shot'\)\)/i);
    expect(text).toMatch(/CHECK \(layer IN \('catalog', 'offers', 'units'\)\)/i);
    expect(text).toMatch(/CHECK \(mode IN \('human', 'api'\)\)/i);
    expect(text).toContain('sourcing_source_exec_api_requires_units');
    expect(text).toContain('sourcing_source_provides_units_guard');
    expect(text).toContain("sp.layer = 'units'");
  });

  test('derives observation source only through capture', () => {
    const text = sql();
    const block = text.match(/CREATE TABLE public\.sourcing_observations \([\s\S]*?\n\);/i)?.[0] || '';
    expect(block).toMatch(/capture_id\s+uuid NOT NULL[\s\S]*REFERENCES public\.sourcing_captures\(capture_id\)/i);
    expect(block).not.toMatch(/\bsource_id\b/i);
  });

  test('enforces same-capture parent observations', () => {
    const text = sql();
    expect(text).toMatch(/UNIQUE \(observation_id, capture_id\)/i);
    expect(text).toMatch(/FOREIGN KEY \(parent_observation_id, capture_id\)[\s\S]*REFERENCES public\.sourcing_observations \(observation_id, capture_id\)/i);
  });

  test('namespaces and deduplicates evidence per extractor version', () => {
    const text = sql();
    expect(text).toMatch(/evidence_type\s+text\s+NOT NULL/i);
    expect(text).toMatch(/evidence_key\s+text\s+NOT NULL/i);
    expect(text).toMatch(/extractor_version\s+text\s+NOT NULL/i);
    expect(text).toMatch(/UNIQUE \(\s*observation_id,\s*evidence_type,\s*evidence_key,\s*value,\s*extractor_version\s*\)/i);
    expect(text).toMatch(/ON public\.sourcing_observation_evidence \(evidence_type, evidence_key, value\)/i);
  });

  test('protects observations with the dedicated append-only trigger', () => {
    const text = sql();
    expect(text).toContain('sourcing_forbid_observation_mutation');
    expect(text).toContain('sourcing_observations_append_only');
    expect(text).toContain('sourcing_observation_evidence');
  });
});
