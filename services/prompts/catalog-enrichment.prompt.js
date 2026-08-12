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
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Prompt d'enrichissement FR (K-3, DOCTRINE_CATALOGUE.md §4 et §8)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * §8 : "le prompt est du code" — il vit ici, dans le dépôt, versionné.
 * Un changement de prompt = PROMPT_VERSION incrémenté = les gates.
 * products.enrichment_version enregistre quelle version a produit chaque
 * fiche : c'est ce qui permet le re-raffinage en masse ciblé (§5).
 *
 * Le module possède aussi le CONTRAT DE SORTIE (validateOutput) : le schéma,
 * la qualité éditoriale minimale et leur validation changent ensemble.
 */

const PROMPT_VERSION = 2;
const CLIENT_TITLE_MAX_LENGTH = 80;
const CLIENT_DESCRIPTION_MIN_LENGTH = 20;

// Valeurs conseillées de products.fragility (migration 096, DOCTRINE_NON_CONFORMITE §3).
const ALLOWED_FRAGILITIES = ['fragile', 'electronique', 'sensible_chaleur', 'sensible_humidite'];

const SOURCE_FILE_PATTERN = /(?:^|\s)file\s*:|\.(?:jpe?g|png|webp|gif|tiff?)(?:\s|$)/i;
const URL_PATTERN = /https?:\/\/|www\./i;
const SOURCE_META_PATTERN = /\b(?:wikimedia|commons|uploaded|upload|image id|photo id|archive id)\b/i;

function editorialOutputErrors({ nameFr, descFr }) {
  const errors = [];
  const title = String(nameFr || '').replace(/\s+/g, ' ').trim();
  const description = String(descFr || '').replace(/\s+/g, ' ').trim();

  if (title.length > CLIENT_TITLE_MAX_LENGTH) {
    errors.push(`name_fr trop long : maximum éditorial ${CLIENT_TITLE_MAX_LENGTH} caractères`);
  }
  if (URL_PATTERN.test(title) || SOURCE_FILE_PATTERN.test(title) || SOURCE_META_PATTERN.test(title)) {
    errors.push('name_fr contient du bruit de source (URL, fichier ou métadonnée)');
  }
  const acronymTokens = title.match(/\b[A-Z][A-Z0-9]{1,8}\b/g) || [];
  if (acronymTokens.length >= 4) {
    errors.push('name_fr ressemble à une suite de codes/métadonnées');
  }
  if (title.split(/\s+/).filter(Boolean).length > 14) {
    errors.push('name_fr trop verbeux pour un titre catalogue');
  }

  if (description.length < CLIENT_DESCRIPTION_MIN_LENGTH) {
    errors.push(`description_fr trop courte : minimum éditorial ${CLIENT_DESCRIPTION_MIN_LENGTH} caractères`);
  }
  if (URL_PATTERN.test(description) || SOURCE_FILE_PATTERN.test(description) || SOURCE_META_PATTERN.test(description)) {
    errors.push('description_fr contient du bruit de source (URL, fichier ou métadonnée)');
  }

  return errors;
}

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
    'On te donne la donnée SOURCE ORIGINALE d’un fournisseur ou d’un catalogue externe.',
    'Tu produis la fiche CLIENT en FRANÇAIS. Ce n’est jamais une traduction littérale ni une copie des métadonnées source.',
    '',
    'Règles éditoriales obligatoires :',
    `- Titre français court (maximum ${CLIENT_TITLE_MAX_LENGTH} caractères), qui nomme clairement L’OBJET VENDU.`,
    '- Conserve uniquement les marques, références ou termes étrangers indispensables à identifier réellement le produit.',
    '- Supprime du contenu client les noms de fichiers, crédits photo, noms d’uploader, institutions, dates d’archive, identifiants techniques de la source et URLs.',
    '- Si le titre source mélange codes, noms propres, langues ou informations éditoriales, n’en reprends que les faits nécessaires pour identifier le produit.',
    '- N’invente AUCUNE caractéristique absente de la donnée source. En cas d’ambiguïté, baisse confidence et explique-la dans review_notes.',
    `- Description française d’au moins ${CLIENT_DESCRIPTION_MIN_LENGTH} caractères, naturelle et utile au client ; jamais une recopie brute de la source.`,
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
    '  "name_fr": "titre client court en français",',
    '  "description_fr": "description client française adaptée",',
    '  "category": "une catégorie autorisée, ou null si aucune ne convient",',
    `  "fragility": "un tag parmi ${ALLOWED_FRAGILITIES.join(' | ')}, ou null",`,
    '  "confidence": 0.0 à 1.0 — confiance dans la fidélité et la qualité de la fiche produite,',
    '  "review_notes": ["passages douteux ou ambigus de la source, en FR", ...] (vide si rien)',
    '}',
    'Baisse confidence si la source est ambiguë, incomplète, bruitée ou si l’objet vendu n’est pas suffisamment certain.',
  ].join('\n');
}

// ── Message utilisateur ───────────────────────────────────────────────────────

/**
 * @param {{ name_source:string, description_source:?string, source_locale:?string,
 *           supplier_category:?string, current_category:?string,
 *           current_subcategory:?string }} source
 * @returns {string}
 */
function buildUserMessage(source) {
  return JSON.stringify({
    name_source: source.name_source,
    description_source: source.description_source || null,
    source_locale: source.source_locale || 'en',
    supplier_category: source.supplier_category || null,
    current_category: source.current_category || null,
    current_subcategory: source.current_subcategory || null,
  });
}

// ── Contrat de sortie ─────────────────────────────────────────────────────────

/**
 * Valide la sortie du modèle contre le schéma ET les invariants éditoriaux.
 * Tout champ hors contrat ou présentation impropre = rejet ('invalid_output'
 * côté service, rien n'est appliqué).
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

  const nameFr = typeof parsed.name_fr === 'string' ? parsed.name_fr.replace(/\s+/g, ' ').trim() : '';
  if (!nameFr) errors.push('name_fr requis');
  else errors.push(...editorialOutputErrors({ nameFr, descFr: parsed.description_fr }));

  const descFr = typeof parsed.description_fr === 'string' ? parsed.description_fr.replace(/\s+/g, ' ').trim() : '';
  if (!descFr || descFr.length > 4000) errors.push('description_fr requis, 1..4000 caractères');

  // Si name_fr était vide, editorialOutputErrors n'a pas encore pu valider la
  // description. On applique tout de même ses règles de description.
  if (!nameFr && descFr) errors.push(...editorialOutputErrors({ nameFr: 'Produit', descFr }).filter((e) => e.startsWith('description_fr')));

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

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    value: { name_fr: nameFr, description_fr: descFr, category, fragility, confidence, review_notes: reviewNotes },
  };
}

module.exports = {
  PROMPT_VERSION,
  CLIENT_TITLE_MAX_LENGTH,
  CLIENT_DESCRIPTION_MIN_LENGTH,
  ALLOWED_FRAGILITIES,
  editorialOutputErrors,
  buildSystemPrompt,
  buildUserMessage,
  validateOutput,
};
