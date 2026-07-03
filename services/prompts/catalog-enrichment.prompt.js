/**
 * @komerce-arch
 * @role          catalog-enrichment-prompt
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        glossary_entries, allowed_categories, product_source_data
 * @outputs       prompt_strings, output_validation_verdict
 * @depends       (none)
 * @used-by       services/catalog-enrichment.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — Prompt d'enrichissement FR (K-3, DOCTRINE_CATALOGUE.md §4 et §8)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * §8 : "le prompt est du code" — il vit ici, dans le dépôt, versionné.
 * Un changement de prompt = PROMPT_VERSION incrémenté = une PR = les gates.
 * products.enrichment_version enregistre quelle version a produit chaque
 * fiche : c'est ce qui permet le re-raffinage en masse ciblé (§5).
 *
 * Ce module possède aussi le CONTRAT DE SORTIE (validateOutput) : le schéma
 * et sa validation vivent avec le prompt qui le demande — ils changent
 * ensemble, dans le même commit.
 *
 * Le module est pur (aucun accès DB, aucun réseau) : trivialement testable.
 */

const PROMPT_VERSION = 1;

// Valeurs conseillées de products.fragility (migration 096, DOCTRINE_NON_CONFORMITE §3).
const ALLOWED_FRAGILITIES = ['fragile', 'electronique', 'sensible_chaleur', 'sensible_humidite'];

// ── Prompt système ────────────────────────────────────────────────────────────

/**
 * @param {{ glossary: Array<{term_source:string, term_fr:string, note:?string}>,
 *           allowedCategories: string[] }} ctx
 * @returns {string}
 */
function buildSystemPrompt({ glossary = [], allowedCategories = [] }) {
  const glossaryLines = glossary.length
    ? glossary.map((g) => {
        const target = g.term_fr === '=' ? 'NE PAS TRADUIRE (conserver tel quel)' : `"${g.term_fr}"`;
        return `- "${g.term_source}" → ${target}${g.note ? ` (${g.note})` : ''}`;
      }).join('\n')
    : '- (aucune entrée pour l\'instant)';

  return [
    'Tu es le rédacteur catalogue de Komerce, e-commerce comorien qui importe depuis Dubaï.',
    'On te donne la fiche fournisseur ORIGINALE (généralement en anglais, style SEO marketplace).',
    'Tu produis la fiche CLIENT en FRANÇAIS. Ce n\'est pas une traduction littérale : c\'est une réécriture orientée client.',
    '',
    'Règles :',
    '- Titre court (max 80 caractères), clair, sans bourrage de mots-clés SEO.',
    '- Description fidèle à la source : n\'invente AUCUNE caractéristique absente de la donnée fournisseur.',
    '- Convertis les unités (inches → cm, oz → g, lbs → kg). Explique les tailles (UK/EU) si présentes.',
    '- Si le texte source évoque fragilité, électronique, sensibilité chaleur/humidité : propose le tag correspondant.',
    '',
    'GLOSSAIRE IMPOSÉ (prioritaire sur tout) :',
    glossaryLines,
    '',
    `Catégories boutique autorisées : ${allowedCategories.join(', ') || '(fournies dans le message)'}.`,
    '',
    'Réponds UNIQUEMENT avec un objet JSON, sans texte autour, sans balises markdown :',
    '{',
    '  "name_fr": "titre court FR",',
    '  "description_fr": "description FR adaptée",',
    '  "category": "une catégorie autorisée, ou null si aucune ne convient",',
    `  "fragility": "un tag parmi ${ALLOWED_FRAGILITIES.join(' | ')}, ou null",`,
    '  "confidence": 0.0 à 1.0 — ta confiance dans la fidélité de la fiche produite,',
    '  "review_notes": ["passages douteux ou ambigus de la source, en FR", ...] (vide si rien)',
    '}',
    'Baisse "confidence" si la source est ambiguë, incomplète, ou si tu as dû interpréter.',
  ].join('\n');
}

// ── Message utilisateur ───────────────────────────────────────────────────────

/**
 * @param {{ name_source:string, description_source:?string, source_locale:?string,
 *           supplier_category:?string, current_category:?string }} source
 * @returns {string}
 */
function buildUserMessage(source) {
  return JSON.stringify({
    name_source: source.name_source,
    description_source: source.description_source || null,
    source_locale: source.source_locale || 'en',
    supplier_category: source.supplier_category || null,
    current_category: source.current_category || null,
  });
}

// ── Contrat de sortie ─────────────────────────────────────────────────────────

/**
 * Valide la sortie du modèle contre le schéma. Zéro confiance : tout champ
 * hors contrat = rejet ('invalid_output' côté service, rien n'est appliqué).
 *
 * @param {any} parsed  Objet déjà JSON.parse-é
 * @param {{ allowedCategories: string[] }} ctx
 * @returns {{ ok:true, value:object } | { ok:false, errors:string[] }}
 */
function validateOutput(parsed, { allowedCategories = [] } = {}) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['sortie non-objet'] };
  }

  const nameFr = typeof parsed.name_fr === 'string' ? parsed.name_fr.trim() : '';
  if (!nameFr || nameFr.length > 120) errors.push('name_fr requis, 1..120 caractères');

  const descFr = typeof parsed.description_fr === 'string' ? parsed.description_fr.trim() : '';
  if (!descFr || descFr.length > 4000) errors.push('description_fr requis, 1..4000 caractères');

  let category = null;
  if (parsed.category != null) {
    if (typeof parsed.category !== 'string' || !allowedCategories.includes(parsed.category)) {
      errors.push(`category hors liste autorisée: ${String(parsed.category)}`);
    } else {
      category = parsed.category;
    }
  }

  let fragility = null;
  if (parsed.fragility != null) {
    if (!ALLOWED_FRAGILITIES.includes(parsed.fragility)) {
      errors.push(`fragility hors valeurs conseillées: ${String(parsed.fragility)}`);
    } else {
      fragility = parsed.fragility;
    }
  }

  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.push('confidence requis, nombre 0..1');
  }

  const reviewNotes = Array.isArray(parsed.review_notes)
    ? parsed.review_notes.filter((n) => typeof n === 'string').slice(0, 20)
    : [];

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { name_fr: nameFr, description_fr: descFr, category, fragility, confidence, review_notes: reviewNotes },
  };
}

module.exports = {
  PROMPT_VERSION,
  ALLOWED_FRAGILITIES,
  buildSystemPrompt,
  buildUserMessage,
  validateOutput,
};
