'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests ciblés — trous de couverture branches restants de catalog-enrichment.js
 * (services/catalog-enrichment.js, lignes 98-142, 167, 276, 304 — cf. audit
 * 2026-07-09 §5/§6).
 *
 * Contrairement à catalog-enrichment.test.js et -extended.test.js, ces tests
 * NE mockent PAS enrichment._callModel : ils exercent le vrai callModel()
 * (appel fetch réel du module) pour couvrir la construction de la requête,
 * le timeout/abort, et le traitement de la réponse Anthropic. Les autres
 * tests couvrent le reste du pipeline via un mock global fetch minimal.
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../db');
jest.mock('../../utils/rules', () => ({ getRule: jest.fn() }));

const db = require('../../db');
const log = require('../../utils/logger').forModule('catalog-enrichment');
const { getRule } = require('../../utils/rules');
const enrichment = require('../../services/catalog-enrichment');

const PRODUCT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const GOOD_OUTPUT = {
  name_fr: 'Batterie externe 20000 mAh',
  description_fr: 'Batterie externe compacte, charge rapide.',
  category: 'tech',
  fragility: 'electronique',
  confidence: 0.93,
  review_notes: [],
};

function baseProduct(over = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Power Bank 20000mAh',
    name_source: 'Power Bank 20000mAh',
    description_source: '20000mAh capacity, fast charging.',
    source_locale: 'en',
    category: 'tech',
    ...over,
  };
}

function installDbMock({ product, glossary = [], categories = ['tech', 'mode'], overrides = [], failRunInsert = false, failNeedsReviewUpdate = false } = {}) {
  const updates = [];
  const runs = [];
  db.query.mockReset();
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM products')) return { rows: product ? [product] : [] };
    if (sql.includes('FROM catalog_glossary')) return { rows: glossary };
    if (sql.includes('FROM boutique_categories')) return { rows: categories.map((key) => ({ key })) };
    if (sql.includes('FROM catalog_field_overrides')) return { rows: overrides };
    if (sql.includes('UPDATE products') && sql.includes('needs_review') && !sql.includes('ai_enriched')) {
      if (failNeedsReviewUpdate) throw new Error('DB down — marquage needs_review impossible');
      updates.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes('UPDATE products')) { updates.push({ sql, params }); return { rows: [] }; }
    if (sql.includes('INSERT INTO catalog_enrichment_runs')) {
      if (failRunInsert) throw new Error('DB down — trace non écrite');
      runs.push({ sql, params });
      return { rows: [] };
    }
    throw new Error(`SQL non mocké: ${sql.slice(0, 80)}`);
  });
  return { updates, runs };
}

const ORIGINAL_CALL_MODEL = enrichment._callModel;

beforeEach(() => {
  getRule.mockResolvedValue(0.8);
  jest.clearAllMocks();
  // certains tests remplacent _callModel par un mock : on repart toujours
  // de l'implémentation réelle sauf si un test la remplace explicitement.
  enrichment._callModel = ORIGINAL_CALL_MODEL;
});

// ═══ callModel — appel réel (fetch mocké au niveau global) ══════════════════

describe('callModel — construction de la requête et traitement de la réponse', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.useRealTimers();
    delete global.fetch;
  });

  test('lève ENRICH_NO_KEY si ANTHROPIC_API_KEY est absent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(enrichment._callModel('sys', 'user')).rejects.toMatchObject({
      code: 'ENRICH_NO_KEY',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('appelle le modèle par défaut, filtre les blocs non-text, renvoie tokens', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    delete process.env.CATALOG_ENRICH_MODEL;
    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        model: 'claude-haiku-4-5',
        content: [
          { type: 'text', text: '{"a":1}' },
          { type: 'tool_use', input: { ignored: true } },
          { type: 'text', text: 'suite' },
        ],
        usage: { input_tokens: 111, output_tokens: 22 },
      }),
    });

    const res = await enrichment._callModel('sys prompt', 'user msg');

    expect(res.text).toBe('{"a":1}\nsuite');
    expect(res.model).toBe('claude-haiku-4-5');
    expect(res.inputTokens).toBe(111);
    expect(res.outputTokens).toBe(22);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-test-123');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.max_tokens).toBe(1500);
    expect(body.system).toBe('sys prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'user msg' }]);
  });

  test('utilise CATALOG_ENRICH_MODEL si défini, plutôt que le modèle par défaut', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    process.env.CATALOG_ENRICH_MODEL = 'claude-opus-custom';
    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ model: 'claude-opus-custom', content: [], usage: {} }),
    });

    await enrichment._callModel('sys', 'user');

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).model).toBe('claude-opus-custom');
  });

  test('usage manquant → inputTokens/outputTokens null (pas une exception)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
    });

    const res = await enrichment._callModel('sys', 'user');
    expect(res.inputTokens).toBeNull();
    expect(res.outputTokens).toBeNull();
  });

  test('lève ENRICH_API_ERROR si la réponse HTTP n\'est pas ok', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => 'Overloaded — retry later',
    });

    await expect(enrichment._callModel('sys', 'user')).rejects.toMatchObject({
      code: 'ENRICH_API_ERROR',
      message: expect.stringContaining('529'),
    });
  });

  test('abort au timeout : le signal est propagé à fetch et l\'erreur remonte', async () => {
    jest.useFakeTimers();
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    global.fetch.mockImplementation((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }));

    const promise = enrichment._callModel('sys', 'user');
    // laisser l'assertion .rejects s'attacher avant d'avancer les timers
    const expectation = expect(promise).rejects.toThrow('aborted');
    jest.advanceTimersByTime(45_000);
    await expectation;
  });
});

// ═══ recordRun — la trace ne doit jamais faire échouer le flux (§8) ═════════

describe('enrichAndApply — recordRun résiste à un INSERT en échec', () => {
  test('INSERT INTO catalog_enrichment_runs qui échoue est loggé, enrichAndApply renvoie quand même "ok"', async () => {
    const { updates } = installDbMock({ product: baseProduct(), failRunInsert: true });
    enrichment._callModel = jest.fn().mockResolvedValue({
      text: JSON.stringify(GOOD_OUTPUT), model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(1); // la fiche est bien mise à jour malgré la trace perdue
  });
});

// ═══ JSON illisible renvoyé par le modèle (§8) ══════════════════════════════

describe('enrichAndApply — sortie modèle non-JSON', () => {
  test('texte non-JSON → invalid_output avec message "JSON illisible"', async () => {
    const { updates, runs } = installDbMock({ product: baseProduct() });
    enrichment._callModel = jest.fn().mockResolvedValue({
      text: 'Désolé, je ne peux pas répondre en JSON ici.',
      model: 'm', inputTokens: 5, outputTokens: 5,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('invalid_output');
    expect(res.error).toContain('JSON illisible');
    // needs_review posé, pas d'application de fiche enrichie
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('needs_review = TRUE');
    expect(runs[0].params).toContain('invalid_output');
  });
});

// ═══ Échec du marquage needs_review après un échec d'enrichissement (§8) ═══

describe('enrichAndApply — le marquage needs_review échoue aussi', () => {
  test('double échec (API + UPDATE needs_review) : loggé, ne remonte pas, statut "failed" conservé', async () => {
    const { runs } = installDbMock({
      product: baseProduct(),
      failNeedsReviewUpdate: true,
    });
    enrichment._callModel = jest.fn().mockRejectedValue(
      Object.assign(new Error('Anthropic API 529'), { code: 'ENRICH_API_ERROR' }),
    );

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('failed');
    expect(res.error).toContain('529');
    // la trace du run reste écrite malgré l'échec du marquage needs_review
    expect(runs[0].params).toContain('failed');
  });
});

// ═══ Branches ternaires restantes (category/source_locale/content absents) ══

describe('applyEnrichment — category absente dans la sortie modèle', () => {
  test('category falsy (undefined) → champ category non posé, name/description seuls', async () => {
    const { updates } = installDbMock({ product: baseProduct() });
    enrichment._callModel = jest.fn().mockResolvedValue({
      text: JSON.stringify({ ...GOOD_OUTPUT, category: undefined, fragility: undefined }),
      model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('ok');
    expect(updates[0].sql).not.toContain('category =');
    expect(updates[0].sql).not.toContain('fragility =');
  });
});

describe('enrichAndApply — source_locale absent sur la fiche produit', () => {
  test('source_locale null → fallback "en" transmis au prompt utilisateur', async () => {
    installDbMock({ product: baseProduct({ source_locale: null }) });
    enrichment._callModel = jest.fn().mockImplementation(async (_sys, userMessage) => {
      expect(JSON.parse(userMessage).source_locale).toBe('en');
      return { text: JSON.stringify(GOOD_OUTPUT), model: 'm', inputTokens: 1, outputTokens: 1 };
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);
    expect(res.status).toBe('ok');
    expect(enrichment._callModel).toHaveBeenCalled();
  });
});

describe('enrichAndApply — texte modèle vide (branche de repli parseModelJson)', () => {
  test('call.text vide ("") → invalid_output, JSON.parse("") lève proprement', async () => {
    const { updates } = installDbMock({ product: baseProduct() });
    enrichment._callModel = jest.fn().mockResolvedValue({ text: '', model: 'm', inputTokens: 0, outputTokens: 0 });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('invalid_output');
    expect(res.error).toContain('JSON illisible');
    expect(updates[0].sql).toContain('needs_review = TRUE');
  });
});

describe('callModel — réponse API sans champ "content"', () => {
  test('data.content absent → texte vide (fallback []) sans exception', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ model: 'm' }), // pas de content, pas de usage
    });

    const res = await enrichment._callModel('sys', 'user');
    expect(res.text).toBe('');
    delete global.fetch;
  });
});
