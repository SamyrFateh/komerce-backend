'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — K-3 enrichissement FR (DOCTRINE_CATALOGUE §4, §5, §8)
 */

jest.mock('../../db');
jest.mock('../../utils/rules', () => ({ getRule: jest.fn() }));

const db = require('../../db');
const { getRule } = require('../../utils/rules');
const prompt = require('../../services/prompts/catalog-enrichment.prompt');
const enrichment = require('../../services/catalog-enrichment');

const PRODUCT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const GOOD_OUTPUT = {
  name_fr: 'Batterie externe 20000 mAh',
  description_fr: 'Batterie externe compacte, charge rapide. Capacité 20000 mAh.',
  category: 'tech',
  fragility: 'electronique',
  confidence: 0.93,
  review_notes: [],
};

function installDbMock({ product, glossary = [], categories = ['tech', 'mode'], overrides = [] } = {}) {
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
    throw new Error(`SQL non mocké: ${sql.slice(0, 60)}`);
  });
  return { updates, runs };
}

function baseProduct(over = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Power Bank 20000mAh Fast Charge BEST SELLER!!',
    name_source: 'Power Bank 20000mAh Fast Charge BEST SELLER!!',
    description_source: '20000mAh capacity, fast charging.',
    source_locale: 'en',
    category: 'tech',
    ...over,
  };
}

beforeEach(() => {
  getRule.mockResolvedValue(0.8);
  enrichment._callModel = jest.fn();
});

describe('prompt catalog-enrichment', () => {
  test('le glossaire est injecté, "=" signifie ne pas traduire (§4)', () => {
    const sys = prompt.buildSystemPrompt({
      glossary: [
        { term_source: 'abaya', term_fr: '=', note: 'ne pas traduire' },
        { term_source: 'power bank', term_fr: 'batterie externe', note: null },
      ],
      allowedCategories: ['mode'],
    });
    expect(sys).toContain('"abaya" → NE PAS TRADUIRE');
    expect(sys).toContain('"power bank" → "batterie externe"');
    expect(sys).toContain('mode');
  });

  test('validateOutput accepte une sortie conforme et normalise', () => {
    const v = prompt.validateOutput({ ...GOOD_OUTPUT, name_fr: '  Batterie externe  ' }, { allowedCategories: ['tech'] });
    expect(v.ok).toBe(true);
    expect(v.value.name_fr).toBe('Batterie externe');
  });

  test.each([
    ['confidence hors bornes', { ...GOOD_OUTPUT, confidence: 1.4 }],
    ['catégorie hors liste', { ...GOOD_OUTPUT, category: 'armes' }],
    ['fragility hors valeurs conseillées', { ...GOOD_OUTPUT, fragility: 'explosif' }],
    ['name_fr vide', { ...GOOD_OUTPUT, name_fr: '  ' }],
  ])('validateOutput rejette : %s', (_label, bad) => {
    const v = prompt.validateOutput(bad, { allowedCategories: ['tech'] });
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});

describe('enrichAndApply — application (§4)', () => {
  test('sortie conforme, confiance haute → fiche ai_enriched, run "ok"', async () => {
    const { updates, runs } = installDbMock({ product: baseProduct() });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(GOOD_OUTPUT), model: 'claude-haiku-4-5', inputTokens: 900, outputTokens: 210,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(1);
    const upd = updates[0];
    expect(upd.sql).toContain(`content_source = 'ai_enriched'`);
    expect(upd.params).toContain('Batterie externe 20000 mAh');
    expect(upd.params).toContain(false);
    expect(upd.sql).not.toMatch(/name_source|description_source|source_locale/);
    expect(runs).toHaveLength(1);
    expect(runs[0].params).toEqual(expect.arrayContaining(['ok', 900, 210, prompt.PROMPT_VERSION]));
  });

  test('confiance sous le seuil → appliqué + needs_review, run "low_confidence"', async () => {
    const { updates, runs } = installDbMock({ product: baseProduct() });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify({ ...GOOD_OUTPUT, confidence: 0.55 }), model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('low_confidence');
    expect(res.needsReview).toBe(true);
    expect(updates[0].params).toContain(true);
    expect(runs[0].params).toContain('low_confidence');
  });

  test('le JSON balisé ```json est toléré', async () => {
    installDbMock({ product: baseProduct() });
    enrichment._callModel.mockResolvedValue({
      text: '```json\n' + JSON.stringify(GOOD_OUTPUT) + '\n```', model: 'm', inputTokens: 1, outputTokens: 1,
    });
    const res = await enrichment.enrichAndApply(PRODUCT_ID);
    expect(res.status).toBe('ok');
  });
});

describe('enrichAndApply — overrides (§5)', () => {
  test('un override tracé gagne sur la valeur générée', async () => {
    const { updates } = installDbMock({
      product: baseProduct(),
      overrides: [{ field_name: 'name', field_value: 'Batterie nomade 20000 mAh (retouche admin)' }],
    });
    enrichment._callModel.mockResolvedValue({ text: JSON.stringify(GOOD_OUTPUT), model: 'm', inputTokens: 1, outputTokens: 1 });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.appliedOverrides).toEqual(['name']);
    expect(updates[0].params).toContain('Batterie nomade 20000 mAh (retouche admin)');
    expect(updates[0].params).not.toContain('Batterie externe 20000 mAh');
  });

  test('un override hors whitelist est ignoré (jamais interpolé en SQL)', async () => {
    const { updates } = installDbMock({
      product: baseProduct(),
      overrides: [{ field_name: 'price_kmf; DROP TABLE products', field_value: '0' }],
    });
    enrichment._callModel.mockResolvedValue({ text: JSON.stringify(GOOD_OUTPUT), model: 'm', inputTokens: 1, outputTokens: 1 });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('ok');
    expect(res.appliedOverrides).toEqual([]);
    expect(updates[0].sql).not.toContain('DROP TABLE');
  });
});

describe('enrichAndApply — échecs (§8)', () => {
  test('sortie hors schéma → invalid_output, champs publiés intacts, needs_review posé', async () => {
    const { updates, runs } = installDbMock({ product: baseProduct() });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify({ ...GOOD_OUTPUT, confidence: 99 }), model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('invalid_output');
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('needs_review = TRUE');
    expect(updates[0].sql).not.toContain('ai_enriched');
    expect(runs[0].params).toContain('invalid_output');
  });

  test('échec API → failed, run tracé avec erreur, aucune exception ne fuit', async () => {
    const { updates, runs } = installDbMock({ product: baseProduct() });
    enrichment._callModel.mockRejectedValue(Object.assign(new Error('API 529'), { code: 'ENRICH_API_ERROR' }));

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('failed');
    expect(res.error).toContain('529');
    expect(updates[0].sql).toContain('needs_review = TRUE');
    expect(runs[0].params).toContain('failed');
  });

  test('produit introuvable → failed propre, aucun UPDATE de fiche', async () => {
    installDbMock({ product: null });
    const res = await enrichment.enrichAndApply(PRODUCT_ID);
    expect(res.status).toBe('failed');
    expect(res.error).toContain('introuvable');
  });
});

describe('transport IA multi-provider', () => {
  const savedProvider = process.env.CATALOG_ENRICH_PROVIDER;
  const savedModel = process.env.CATALOG_ENRICH_MODEL;
  const savedOpenAIKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (savedProvider === undefined) delete process.env.CATALOG_ENRICH_PROVIDER;
    else process.env.CATALOG_ENRICH_PROVIDER = savedProvider;
    if (savedModel === undefined) delete process.env.CATALOG_ENRICH_MODEL;
    else process.env.CATALOG_ENRICH_MODEL = savedModel;
    if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenAIKey;
    jest.restoreAllMocks();
  });

  test('provider OpenAI est sélectionnable explicitement', () => {
    process.env.CATALOG_ENRICH_PROVIDER = 'openai';
    expect(enrichment.resolveProvider()).toBe('openai');
  });

  test('Luna utilise Responses API + Structured Outputs et remonte les tokens', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.CATALOG_ENRICH_MODEL = 'gpt-5.6-luna';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 'completed',
        model: 'gpt-5.6-luna',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(GOOD_OUTPUT) }],
        }],
        usage: { input_tokens: 812, output_tokens: 146 },
      }),
    });

    const result = await enrichment._callOpenAIModel('SYSTEME', '{"name_source":"Power Bank"}');

    expect(result).toMatchObject({ model: 'gpt-5.6-luna', inputTokens: 812, outputTokens: 146 });
    expect(JSON.parse(result.text)).toMatchObject({ name_fr: GOOD_OUTPUT.name_fr });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.headers.authorization).toBe('Bearer test-openai-key');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.text.format.schema.required).toEqual(expect.arrayContaining(['name_fr', 'description_fr', 'confidence']));
  });
});
