'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({
  normalizeCandidate: jest.fn(),
  scanCandidate: jest.fn(),
}));

const {
  EXPECTED_CLEAN,
  FLAG,
  parseMode,
  assertRuntime,
  customsCategoryFromDiscovery,
  categoryHintLabel,
  preserveManualFields,
  assertFreightRepairable,
  summarizeRepairs,
} = require('../../scripts/aliexpress-refinery-repair-staging');

describe('aliexpress-refinery-repair-staging', () => {
  test('500 candidates remains the staging repair invariant', () => {
    expect(EXPECTED_CLEAN).toBe(500);
  });

  test('dry-run by default and execute is explicit staging-only opt-in', () => {
    expect(parseMode([])).toBe('dry-run');
    expect(parseMode(['--dry-run'])).toBe('dry-run');
    expect(parseMode(['--execute'])).toBe('execute');
    expect(() => parseMode(['--dry-run', '--execute'])).toThrow(/pas les deux/i);

    expect(() => assertRuntime('dry-run', {
      KOMERCE_ENV: 'staging', DATABASE_URL: 'postgres://example',
    })).not.toThrow();
    expect(() => assertRuntime('execute', {
      KOMERCE_ENV: 'staging', DATABASE_URL: 'postgres://example',
    })).toThrow(new RegExp(FLAG));
    expect(() => assertRuntime('execute', {
      KOMERCE_ENV: 'staging', DATABASE_URL: 'postgres://example', [FLAG]: '1',
    })).not.toThrow();
    expect(() => assertRuntime('dry-run', {
      KOMERCE_ENV: 'production', DATABASE_URL: 'postgres://example',
    })).toThrow(/staging requis/i);
  });

  test.each([
    [{ target_category: 'Mode & Beauté', target_subcategory: 'Femme', segment_id: 'mode-femme' }, 'vetements'],
    [{ target_category: 'Mode & Beauté', target_subcategory: 'Beauté', segment_id: 'beaute' }, 'cosmetiques'],
    [{ target_category: 'Maison', target_subcategory: 'Cuisine', segment_id: 'maison-cuisine' }, 'maison'],
    [{ target_category: 'Maison', target_subcategory: 'Enfants', segment_id: 'maison-enfants' }, 'enfants'],
    [{ target_category: 'Tech', target_subcategory: 'Phones', segment_id: 'tech-phones' }, 'phones'],
    [{ target_category: 'Tech', target_subcategory: 'Audio', segment_id: 'tech-audio' }, 'electronique'],
    [{ target_category: 'Bricolage', target_subcategory: 'Outillage', segment_id: 'bricolage-outillage' }, 'autre'],
    [{ target_category: 'Bricolage', target_subcategory: 'Electricité', segment_id: 'bricolage-electricite' }, 'electronique'],
    [{ target_category: 'Créations personnelles', target_subcategory: 'Cérémonie', segment_id: 'creation-ceremonie' }, 'vetements'],
    [{ target_category: 'Créations personnelles', target_subcategory: 'Cadeau', segment_id: 'creation-cadeau' }, 'accessoires'],
    [{ target_category: 'Auto', target_subcategory: 'Filtres', segment_id: 'auto-filtres' }, 'accessoires'],
    [{ target_category: 'Auto', target_subcategory: 'Éclairage', segment_id: 'auto-eclairage' }, 'electronique'],
    [{ target_category: 'AliExpress feed', target_subcategory: 'AEB_ ComputerAccessories_EG' }, 'electronique'],
    [{ target_category: 'AliExpress feed', target_subcategory: 'AEB_ PhoneAccessories_EG' }, 'phones'],
    [{ target_category: 'AliExpress feed', target_subcategory: 'AEB_AU_HomeImprovement&Furniture&Lights&Tools&Luggage' }, 'maison'],
    [{ target_category: 'AliExpress feed', target_subcategory: 'unknown feed' }, 'autre'],
  ])('maps discovery provenance %j to customs category %s', (discovery, expected) => {
    expect(customsCategoryFromDiscovery(discovery)).toBe(expected);
  });

  test('category adapter emits labels understood by the generic scanner', () => {
    expect(categoryHintLabel('phones')).toBe('smartphone');
    expect(categoryHintLabel('vetements')).toMatch(/clothing/);
    expect(categoryHintLabel('not-real')).toBe('unknown category');
  });

  test('manual fields remain locked during re-normalization', () => {
    const row = {
      komerce_category: 'maison',
      estimated_weight_kg: 4,
      data_sources: { category: 'manual', weight: 'manual', volume: 'supplier' },
    };
    const normalized = {
      komerce_category: 'phones',
      estimated_weight_kg: 0.2,
      estimated_volume_m3: 0.01,
      data_sources: { category: 'mapped', weight: 'supplier', volume: 'supplier' },
    };
    const kept = preserveManualFields(row, normalized);
    expect(kept.komerce_category).toBe('maison');
    expect(kept.estimated_weight_kg).toBe(4);
    expect(kept.data_sources.category).toBe('manual');
    expect(kept.data_sources.weight).toBe('manual');
    expect(kept.estimated_volume_m3).toBe(0.01);
  });

  test('freight repair refuses ambiguous live state', () => {
    expect(() => assertFreightRepairable({
      component: { category: 'freight', unit: 'eur', is_active: true },
      finance_rate_eur_m3: 180,
    })).not.toThrow();
    expect(() => assertFreightRepairable({
      component: { category: 'freight', unit: 'kmf_per_m3', is_active: true },
      finance_rate_eur_m3: 180,
    })).toThrow(/réparation automatique interdite/i);
    expect(() => assertFreightRepairable({ component: null, finance_rate_eur_m3: 180 }))
      .toThrow(/introuvable/i);
    expect(() => assertFreightRepairable({
      component: { category: 'freight', unit: 'eur', is_active: true },
      finance_rate_eur_m3: 0,
    })).toThrow(/absent ou nul/i);
  });

  test('repair summary exposes categories, decisions and residual economics', () => {
    const repairs = [
      {
        categoryKey: 'vetements',
        scan: { sourcing_decision: 'WATCH' },
        scanResult: { variable_cost_outside_purchase_kmf: 9000, test_price_kmf: 15000 },
      },
      {
        categoryKey: 'maison',
        scan: { sourcing_decision: 'WATCH' },
        scanResult: { variable_cost_outside_purchase_kmf: 12000, test_price_kmf: 20000 },
      },
    ];
    expect(summarizeRepairs(repairs)).toEqual({
      count: 2,
      categories: { vetements: 1, maison: 1 },
      decisions: { WATCH: 2 },
      variable_cost_outside_purchase_max_kmf: 12000,
      test_price_kmf: { min: 15000, max: 20000 },
    });
  });
});
