/**
 * @module modal-view-model
 * @component Boutique / Modal ViewModel
 *
 * Responsibility:
 * - Translate a normalized Komerce product into a stable modal display contract.
 * - Centralize labels, badges, CSS classes and visibility flags used by the modal.
 * - Protect modal renderers and CSS from raw sourcing variability
 *   (Dubai / stock local / confection / CSV / WhatsApp / marketplace).
 *
 * Must not:
 * - Render HTML.
 * - Bind DOM events.
 * - Mutate cart/favorites state.
 * - Fetch products from network.
 * - Apply supplier-specific CSS or logic.
 *
 * Output contract — 7 contract CSS classes (cf. BOUTIQUE_SOURCE_OF_TRUTH.md §3B) :
 *   k-modal--has-promo
 *   k-modal--has-variants
 *   k-modal--has-delivery
 *   k-modal--stock-low
 *   k-modal--has-social-proof
 *   k-modal--has-specs
 *   k-modal--low-confidence
 *
 * Plus 3 classes additionnelles utiles :
 *   k-modal--no-price          (priceKmf null/0 → on cache la ligne prix)
 *   k-modal--stock-out         (stockStatus === 'unavailable')
 *   k-modal--fulfillment-*     (local | relay | preorder | custom)
 *
 * See:
 * - docs/BOUTIQUE_SOURCE_OF_TRUTH.md §3B (table classes contractuelles)
 * - docs/MODAL_DESKTOP_ARCHITECTURE.md §3.3 (champs normalisés)
 * - docs/BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md (modèle de référence)
 * - js/view-models/product-card-view-model.js (modèle calqué)
 */

import { sanitize, fmt, fmtPrice, optimizeImgUrl } from './b-utils.js';

'use strict';

// ─────────────────────────────────────────────────────────────
//  Constantes — fallbacks garantis
// ─────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_NAME = 'Produit Komerce';
const DEFAULT_IMAGE_URL = '/images/placeholder-product.png';
const DEFAULT_FULFILLMENT = 'relay';
const VALID_FULFILLMENTS = ['local', 'relay', 'preorder', 'custom'];
const VALID_STOCK_STATUS = ['available', 'low', 'unavailable'];
const LOW_CONFIDENCE_THRESHOLD = 40;
const MIN_PROMO_PCT = 5;     // sous ce seuil, on ignore la promo (bruit)
const MAX_PROMO_PCT = 95;    // au-dessus, c'est une erreur de saisie

// ─────────────────────────────────────────────────────────────
//  Helpers de normalisation — purs, sans side-effects
// ─────────────────────────────────────────────────────────────

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function normalizeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePromoPct(value) {
  const pct = normalizeNumberOrNull(value);
  if (pct === null) return null;
  if (pct < MIN_PROMO_PCT || pct >= MAX_PROMO_PCT) return null;
  return Math.round(pct);
}

function normalizeImages(product) {
  // Accepter plusieurs formats : product.images (string[] ou {url}[]),
  // product.image_url, product.imageUrl. Fallback garanti = 1 image.
  let raw = product.images;
  let list = [];

  if (Array.isArray(raw)) {
    list = raw.map(item => {
      if (!item) return '';
      if (typeof item === 'string') return item.trim();
      if (typeof item === 'object' && item.url) return String(item.url).trim();
      return '';
    }).filter(Boolean);
  }

  if (list.length === 0) {
    const single = normalizeString(product.image_url || product.imageUrl, '');
    if (single) list = [single];
  }

  if (list.length === 0) list = [DEFAULT_IMAGE_URL];
  return list;
}

function normalizeFulfillment(product) {
  const raw = normalizeString(
    product.fulfillment_type || product.fulfillmentType
      || product.source_type || product.sourceType,
    ''
  ).toLowerCase();

  // Mapping des valeurs Komerce internes vers le contrat modal
  if (raw === 'local_stock' || raw === 'local') return 'local';
  if (raw === 'preorder' || raw === 'backorder') return 'preorder';
  if (raw === 'custom_made' || raw === 'custom' || raw === 'confection') return 'custom';
  if (raw === 'dubai_sourcing' || raw === 'relay' || raw === 'standard') return 'relay';

  return DEFAULT_FULFILLMENT;
}

function normalizeStockStatus(product) {
  // 1. Statut explicite si fourni
  const explicit = normalizeString(
    product.stock_status || product.stockStatus || product.availability_status || product.availabilityStatus,
    ''
  ).toLowerCase();

  if (explicit === 'unavailable' || explicit === 'out_of_stock' || explicit === 'rupture') return 'unavailable';
  if (explicit === 'low' || explicit === 'low_stock') return 'low';
  if (explicit === 'available' || explicit === 'in_stock') return 'available';

  // 2. Sinon, dériver depuis la quantité numérique si dispo
  const qty = normalizeNumberOrNull(product.stock ?? product.stock_qty ?? product.stockQty);
  if (qty !== null) {
    if (qty <= 0) return 'unavailable';
    if (qty <= 10) return 'low';
    return 'available';
  }

  // 3. Fallback prudent : on suppose disponible
  return 'available';
}

function normalizeDeliveryEstimate(product) {
  // Accepter plusieurs champs et formes. Retourner string court ou null.
  const candidates = [
    product.delivery_estimate, product.deliveryEstimate,
    product.delivery_label, product.deliveryLabel,
    product.eta, product.etaLabel,
  ];
  for (const c of candidates) {
    const s = normalizeString(c, '');
    if (s) return s;
  }
  return null;
}

function normalizeVariants(product) {
  // Variantes : on accepte product.variants (array ou object). On renvoie array ou null.
  const raw = product.variants;
  if (!raw) {
    if (product.has_variants || product.hasVariants) {
      // Flag positif mais données pas encore chargées (lazy fetch)
      return [];
    }
    return null;
  }
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw : null;
  }
  if (typeof raw === 'object') {
    const keys = Object.keys(raw);
    return keys.length > 0 ? keys.map(k => ({ key: k, value: raw[k] })) : null;
  }
  return null;
}

function normalizeSpecs(product) {
  // specs[] : tableau de {label, value}. Accepter object aussi.
  const raw = product.specs || product.specifications;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map(s => {
        if (!s) return null;
        if (typeof s === 'string') return { label: '', value: s };
        return { label: normalizeString(s.label || s.key, ''), value: normalizeString(s.value, '') };
      })
      .filter(s => s && s.value);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof raw === 'object') {
    const list = Object.entries(raw)
      .map(([k, v]) => ({ label: normalizeString(k, ''), value: normalizeString(v, '') }))
      .filter(s => s.value);
    return list.length > 0 ? list : null;
  }
  return null;
}

function normalizeSocialProof(product) {
  // Règle dure : zéro chiffre inventé. On exige des données API réelles.
  const src = product.social_proof || product.socialProof;
  if (!src || typeof src !== 'object') return null;

  const sold = normalizeNumberOrNull(src.sold_count ?? src.soldCount ?? src.sold);
  const rating = normalizeNumberOrNull(src.rating);
  const reviews = normalizeNumberOrNull(src.reviews_count ?? src.reviewsCount ?? src.reviews);

  // Au moins un champ réel non nul/zéro pour activer le bloc
  const hasReal = (sold !== null && sold > 0)
               || (rating !== null && rating > 0)
               || (reviews !== null && reviews > 0);
  if (!hasReal) return null;

  return {
    sold: sold ?? null,
    rating: rating ?? null,
    reviews: reviews ?? null,
    soldLabel: sold > 0 ? `${sold} vendus` : '',
    ratingLabel: rating > 0 ? rating.toFixed(1) : '',
    reviewsLabel: reviews > 0 ? `${reviews} avis` : '',
  };
}

function inferDataQualityScore(product) {
  // Score explicite si fourni
  const explicit = product.data_quality_score ?? product.dataQualityScore;
  const explicitNum = normalizeNumberOrNull(explicit);
  if (explicitNum !== null) return Math.max(0, Math.min(100, explicitNum));

  // Sinon dériver depuis présence des champs (logique = ProductCard pour cohérence)
  let score = 0;
  if (normalizeString(product.name, '')) score += 25;
  if (normalizeNumberOrNull(product.price_kmf ?? product.priceKmf)) score += 25;
  const imgs = normalizeImages(product);
  if (imgs.length > 0 && imgs[0] !== DEFAULT_IMAGE_URL) score += 25;
  if (product.category || product.category_key || product.categoryKey) score += 15;
  if (normalizeString(product.description, '')) score += 10;
  return Math.min(score, 100);
}

// ─────────────────────────────────────────────────────────────
//  Construction des classes contractuelles
// ─────────────────────────────────────────────────────────────

function buildContractClasses(vm) {
  const classes = [];

  // Les 7 classes du doc source de vérité §3B
  if (vm.oldPriceKmf !== null && vm.oldPriceKmf > 0) classes.push('k-modal--has-promo');
  if (vm.variants !== null && vm.variants.length > 0) classes.push('k-modal--has-variants');
  if (vm.deliveryEstimate) classes.push('k-modal--has-delivery');
  if (vm.stockStatus === 'low') classes.push('k-modal--stock-low');
  if (vm.socialProof) classes.push('k-modal--has-social-proof');
  if (vm.specs && vm.specs.length > 0) classes.push('k-modal--has-specs');
  if (vm.dataQualityScore < LOW_CONFIDENCE_THRESHOLD) classes.push('k-modal--low-confidence');

  // Classes additionnelles utiles
  if (vm.priceKmf === null || vm.priceKmf === 0) classes.push('k-modal--no-price');
  if (vm.stockStatus === 'unavailable') classes.push('k-modal--stock-out');
  classes.push(`k-modal--fulfillment-${vm.fulfillmentType}`);

  return classes;
}

// ─────────────────────────────────────────────────────────────
//  Entrée publique
// ─────────────────────────────────────────────────────────────

/**
 * Construit le ViewModel modal à partir d'un produit Komerce brut.
 *
 * @param {Object} product - Produit catalogue (peut être incomplet/sale).
 * @param {Object} [options]
 * @param {number} [options.imageSize=800] - Largeur cible pour optimizeImgUrl.
 * @returns {Object} ViewModel stable avec champs garantis.
 */
export function buildModalViewModel(product = {}, options = {}) {
  const imageSize = options.imageSize || 800;

  // Champs de base avec fallbacks
  const id = product.id ?? null;
  const name = normalizeString(product.name, DEFAULT_PRODUCT_NAME);
  const description = normalizeString(product.description, '');
  const category = normalizeString(product.category, '');

  // Images : tableau garanti non vide
  const images = normalizeImages(product);
  const optimizedImages = images.map(url => optimizeImgUrl(url, imageSize));

  // Prix : peuvent être null si non communiqué
  const priceKmf = normalizeNumberOrNull(product.price_kmf ?? product.priceKmf);
  const promoPct = normalizePromoPct(product.promo_pct ?? product.promoPct);
  const oldPriceKmf = (promoPct !== null && priceKmf !== null && priceKmf > 0)
    ? Math.round(priceKmf / (1 - promoPct / 100))
    : null;

  // Statut / sourcing
  const fulfillmentType = normalizeFulfillment(product);
  const stockStatus = normalizeStockStatus(product);
  const deliveryEstimate = normalizeDeliveryEstimate(product);

  // Blocs riches
  const variants = normalizeVariants(product);
  const specs = normalizeSpecs(product);
  const socialProof = normalizeSocialProof(product);

  // Qualité de la donnée
  const dataQualityScore = inferDataQualityScore(product);

  // Construction de l'objet (avant calcul des classes — qui en dépendent)
  const vm = {
    // Identité
    id,
    raw: product,
    name,
    safeName: sanitize(name),
    description,
    safeDescription: sanitize(description),
    category,

    // Images
    images,
    optimizedImages,
    primaryImage: optimizedImages[0],
    imageAlt: sanitize(name),

    // Prix — labels prêts pour affichage direct
    priceKmf,
    priceLabel: priceKmf !== null && priceKmf > 0 ? fmtPrice(priceKmf) : 'Prix à confirmer',
    priceEurLabel: priceKmf !== null && priceKmf > 0 ? `≈ ${fmt(priceKmf, 'EUR')}` : '',
    oldPriceKmf,
    oldPriceLabel: oldPriceKmf !== null && oldPriceKmf > 0 ? fmtPrice(oldPriceKmf) : '',
    promoPct,
    promoLabel: promoPct !== null ? `-${promoPct}%` : '',

    // Statut produit
    fulfillmentType,
    stockStatus,
    stockLabel: buildStockLabel(stockStatus, product),
    deliveryEstimate,
    deliveryLabel: deliveryEstimate || fallbackDeliveryLabel(fulfillmentType),

    // Blocs conditionnels
    variants,             // null si pas de variantes, [] si lazy en cours, [...] si chargées
    specs,                // null si absent, [{label, value}] sinon
    socialProof,          // null sauf si données API réelles

    // Qualité de la donnée
    dataQualityScore,
    isLowConfidence: dataQualityScore < LOW_CONFIDENCE_THRESHOLD,
  };

  // Classes contractuelles posées sur .k-modal — calculées après le reste
  vm.cssClasses = buildContractClasses(vm);
  vm.cssClassName = vm.cssClasses.join(' ');

  return vm;
}

// ─────────────────────────────────────────────────────────────
//  Labels dérivés — petits helpers privés
// ─────────────────────────────────────────────────────────────

function buildStockLabel(stockStatus, product) {
  if (stockStatus === 'unavailable') return '✗ Rupture';
  if (stockStatus === 'low') {
    const qty = normalizeNumberOrNull(product.stock ?? product.stock_qty);
    if (qty !== null && qty > 0) return `🔥 Plus que ${qty} en stock`;
    return '🔥 Stock limité';
  }
  return '✓ Disponible';
}

function fallbackDeliveryLabel(fulfillmentType) {
  if (fulfillmentType === 'local') return 'Disponible immédiatement';
  if (fulfillmentType === 'preorder') return 'Sur précommande';
  if (fulfillmentType === 'custom') return 'Sur commande / confection';
  return 'Livraison point relais';
}

// ─────────────────────────────────────────────────────────────
//  Helper d'application sur le DOM (utilisé par b-modal-desktop-enhancers)
// ─────────────────────────────────────────────────────────────

/**
 * Pose les classes contractuelles du ViewModel sur l'élément .k-modal.
 * Retire les classes contractuelles qui ne sont plus actives (pour éviter
 * les rémanences d'un produit précédent).
 *
 * Idempotent — peut être appelé plusieurs fois sans effet de bord.
 *
 * @param {HTMLElement} modalEl - L'élément .k-modal.
 * @param {Object} viewModel - Sortie de buildModalViewModel().
 */
export function applyModalClasses(modalEl, viewModel) {
  if (!modalEl || !viewModel || !Array.isArray(viewModel.cssClasses)) return;

  // 1. Retirer toutes les classes contractuelles précédentes (préfixe k-modal--)
  //    pour repartir d'un état propre. On ne touche QUE les classes contrat.
  const toRemove = [];
  modalEl.classList.forEach(cls => {
    if (cls.startsWith('k-modal--')) toRemove.push(cls);
  });
  toRemove.forEach(cls => modalEl.classList.remove(cls));

  // 2. Poser les classes du ViewModel courant
  viewModel.cssClasses.forEach(cls => modalEl.classList.add(cls));
}

