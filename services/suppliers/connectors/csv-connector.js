/**
 * @komerce-arch
 * @role          csv-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       papaparse, services/suppliers/normalized-product.js, services/suppliers/connectors/_connector-utils.js
 * @used-by       routes/sourcing-scanner.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      DOCTRINE_INGESTION_CATALOGUE (ING-I1, ING-I2, ING-I3)
 * @impact-areas  catalog, product-discovery
 * @version       2026-07
 */

/**
 * KOMERCE — CSV Connector (ING-2)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Connecteur fonctionnel : parse un CSV brut en NormalizedSupplierProduct[]
 * ou en rejet motivé — jamais un troisième chemin (drop silencieux, défaut
 * inventé). Politique d'erreur unique (doctrine ING-2) : une valeur
 * inexploitable rejette la LIGNE avec sa raison.
 *
 * Parsing via papaparse (RFC-4180) : guillemets, virgules internes,
 * cellules multi-lignes, séparateur , ou ; auto-détecté — l'ancien
 * split() maison ne survivait à aucun de ces cas.
 *
 * Ce que ce connecteur ne fait JAMAIS (ING-I2) :
 *   - inventer une devise ("AED" par défaut) → ligne rejetée si absente
 *   - droper un champ numérique illisible → ligne rejetée avec raison
 *   - laisser passer une colonne inconnue sans trace → conservée dans
 *     raw_payload (brut intégral, ING-I3) ET remontée dans unmapped_columns
 *   - laisser un doublon SKU écraser silencieusement → rejeté, bruyamment
 *   - laisser un fichier aux en-têtes dupliqués s'importer → échec net
 */

'use strict';

const Papa = require('papaparse');
const { partitionValid } = require('../normalized-product');
const { parseStrictNumber, parseStrictInteger, parsePositiveDimension } = require('./_connector-utils');

// Mapping par défaut : alias -> nom canonique de NormalizedSupplierProduct
const DEFAULT_HEADER_ALIASES = {
  product_name:        ['name', 'product_name', 'titre', 'title', 'nom', 'product', 'designation'],
  supplier_category:   ['category', 'cat', 'categorie', 'catégorie', 'supplier_category', 'family', 'famille'],
  purchase_price:      ['price', 'cost', 'purchase_price', 'prix', 'prix_achat', 'unit_price'],
  currency:            ['currency', 'devise', 'cur'],
  image_url:           ['image', 'image_url', 'photo', 'img', 'picture'],
  product_url:         ['url', 'product_url', 'link', 'lien'],
  description:         ['description', 'desc', 'detail', 'details'],
  stock_available:     ['stock', 'qty', 'quantity', 'available', 'inventory'],
  min_order_qty:       ['moq', 'min_order', 'min_qty', 'minimum_order_quantity'],
  supplier_delay_days: ['delay', 'lead_time', 'delai', 'délai', 'lead_days'],
  weight_kg:           ['weight', 'poids', 'weight_kg', 'poids_kg'],
  dim_l_cm:            ['length', 'longueur', 'l', 'l_cm', 'len_cm'],
  dim_w_cm:            ['width', 'largeur', 'w', 'w_cm', 'wid_cm'],
  dim_h_cm:            ['height', 'hauteur', 'h', 'h_cm', 'hei_cm'],
  supplier_product_id: ['sku', 'ref', 'reference', 'product_id', 'supplier_product_id'],
};

const NUMERIC_FIELDS = new Set(['purchase_price', 'weight_kg', 'dim_l_cm', 'dim_w_cm', 'dim_h_cm']);
const INTEGER_FIELDS = new Set(['stock_available', 'min_order_qty', 'supplier_delay_days']);
const DIMENSION_FIELDS = new Set(['dim_l_cm', 'dim_w_cm', 'dim_h_cm']);

/**
 * Résout, pour chaque champ cible, l'indice de colonne CSV correspondant.
 * Lève si des en-têtes sont dupliqués (import refusé en bloc — ING-2).
 *
 * @param {string[]} headersLower
 * @param {string[]} headersOriginal
 * @param {Object} [customMapping]
 * @returns {{ headerIndex: Object<string, number>, unmappedColumns: string[] }}
 */
function resolveHeaderIndex(headersLower, headersOriginal, customMapping) {
  const seen = new Map();
  for (const h of headersLower) {
    if (!h) continue;
    seen.set(h, (seen.get(h) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([h]) => h);
  if (dupes.length) {
    throw new Error(
      `en-têtes dupliqués dans le CSV : ${dupes.join(', ')} — import refusé (colonnes ambiguës).`
    );
  }

  const headerIndex = {};
  Object.keys(DEFAULT_HEADER_ALIASES).forEach(field => {
    const candidates = (customMapping && customMapping[field])
      ? [customMapping[field].toLowerCase()]
      : DEFAULT_HEADER_ALIASES[field];
    for (const c of candidates) {
      const idx = headersLower.indexOf(c);
      if (idx !== -1) {
        headerIndex[field] = idx;
        break;
      }
    }
  });

  const mappedIdx = new Set(Object.values(headerIndex));
  const unmappedColumns = headersOriginal.filter((h, idx) => h && !mappedIdx.has(idx));

  return { headerIndex, unmappedColumns };
}

/**
 * Parse un texte CSV en lignes STRUCTURELLEMENT valides + lignes rejetées.
 * C'est ici (pas dans rowsToNormalized) que vivent les rejets ING-2 :
 * ligne malformée, champ numérique illisible, devise absente, SKU dupliqué.
 *
 * @param {string} csvText
 * @param {Object} [customMapping]
 * @returns {{ rows: Array<Object>, invalid: Array<{product: Object, errors: string[]}>, unmappedColumns: string[] }}
 */
function parseCSVRows(csvText, customMapping) {
  if (!csvText || typeof csvText !== 'string') {
    return { rows: [], invalid: [], unmappedColumns: [] };
  }

  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  const data = parsed.data || [];
  if (data.length < 2) return { rows: [], invalid: [], unmappedColumns: [] };

  const headersOriginal = data[0].map(h => (h || '').trim());
  const headersLower = headersOriginal.map(h => h.toLowerCase());
  const { headerIndex, unmappedColumns } = resolveHeaderIndex(headersLower, headersOriginal, customMapping);

  const rows = [];
  const invalid = [];
  const seenSkus = new Set();

  for (let i = 1; i < data.length; i++) {
    const cells = data[i];

    // ── Ligne malformée : nombre de colonnes ≠ en-têtes (ING-2) ──
    if (cells.length !== headersOriginal.length) {
      invalid.push({
        product: {
          raw_payload: Object.fromEntries(cells.map((v, idx) => [headersOriginal[idx] || `col_${idx}`, v])),
        },
        errors: [`ligne malformée : ${cells.length} colonne(s) pour ${headersOriginal.length} en-tête(s)`],
      });
      continue;
    }

    // Brut intégral (ING-I3) : TOUTES les colonnes, y compris non mappées.
    const rawPayloadFull = {};
    headersOriginal.forEach((h, idx) => { rawPayloadFull[h || `col_${idx}`] = cells[idx]; });

    const rowErrors = [];
    const typed = {};

    Object.keys(headerIndex).forEach(field => {
      const raw = cells[headerIndex[field]];
      const v = (raw == null ? '' : String(raw)).trim();
      if (v === '') return; // absent : légitime, pas une erreur en soi

      if (NUMERIC_FIELDS.has(field)) {
        const r = DIMENSION_FIELDS.has(field) ? parsePositiveDimension(v) : parseStrictNumber(v);
        if (r.invalid) rowErrors.push(`${field} non numérique : "${v}"`);
        else if (r.value !== undefined) typed[field] = r.value;
      } else if (INTEGER_FIELDS.has(field)) {
        const r = parseStrictInteger(v);
        if (r.invalid) rowErrors.push(`${field} non entier : "${v}"`);
        else if (r.value !== undefined) typed[field] = r.value;
      } else {
        typed[field] = v;
      }
    });

    // Pas de ligne exploitable sans nom produit.
    if (!typed.product_name) continue;

    // ING-2 : devise absente → rejet motivé, jamais un défaut inventé.
    if (!typed.currency) {
      rowErrors.push('devise absente — colonne currency requise ou csv_mapping.currency');
    }

    if (rowErrors.length) {
      invalid.push({
        product: { product_name: typed.product_name || null, raw_payload: rawPayloadFull },
        errors: rowErrors,
      });
      continue;
    }

    // Dédup SKU intra-fichier (ING-2) : la première ligne gagne, mais bruyamment.
    const sku = typed.supplier_product_id;
    if (sku) {
      if (seenSkus.has(sku)) {
        invalid.push({
          product: { product_name: typed.product_name, supplier_product_id: sku, raw_payload: rawPayloadFull },
          errors: [`duplicate_sku_in_file : "${sku}" déjà vu dans ce fichier — ligne ignorée`],
        });
        continue;
      }
      seenSkus.add(sku);
    }

    typed.raw_payload = rawPayloadFull;
    rows.push(typed);
  }

  return { rows, invalid, unmappedColumns };
}

/**
 * Convertit les lignes structurellement valides en NormalizedSupplierProduct[].
 * Regroupe les dimensions dans un sous-objet. raw_payload voyage tel quel
 * (déjà posé par parseCSVRows — le brut intégral, pas seulement les colonnes
 * mappées).
 *
 * @param {Array<Object>} rows
 * @param {string} supplierName
 * @returns {Array<NormalizedSupplierProduct>}
 */
function rowsToNormalized(rows, supplierName) {
  return (rows || []).map(row => {
    const dimensions = {};
    if (row.dim_l_cm != null) dimensions.l_cm = row.dim_l_cm;
    if (row.dim_w_cm != null) dimensions.w_cm = row.dim_w_cm;
    if (row.dim_h_cm != null) dimensions.h_cm = row.dim_h_cm;
    return {
      supplier_name: supplierName,
      supplier_product_id: row.supplier_product_id || null,
      product_name: row.product_name,
      supplier_category: row.supplier_category || null,
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      currency: (row.currency || '').toUpperCase() || null,
      image_url: row.image_url || null,
      product_url: row.product_url || null,
      description: row.description || null,
      stock_available: row.stock_available != null ? Number(row.stock_available) : null,
      min_order_qty: row.min_order_qty != null ? Number(row.min_order_qty) : null,
      supplier_delay_days: row.supplier_delay_days != null ? Number(row.supplier_delay_days) : null,
      weight_kg: row.weight_kg != null ? Number(row.weight_kg) : null,
      dimensions: Object.keys(dimensions).length ? dimensions : null,
      raw_payload: row.raw_payload ? { ...row.raw_payload } : { ...row },
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// API CONNECTEUR (interface attendue par les routes)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Méthode principale : transforme un input CSV en NormalizedSupplierProduct[].
 *
 * @param {Object} input
 * @param {string} input.csv_text
 * @param {string} input.supplier_name
 * @param {Object} [input.csv_mapping]
 *
 * @returns {{ products, invalid, total, unmapped_columns }}
 */
function fetchProducts(input) {
  const supplierName = (input?.supplier_name || '').trim();
  const csvText = input?.csv_text || '';
  if (!supplierName) throw new Error('supplier_name requis');
  if (!csvText) throw new Error('csv_text requis');

  // en-têtes dupliqués → l'import entier échoue (pas une ligne, le fichier).
  const { rows, invalid: structuralInvalid, unmappedColumns } = parseCSVRows(csvText, input.csv_mapping);

  const normalized = rowsToNormalized(rows, supplierName);
  const { valid, invalid: schemaInvalid } = partitionValid(normalized);

  return {
    products: valid,
    invalid: [...structuralInvalid, ...schemaInvalid],
    total: valid.length + structuralInvalid.length + schemaInvalid.length,
    unmapped_columns: unmappedColumns,
  };
}

module.exports = {
  fetchProducts,
  // Helpers exposés pour tests et usages avancés
  parseCSVRows,
  rowsToNormalized,
  DEFAULT_HEADER_ALIASES,
};
