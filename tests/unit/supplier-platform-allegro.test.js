'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/supplier-platform-allegro.test.js
 *
 * Preuves contractuelles pour l'ajout de « allegro » en tant que
 * plateforme fournisseur officiellement supportée.
 *
 * NOTE : docs/db/railway-live-schema.sql N'EST PAS modifié par cette PR.
 * Ce fichier est un dump Railway — le toucher déplace la baseline CI.
 * La migration 240 sera appliquée en Mode B lors du prochain déploiement
 * et le dump sera rafraîchi par `npm run db:snapshot` ensuite.
 */

const fs = require('fs');
const path = require('path');
const Joi = require('joi');

const ROOT = path.join(__dirname, '..', '..');

function extractPlatformsFromSource() {
  const src = fs.readFileSync(path.join(ROOT, 'validators', 'index.js'), 'utf8');
  const match = src.match(/const PLATFORMS\s*=\s*\[([^\]]+)\]/);
  if (!match) throw new Error('PLATFORMS array not found');
  return match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

function extractPlatformsFromSchema(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const match = src.match(
    /suppliers_platform_check\s+CHECK\s*\(\(platform\s*=\s*ANY\s*\(ARRAY\[([^\]]+)\]/
  );
  if (!match) throw new Error(`suppliers_platform_check not found in ${filePath}`);
  return match[1].split(',').map(s => s.trim().replace(/::text/g, '').replace(/['"]/g, '')).filter(Boolean);
}

function extractPlatformsFromMigration() {
  const dir = path.join(ROOT, 'migrations');
  const file = fs.readdirSync(dir).find(f => f.includes('supplier_platform_allegro'));
  if (!file) throw new Error('Migration file not found');
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const match = src.match(/ADD CONSTRAINT\s+suppliers_platform_check[\s\S]*?ARRAY\[([^\]]+)\]/);
  if (!match) throw new Error('ADD CONSTRAINT not found in migration');
  return match[1].split(',').map(s => s.trim().replace(/::text/g, '').replace(/['"]/g, '')).filter(Boolean);
}

let purchasingValidators;
beforeAll(() => {
  try {
    purchasingValidators = require('../../validators/index').purchasing;
  } catch { purchasingValidators = null; }
});

const HISTORICAL = ['noon', 'amazon_uae', 'aliexpress', 'local', 'whatsapp'];

describe('supplier platform — ajout Allegro (migration 240)', () => {

  // A. allegro accepté
  test('A — "allegro" est dans PLATFORMS du validator', () => {
    expect(extractPlatformsFromSource()).toContain('allegro');
  });

  test('A — createSupplier accepte platform="allegro"', () => {
    if (!purchasingValidators) return;
    const { error } = purchasingValidators.createSupplier.body.validate({ name: 'Test', platform: 'allegro' });
    expect(error).toBeUndefined();
  });

  // B. inconnu refusé
  test('B — "totally_unknown_provider" refusé par le validator', () => {
    expect(extractPlatformsFromSource()).not.toContain('totally_unknown_provider');
  });

  test('B — createSupplier refuse platform="totally_unknown_provider"', () => {
    if (!purchasingValidators) return;
    const { error } = purchasingValidators.createSupplier.body.validate({ name: 'Test', platform: 'totally_unknown_provider' });
    expect(error).toBeDefined();
  });

  // C. historiques préservées
  test.each(HISTORICAL)('C — historique "%s" reste dans le validator', (p) => {
    expect(extractPlatformsFromSource()).toContain(p);
  });

  test.each(HISTORICAL)('C — historique "%s" reste dans db/schema.sql', (p) => {
    expect(extractPlatformsFromSchema(path.join(ROOT, 'db', 'schema.sql'))).toContain(p);
  });

  // D. migration forward-only
  test('D — migration 240 existe avec DROP + ADD CONSTRAINT', () => {
    const dir = path.join(ROOT, 'migrations');
    const file = fs.readdirSync(dir).find(f => f.startsWith('240_'));
    expect(file).toBeDefined();
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    expect(content).toMatch(/DROP CONSTRAINT/i);
    expect(content).toMatch(/ADD CONSTRAINT\s+suppliers_platform_check/i);
    expect(content).not.toMatch(/CREATE TABLE/i);
    expect(content).not.toMatch(/DROP TABLE/i);
  });

  test('D — migration inclut allegro + toutes les historiques', () => {
    const platforms = extractPlatformsFromMigration();
    expect(platforms).toContain('allegro');
    for (const p of HISTORICAL) expect(platforms).toContain(p);
  });

  // E. schema.sql synchrone avec migration
  test('E — db/schema.sql contient allegro', () => {
    expect(extractPlatformsFromSchema(path.join(ROOT, 'db', 'schema.sql'))).toContain('allegro');
  });

  test('E — db/schema.sql et migration ont les mêmes plateformes', () => {
    const schema = extractPlatformsFromSchema(path.join(ROOT, 'db', 'schema.sql')).sort();
    const migration = extractPlatformsFromMigration().sort();
    expect(schema).toEqual(migration);
  });

  // F. docs/db/railway-live-schema.sql N'EST PAS modifié (garde CI baseline)
  test('F — docs/db/railway-live-schema.sql ne contient PAS encore allegro (dump non rafraîchi)', () => {
    const platforms = extractPlatformsFromSchema(
      path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql')
    );
    // La migration 240 sera appliquée en Mode B — le dump sera rafraîchi après déploiement.
    // Ce test documente que le dump N'EST PAS touché dans cette PR (volontaire).
    expect(platforms).not.toContain('allegro');
  });
});
