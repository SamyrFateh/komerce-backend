'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests étendus — Raffinerie catalogue (K-3)
 *
 * Complète catalog-enrichment.test.js avec :
 *   - Tests buildUserMessage (jamais testé)
 *   - Test re-raffinage (produit déjà enrichi — §5)
 *   - Test fragility et emoji dans la sortie
 *   - Test glossaire vide
 *   - Test source_locale arabe (ar)
 *   - Test sans donnée source (§7)
 *   - Test avec plusieurs overrides combinés
 *   - Données réalistes Dubaï → FR via fixtures
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../db');
jest.mock('../../utils/rules', () => ({ getRule: jest.fn() }));

const db = require('../../db');
const { getRule } = require('../../utils/rules');
const prompt = require('../../services/prompts/catalog-enrichment.prompt');
const enrichment = require('../../services/catalog-enrichment');
const {
  PRODUCTS, ENRICHED_OUTPUTS, TEST_GLOSSARY, TEST_CATEGORIES, TEST_OVERRIDES,
} = require('./catalog-enrichment-fixtures');

function installDbMock({ product, glossary = TEST_GLOSSARY, categories = TEST_CATEGORIES, overrides = [] } = {}) {
  const updates = [];
  const runs = [];
  db.query.mockReset();
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM products')) return { rows: product ? [product] : [] };
    if (sql.includes('FROM catalog_glossary')) return { rows: glossary };
    if (sql.includes('FROM boutique_categories')) return { rows: categories.map((key) => ({ key })) };
    if (sql.includes('FROM catalog_field_overrides')) return { rows: overrides };
    if (sql.includes('UPDATE products')) { updates.push({ sql, params }); return { rows: [] }; }
    if (sql.includes('INSERT INTO catalog_enrichment_runs')) { runs.push({ sql, params }); return { rows: [] }; }
    throw new Error(`SQL non mocké: ${sql.slice(0, 80)}`);
  });
  return { updates, runs };
}

beforeEach(() => {
  getRule.mockResolvedValue(0.8);
  enrichment._callModel = jest.fn();
});

// ═══ Prompt — buildUserMessage ══════════════════════════════════════════════

describe('prompt — buildUserMessage', () => {
  test('inclut name_source, description_source, source_locale', () => {
    const msg = prompt.buildUserMessage({
      name_source: 'Power Bank 20000mAh',
      description_source: 'Fast charging',
      source_locale: 'en',
      current_category: 'tech',
    });
    const parsed = JSON.parse(msg);
    expect(parsed.name_source).toBe('Power Bank 20000mAh');
    expect(parsed.description_source).toBe('Fast charging');
    expect(parsed.source_locale).toBe('en');
    expect(parsed.current_category).toBe('tech');
  });

  test('description_source null → null dans le JSON (pas undefined)', () => {
    const msg = prompt.buildUserMessage({
      name_source: 'Test', description_source: null, source_locale: 'en',
    });
    const parsed = JSON.parse(msg);
    expect(parsed.description_source).toBeNull();
  });

  test('source_locale arabe', () => {
    const msg = prompt.buildUserMessage({
      name_source: 'عباية فاخرة',
      description_source: 'Premium abaya',
      source_locale: 'ar',
      current_category: 'mode',
    });
    const parsed = JSON.parse(msg);
    expect(parsed.source_locale).toBe('ar');
    expect(parsed.name_source).toContain('عباية');
  });
});

// ═══ Prompt — validateOutput edge cases ═══════════════════════════════════════

describe('prompt — validateOutput edge cases', () => {
  test('fragility valide est acceptée et propagée', () => {
    const v = prompt.validateOutput({
      ...ENRICHED_OUTPUTS.electronique,
      fragility: 'electronique',
    }, { allowedCategories: TEST_CATEGORIES });
    expect(v.ok).toBe(true);
    expect(v.value.fragility).toBe('electronique');
  });

  test('fragility null est acceptée', () => {
    const v = prompt.validateOutput({
      ...ENRICHED_OUTPUTS.abaya,
      fragility: null,
    }, { allowedCategories: TEST_CATEGORIES });
    expect(v.ok).toBe(true);
    expect(v.value.fragility).toBeNull();
  });

  test('review_notes avec entrées non-string sont filtrées', () => {
    const v = prompt.validateOutput({
      ...ENRICHED_OUTPUTS.powerBank,
      review_notes: ['ok', 42, null, 'note valide', { obj: true }],
    }, { allowedCategories: TEST_CATEGORIES });
    expect(v.ok).toBe(true);
    expect(v.value.review_notes).toEqual(['ok', 'note valide']);
  });

  test('confidence exactement 0 est valide', () => {
    const v = prompt.validateOutput({
      ...ENRICHED_OUTPUTS.powerBank,
      confidence: 0,
    }, { allowedCategories: TEST_CATEGORIES });
    expect(v.ok).toBe(true);
    expect(v.value.confidence).toBe(0);
  });

  test('confidence exactement 1 est valide', () => {
    const v = prompt.validateOutput({
      ...ENRICHED_OUTPUTS.powerBank,
      confidence: 1,
    }, { allowedCategories: TEST_CATEGORIES });
    expect(v.ok).toBe(true);
  });

  test('name_fr > 120 caractères est rejeté', () => {
    const v = prompt.validateOutput({
      ...ENRICHED_OUTPUTS.powerBank,
      name_fr: 'A'.repeat(121),
    }, { allowedCategories: TEST_CATEGORIES });
    expect(v.ok).toBe(false);
  });
});

// ═══ Prompt système — glossaire vide ═════════════════════════════════════════

describe('prompt — glossaire vide', () => {
  test('prompt système fonctionne sans glossaire', () => {
    const sys = prompt.buildSystemPrompt({ glossary: [], allowedCategories: TEST_CATEGORIES });
    expect(sys).toContain('aucune entrée');
    expect(sys).toContain('tech');
  });
});

// ═══ enrichAndApply — produits réalistes ═════════════════════════════════════

describe('enrichAndApply — produits Dubaï réalistes', () => {
  test('abaya arabe enrichie correctement (source_locale=ar)', async () => {
    const { updates, runs } = installDbMock({ product: PRODUCTS.abaya });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(ENRICHED_OUTPUTS.abaya),
      model: 'claude-haiku-4-5', inputTokens: 850, outputTokens: 200,
    });

    const res = await enrichment.enrichAndApply(PRODUCTS.abaya.id);

    expect(res.status).toBe('ok');
    expect(updates[0].params).toContain('Abaya brodée — taille unique');
    expect(res.review_notes).toEqual(expect.arrayContaining([
      expect.stringContaining('arabe'),
    ]));
  });

  test('parfum à faible confiance → low_confidence + review_notes', async () => {
    const { runs } = installDbMock({ product: PRODUCTS.parfum });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(ENRICHED_OUTPUTS.parfum),
      model: 'claude-haiku-4-5', inputTokens: 900, outputTokens: 220,
    });

    const res = await enrichment.enrichAndApply(PRODUCTS.parfum.id);

    expect(res.status).toBe('low_confidence');
    expect(res.needsReview).toBe(true);
    expect(res.review_notes.length).toBeGreaterThan(0);
    expect(runs[0].params).toContain('low_confidence');
  });

  test('produit avec fragility = electronique → champ posé', async () => {
    const { updates } = installDbMock({ product: PRODUCTS.electronique });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(ENRICHED_OUTPUTS.electronique),
      model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 250,
    });

    const res = await enrichment.enrichAndApply(PRODUCTS.electronique.id);

    expect(res.status).toBe('ok');
    const upd = updates[0];
    expect(upd.sql).toContain('fragility');
    expect(upd.params).toContain('electronique');
  });

  test('sans donnée source → failed proprement (§7)', async () => {
    installDbMock({ product: PRODUCTS.sansDonneeSource });
    const res = await enrichment.enrichAndApply(PRODUCTS.sansDonneeSource.id);
    expect(res.status).toBe('failed');
    expect(res.error).toContain('source');
  });
});

// ═══ enrichAndApply — re-raffinage avec overrides combinés (§5) ══════════════

describe('enrichAndApply — re-raffinage avec overrides combinés', () => {
  test('name + emoji overridés, description du modèle gardée', async () => {
    const { updates } = installDbMock({
      product: { ...PRODUCTS.powerBank, content_source: 'ai_enriched', enrichment_version: 1 },
      overrides: [TEST_OVERRIDES.nameOverride, TEST_OVERRIDES.emojiOverride],
    });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(ENRICHED_OUTPUTS.powerBank),
      model: 'claude-haiku-4-5', inputTokens: 900, outputTokens: 210,
    });

    const res = await enrichment.enrichAndApply(PRODUCTS.powerBank.id);

    expect(res.status).toBe('ok');
    expect(res.appliedOverrides).toEqual(expect.arrayContaining(['name', 'emoji']));
    // Le name retouché gagne sur le name généré
    expect(updates[0].params).toContain('Batterie nomade 20000 mAh (retouche admin)');
    expect(updates[0].params).not.toContain('Batterie externe 20000 mAh charge rapide');
    // L'emoji override est posé
    expect(updates[0].params).toContain('🔋');
    // La description du modèle est gardée (pas overridée)
    expect(updates[0].params).toContain(ENRICHED_OUTPUTS.powerBank.description_fr);
  });

  test('override description + SQL injection → seul le description valide est appliqué', async () => {
    const { updates } = installDbMock({
      product: PRODUCTS.powerBank,
      overrides: [TEST_OVERRIDES.validDescription, TEST_OVERRIDES.sqlInjection],
    });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(ENRICHED_OUTPUTS.powerBank),
      model: 'claude-haiku-4-5', inputTokens: 900, outputTokens: 210,
    });

    const res = await enrichment.enrichAndApply(PRODUCTS.powerBank.id);

    expect(res.appliedOverrides).toEqual(['description']);
    expect(updates[0].sql).not.toContain('DROP TABLE');
    expect(updates[0].params).toContain('Description retouchée.');
  });
});
