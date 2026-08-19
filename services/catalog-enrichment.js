/**
 * @komerce-arch
 * @role          catalog-enrichment
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_source_data, glossary, business_rules
 * @outputs       enriched_product_fields, enrichment_run_trace
 * @depends       db.js, utils/rules.js, utils/logger.js,
 *                services/prompts/catalog-enrichment.prompt.js
 * @used-by       routes/sourcing-scanner.js, scripts/showcase-v2-seed.js
 * @db-read       boutique_categories, catalog_field_overrides, catalog_glossary, products
 * @db-write      catalog_enrichment_runs, products
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, sourcing
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Étage ⑤ Enrichissement FR (K-3)
 *
 * La doctrine métier est indépendante du fournisseur IA. Le provider est
 * choisi par CATALOG_ENRICH_PROVIDER=anthropic|openai. Même prompt, même
 * contrat de sortie, même validation, même traçabilité et mêmes overrides.
 */

const db = require('../db');
const log = require('../utils/logger').forModule('catalog-enrichment');
const { getRule } = require('../utils/rules');
const prompt = require('./prompts/catalog-enrichment.prompt');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const CALL_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 1500;

const OVERRIDABLE_FIELDS = ['name', 'description', 'category', 'fragility', 'emoji'];

async function loadGlossary() {
  const { rows } = await db.query(
    `SELECT term_source, term_fr, note
       FROM catalog_glossary
      WHERE is_active = TRUE
      ORDER BY term_source`
  );
  return rows;
}

async function loadAllowedCategories() {
  const { rows } = await db.query(
    `SELECT key FROM boutique_categories ORDER BY key`
  );
  return rows.map((r) => r.key);
}

async function loadOverrides(productId) {
  const { rows } = await db.query(
    `SELECT field_name, field_value
       FROM catalog_field_overrides
      WHERE product_id = $1`,
    [productId]
  );
  return rows;
}

function resolveProvider() {
  const provider = String(process.env.CATALOG_ENRICH_PROVIDER || 'anthropic').trim().toLowerCase();
  if (!['anthropic', 'openai'].includes(provider)) {
    const err = new Error(`CATALOG_ENRICH_PROVIDER invalide: ${provider}`);
    err.code = 'ENRICH_PROVIDER_INVALID';
    throw err;
  }
  return provider;
}

function outputSchema() {
  return {
    type: 'object',
    properties: {
      name_fr: { type: 'string' },
      description_fr: { type: 'string' },
      category: { type: ['string', 'null'] },
      fragility: {
        type: ['string', 'null'],
        enum: [...prompt.ALLOWED_FRAGILITIES, null],
      },
      confidence: { type: 'number' },
      review_notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['name_fr', 'description_fr', 'category', 'fragility', 'confidence', 'review_notes'],
    additionalProperties: false,
  };
}

async function callAnthropicModel(systemPrompt, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY manquant — enrichissement indisponible');
    err.code = 'ENRICH_NO_KEY';
    throw err;
  }
  const model = process.env.CATALOG_ENRICH_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
      err.code = 'ENRICH_API_ERROR';
      throw err;
    }
    const data = JSON.parse(body);
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return {
      text,
      model: data.model || model,
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIModel(systemPrompt, userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY manquant — enrichissement indisponible');
    err.code = 'ENRICH_NO_KEY';
    throw err;
  }
  const model = process.env.CATALOG_ENRICH_MODEL || DEFAULT_OPENAI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: userMessage,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'catalog_enrichment',
            strict: true,
            schema: outputSchema(),
          },
        },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      const err = new Error(`OpenAI API ${res.status}: ${body.slice(0, 300)}`);
      err.code = 'ENRICH_API_ERROR';
      throw err;
    }
    const data = JSON.parse(body);
    const text = (data.output || [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text)
      .join('\n');
    if (!text) {
      const err = new Error(`OpenAI API: réponse sans output_text (status=${data.status || 'unknown'})`);
      err.code = 'ENRICH_INVALID_OUTPUT';
      throw err;
    }
    return {
      text,
      model: data.model || model,
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(systemPrompt, userMessage) {
  const provider = resolveProvider();
  if (provider === 'openai') return callOpenAIModel(systemPrompt, userMessage);
  return callAnthropicModel(systemPrompt, userMessage);
}

function parseModelJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function recordRun({ productId, status, confidence = null, model = null, inputTokens = null, outputTokens = null, durationMs = null, error = null }) {
  try {
    await db.query(
      `INSERT INTO catalog_enrichment_runs
         (product_id, prompt_version, model, status, confidence,
          input_tokens, output_tokens, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [productId, prompt.PROMPT_VERSION, model || 'unknown', status, confidence,
       inputTokens, outputTokens, durationMs, error]
    );
  } catch (e) {
    log.error({ err: e.message, productId, status }, 'trace enrichissement non écrite');
  }
}

async function applyEnrichment(productId, enriched, { confidenceMin }) {
  const generated = {
    name: enriched.name_fr,
    description: enriched.description_fr,
    ...(enriched.category ? { category: enriched.category } : {}),
    ...(enriched.fragility ? { fragility: enriched.fragility } : {}),
  };

  const overrides = await loadOverrides(productId);
  const appliedOverrides = [];
  for (const o of overrides) {
    if (!OVERRIDABLE_FIELDS.includes(o.field_name)) {
      log.warn({ productId, field: o.field_name }, 'override hors whitelist — ignoré');
      continue;
    }
    generated[o.field_name] = o.field_value;
    appliedOverrides.push(o.field_name);
  }

  const needsReview = enriched.confidence < confidenceMin;
  const cols = [];
  const vals = [];
  let i = 1;
  for (const [field, value] of Object.entries(generated)) {
    if (!['name', 'description', ...OVERRIDABLE_FIELDS].includes(field)) continue;
    cols.push(`${field} = $${i++}`);
    vals.push(value);
  }
  cols.push(`content_source = 'ai_enriched'`);
  cols.push(`enrichment_version = $${i++}`); vals.push(prompt.PROMPT_VERSION);
  cols.push(`enrichment_confidence = $${i++}`); vals.push(enriched.confidence);
  cols.push(`needs_review = $${i++}`); vals.push(needsReview);
  cols.push(`updated_at = NOW()`);
  vals.push(productId);

  await db.query(`UPDATE products SET ${cols.join(', ')} WHERE id = $${i}`, vals);
  return { needsReview, appliedOverrides };
}

async function enrichAndApply(productId) {
  const started = Date.now();
  let model = null; let inputTokens = null; let outputTokens = null;
  try {
    const { rows } = await db.query(
      `SELECT id, name, name_source, description_source, source_locale, category, subcategory
         FROM products WHERE id = $1`,
      [productId]
    );
    if (!rows.length) return { status: 'failed', error: 'produit introuvable' };
    const p = rows[0];
    const nameSource = p.name_source;
    if (!nameSource) return { status: 'failed', error: 'aucune donnée source' };

    const [glossary, allowedCategories, confidenceMin] = await Promise.all([
      loadGlossary(),
      loadAllowedCategories(),
      getRule('CATALOG_ENRICH_CONFIDENCE_MIN', 0.8),
    ]);

    const systemPrompt = prompt.buildSystemPrompt({ glossary, allowedCategories });
    const userMessage = prompt.buildUserMessage({
      name_source: nameSource,
      description_source: p.description_source,
      source_locale: p.source_locale || 'en',
      current_category: p.category,
      current_subcategory: p.subcategory,
    });

    const call = await module.exports._callModel(systemPrompt, userMessage);
    model = call.model; inputTokens = call.inputTokens; outputTokens = call.outputTokens;

    let parsed;
    try {
      parsed = parseModelJson(call.text);
    } catch (e) {
      throw Object.assign(new Error(`JSON illisible: ${e.message}`), { code: 'ENRICH_INVALID_OUTPUT' });
    }
    const verdict = prompt.validateOutput(parsed, { allowedCategories });
    if (!verdict.ok) {
      const err = new Error(`sortie hors schéma: ${verdict.errors.join(' ; ')}`);
      err.code = 'ENRICH_INVALID_OUTPUT';
      throw err;
    }

    const { needsReview, appliedOverrides } = await applyEnrichment(productId, verdict.value, { confidenceMin });
    const status = needsReview ? 'low_confidence' : 'ok';
    await recordRun({
      productId, status, confidence: verdict.value.confidence, model,
      inputTokens, outputTokens, durationMs: Date.now() - started,
    });
    log.info({ productId, status, confidence: verdict.value.confidence, provider: resolveProvider() }, 'fiche enrichie');
    return { status, confidence: verdict.value.confidence, needsReview, appliedOverrides, review_notes: verdict.value.review_notes };
  } catch (err) {
    const status = err.code === 'ENRICH_INVALID_OUTPUT' ? 'invalid_output' : 'failed';
    await recordRun({
      productId, status, model, inputTokens, outputTokens,
      durationMs: Date.now() - started, error: err.message,
    });
    try {
      await db.query(`UPDATE products SET needs_review = TRUE, updated_at = NOW() WHERE id = $1`, [productId]);
    } catch (e2) {
      log.error({ err: e2.message, productId }, 'marquage needs_review en échec');
    }
    log.warn({ productId, status, err: err.message }, 'enrichissement en échec — fiche restée en donnée source');
    return { status, error: err.message };
  }
}

module.exports = {
  enrichAndApply,
  applyEnrichment,
  loadGlossary,
  loadAllowedCategories,
  resolveProvider,
  outputSchema,
  OVERRIDABLE_FIELDS,
  _callModel: callModel,
  _callAnthropicModel: callAnthropicModel,
  _callOpenAIModel: callOpenAIModel,
};
