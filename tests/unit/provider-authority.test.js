'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/provider-authority.test.js
 *
 * GAP-1 — Provider Authority. Fige la liste canonique des providers et
 * la doctrine « provider identity ≠ execution mode » : `manual` n'est
 * jamais un provider.
 */

const fs = require('fs');
const path = require('path');

const {
  PROVIDERS,
  isSupportedProvider,
  normalizeProviderCode,
} = require('../../services/suppliers/provider-authority');

const ROOT = path.join(__dirname, '..', '..');

function extractPlatformsFromDbSchema() {
  const src = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  const match = src.match(
    /suppliers_platform_check\s+CHECK\s*\(\(platform\s*=\s*ANY\s*\(ARRAY\[([^\]]+)\]/
  );
  if (!match) throw new Error('suppliers_platform_check not found');
  return match[1].split(',').map(s => s.trim().replace(/::text/g, '').replace(/['"]/g, '')).filter(Boolean);
}

describe('provider-authority — liste canonique', () => {
  test('PROVIDERS est gelé (Object.frozen)', () => {
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
  });

  test('PROVIDERS correspond exactement à la contrainte DB suppliers_platform_check', () => {
    const dbPlatforms = extractPlatformsFromDbSchema().slice().sort();
    const authorityPlatforms = [...PROVIDERS].sort();
    expect(authorityPlatforms).toEqual(dbPlatforms);
  });

  test('PROVIDERS contient tous les providers réels connus', () => {
    for (const p of ['noon', 'amazon_uae', 'aliexpress', 'local', 'whatsapp', 'allegro']) {
      expect(PROVIDERS).toContain(p);
    }
  });
});

describe('provider-authority — isSupportedProvider', () => {
  test('accepte allegro', () => {
    expect(isSupportedProvider('allegro')).toBe(true);
  });

  test('accepte tous les providers canoniques', () => {
    for (const p of PROVIDERS) {
      expect(isSupportedProvider(p)).toBe(true);
    }
  });

  test('rejette un provider inconnu', () => {
    expect(isSupportedProvider('totally_unknown_provider')).toBe(false);
  });

  test('rejette une chaîne vide, null, undefined', () => {
    expect(isSupportedProvider('')).toBe(false);
    expect(isSupportedProvider(null)).toBe(false);
    expect(isSupportedProvider(undefined)).toBe(false);
  });

  test('est insensible à la casse et aux espaces', () => {
    expect(isSupportedProvider('  ALLEGRO  ')).toBe(true);
    expect(isSupportedProvider('Allegro')).toBe(true);
  });

  // ── Doctrine : provider identity ≠ execution mode ────────────────────────
  test('DOCTRINE — "manual" n\'est PAS un provider', () => {
    expect(isSupportedProvider('manual')).toBe(false);
    expect(PROVIDERS).not.toContain('manual');
  });

  test('DOCTRINE — "auto" / "automatic" ne sont pas des providers', () => {
    expect(isSupportedProvider('auto')).toBe(false);
    expect(isSupportedProvider('automatic')).toBe(false);
  });
});

describe('provider-authority — normalizeProviderCode', () => {
  test('trim + lowercase', () => {
    expect(normalizeProviderCode('  Allegro  ')).toBe('allegro');
  });

  test('idempotent', () => {
    const once = normalizeProviderCode('AlLeGrO');
    expect(normalizeProviderCode(once)).toBe(once);
  });

  test('valeurs non-string → chaîne vide normalisée', () => {
    expect(normalizeProviderCode(null)).toBe('');
    expect(normalizeProviderCode(undefined)).toBe('');
  });
});

describe('provider-authority — consommation par purchasing-validators.js', () => {
  // GAP-1 (v2) : validators/index.js NE doit PAS importer provider-authority.js.
  // Un barrel @domain infrastructure qui importe un fichier @domain purchasing
  // est l'edge OBSERVED-UNDECLARED-FEATURE-DEPENDENCY que ce repo verrouille à
  // zéro (cf. governance/business-graph-drift-baseline.json, "Debt Zero
  // absolute"). La validation purchasing vit donc dans son propre fichier
  // @domain purchasing (services/suppliers/purchasing-validators.js), qui
  // peut importer provider-authority.js sans franchir de frontière.
  test('validators/index.js N\'importe PAS provider-authority (frontière infrastructure préservée)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'validators', 'index.js'), 'utf8');
    expect(src).not.toMatch(/require\(.*provider-authority.*\)/);
    expect(src).not.toMatch(/const PLATFORMS\s*=\s*\[\s*'/);
  });

  test('purchasing-validators.js importe provider-authority (dépendance intra-feature)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'services', 'suppliers', 'purchasing-validators.js'), 'utf8'
    );
    expect(src).toMatch(/require\(.*provider-authority.*\)/);
  });

  test('createSupplier valide "allegro" et rejette "manual"', () => {
    const { purchasing } = require('../../services/suppliers/purchasing-validators');
    const okResult = purchasing.createSupplier.body.validate({ name: 'Test', platform: 'allegro' });
    expect(okResult.error).toBeUndefined();

    const badResult = purchasing.createSupplier.body.validate({ name: 'Test', platform: 'manual' });
    expect(badResult.error).toBeDefined();
  });
});

describe('provider-authority — aucune fixture de test ne mime "manual" comme provider', () => {
  test('aucun fichier de test ne déclare platform: "manual" (hors trigger_mode)', () => {
    const testsDir = path.join(ROOT, 'tests', 'unit');
    const offenders = [];
    for (const file of fs.readdirSync(testsDir)) {
      if (!file.endsWith('.test.js')) continue;
      if (file === 'provider-authority.test.js') continue; // le scanner lui-même contient la chaîne cible dans ses assertions
      const src = fs.readFileSync(path.join(testsDir, file), 'utf8');
      const matches = src.match(/platform\s*[:=]\s*['"]manual['"]/g);
      if (matches) offenders.push(`${file}: ${matches.length} occurrence(s)`);
    }
    expect(offenders).toEqual([]);
  });
});
