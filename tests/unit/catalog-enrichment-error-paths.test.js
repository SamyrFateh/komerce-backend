'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/catalog-enrichment.js, branches d'erreur
 * résiduelles (suite à AUDIT_KOMERCE_2026-07-09.md §5/§6).
 *
 * catalog-enrichment.test.js verrouille le contrat doctrinal (§4/§5/§7/§8).
 * catalog-enrichment-extended.test.js couvre le module prompt en détail.
 * Ni l'un ni l'autre n'exerçait ces 3 branches défensives :
 *
 *   L.167 — recordRun() : l'INSERT de trace échoue → log.error, le flux
 *           n'est jamais interrompu (la trace ne doit jamais faire
 *           échouer l'enrichissement, §8).
 *   L.276 — parseModelJson() renvoie un JSON illisible → wrappé en
 *           ENRICH_INVALID_OUTPUT, jamais une exception brute qui fuit.
 *   L.304 — dans le catch global, le marquage needs_review=TRUE échoue
 *           à son tour → log.error, enrichAndApply répond quand même
 *           proprement (ne rejette jamais, §8).
 *
 * Note : le corps réseau de callModel() (L.98-142 : fetch/AbortController/
 * timeout Anthropic) reste hors périmètre unitaire ici — callModel est
 * mocké via module.exports._callModel dans tout ce lot, comme dans
 * catalog-enrichment.test.js. Le tester nécessiterait de mocker fetch
 * global + timers, sans valeur ajoutée doctrinale (transport générique,
 * même pattern que paypal-client.js).
 */

jest.mock('../../db');
jest.mock('../../utils/rules', () => ({ getRule: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  return { forModule: jest.fn(() => mockLog) };
});

const db = require('../../db');
const { getRule } = require('../../utils/rules');
const log = require('../../utils/logger').forModule('catalog-enrichment');
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

/**
 * Mock DB dispatché sur le texte SQL, avec deux points d'échec pilotables
 * indépendamment : l'INSERT de trace (§8) et l'UPDATE needs_review du
 * catch global — les deux sont des "UPDATE products"/"INSERT INTO ..."
 * génériques dans le code, distingués ici par leur contenu SQL exact.
 */
function installDbMock({
  product,
  glossary = [],
  categories = ['tech', 'mode'],
  overrides = [],
  failTraceInsert = false,
  failNeedsReviewUpdate = false,
} = {}) {
  const updates = [];
  const runs = [];
  db.query.mockReset();
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM products')) return { rows: product ? [product] : [] };
    if (sql.includes('FROM catalog_glossary')) return { rows: glossary };
    if (sql.includes('FROM boutique_categories')) return { rows: categories.map((key) => ({ key })) };
    if (sql.includes('FROM catalog_field_overrides')) return { rows: overrides };
    if (sql.includes('UPDATE products SET needs_review = TRUE')) {
      if (failNeedsReviewUpdate) throw new Error('connexion DB perdue');
      updates.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes('UPDATE products')) { updates.push({ sql, params }); return { rows: [] }; }
    if (sql.includes('INSERT INTO catalog_enrichment_runs')) {
      if (failTraceInsert) throw new Error('table catalog_enrichment_runs verrouillée');
      runs.push({ sql, params });
      return { rows: [] };
    }
    throw new Error(`SQL non mocké: ${sql.slice(0, 60)}`);
  });
  return { updates, runs };
}

beforeEach(() => {
  jest.clearAllMocks();
  getRule.mockResolvedValue(0.8);
  enrichment._callModel = jest.fn();
});

describe('enrichAndApply — recordRun résilient à un échec de trace (L.167, §8)', () => {
  test('happy path, INSERT de trace en échec → statut "ok" quand même, log.error appelé, aucune exception ne fuit', async () => {
    const { updates, runs } = installDbMock({ product: baseProduct(), failTraceInsert: true });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify(GOOD_OUTPUT), model: 'claude-haiku-4-5', inputTokens: 900, outputTokens: 210,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(1); // la fiche est bien appliquée
    expect(runs).toHaveLength(0); // la trace, elle, n'a pas été écrite
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'table catalog_enrichment_runs verrouillée', productId: PRODUCT_ID, status: 'ok' }),
      'trace enrichissement non écrite'
    );
  });

  test('chemin échec (invalid_output), INSERT de trace en échec → statut inchangé, pas de crash', async () => {
    const { runs } = installDbMock({ product: baseProduct(), failTraceInsert: true });
    enrichment._callModel.mockResolvedValue({ text: 'ceci n\'est pas du json', model: 'm', inputTokens: 1, outputTokens: 1 });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('invalid_output');
    expect(runs).toHaveLength(0);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'invalid_output' }),
      'trace enrichissement non écrite'
    );
  });
});

describe('enrichAndApply — JSON illisible du modèle (L.276, §8)', () => {
  test('texte non-JSON → invalid_output, jamais d\'exception brute qui fuit', async () => {
    installDbMock({ product: baseProduct() });
    enrichment._callModel.mockResolvedValue({
      text: 'Désolé, je ne peux pas répondre en JSON ici.', model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('invalid_output');
    expect(res.error).toContain('JSON illisible');
  });

  test('JSON tronqué (balise fence ouverte sans fermeture propre) → invalid_output', async () => {
    installDbMock({ product: baseProduct() });
    enrichment._callModel.mockResolvedValue({
      text: '```json\n{ "name_fr": "Batterie externe"', model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await enrichment.enrichAndApply(PRODUCT_ID);

    expect(res.status).toBe('invalid_output');
    expect(res.error).toContain('JSON illisible');
  });
});

describe('enrichAndApply — double échec : marquage needs_review lui-même en échec (L.304, §8)', () => {
  test('sortie hors schéma + UPDATE needs_review qui échoue → répond quand même proprement, log.error appelé, ne rejette jamais', async () => {
    const { updates, runs } = installDbMock({
      product: baseProduct(),
      failNeedsReviewUpdate: true,
    });
    enrichment._callModel.mockResolvedValue({
      text: JSON.stringify({ ...GOOD_OUTPUT, confidence: 99 }), model: 'm', inputTokens: 1, outputTokens: 1,
    });

    const res = await expect(enrichment.enrichAndApply(PRODUCT_ID)).resolves.toEqual(
      expect.objectContaining({ status: 'invalid_output' })
    );

    // Le marquage needs_review a bien été tenté mais a échoué → pas dans `updates`
    expect(updates).toHaveLength(0);
    // La trace du run, elle, a tout de même été écrite (§8 : échec ≠ silence)
    expect(runs).toHaveLength(1);
    expect(runs[0].params).toContain('invalid_output');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'connexion DB perdue', productId: PRODUCT_ID }),
      'marquage needs_review en échec'
    );
  });

  test('échec API + UPDATE needs_review qui échoue → statut "failed" propre, aucune exception ne fuit', async () => {
    installDbMock({ product: baseProduct(), failNeedsReviewUpdate: true });
    enrichment._callModel.mockRejectedValue(Object.assign(new Error('Anthropic API 529'), { code: 'ENRICH_API_ERROR' }));

    await expect(enrichment.enrichAndApply(PRODUCT_ID)).resolves.toEqual(
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('529') })
    );
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'connexion DB perdue' }),
      'marquage needs_review en échec'
    );
  });
});
