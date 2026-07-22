/**
 * @komerce-arch
 * @role          mobile-product-modal-renderer
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state
 * @outputs       mobile_product_modal_dom
 * @depends       b-store.js, b-utils.js, b-modal-product.js, b-modal-image-ux.js, view-models/modal-selection-model.js
 * @used-by       b-modal-product-detail-bootstrap.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, sku-selection, delivery-options, media-carousel
 * @version       2026-07 — MDM canonical rewrite
 *
 * Composition canonique mobile v3 :
 *
 *   TOPBAR (sticky, existing shell)
 *   MEDIA (image carousel, promo badge, voir en grand, favori overlay)
 *   IDENTITY COMPACT (name 1-line + ref inline | price + old_price + stock pill + promo tag)
 *   OPTIONS (axes from option_axes[], thumbnails if available)
 *   INFO STRIP (dispo chip + delivery_options[] chips — single horizontal row)
 *   ── fold ──
 *   DESCRIPTION, POINTS FORTS, CARACTÉRISTIQUES, COMPOSITION, ENTRETIEN,
 *   À SAVOIR, SECTIONS ÉDITORIALES COMPLÉMENTAIRES — voir renderBelowFold()
 *   pour l'ordre exact ; contenu piloté par content.* (Lot Content, commit 4)
 *   STICKY CTA BAR (qty + panier + acheter — existing shell actions)
 *
 * renderBelowFold() délègue tri/filtrage/regroupement/"lire la suite" à
 * view-models/product-content-model.js — ce fichier ne possède que le DOM.
 *
 * Removed from mobile composition (MDM-8):
 * - renderSubtotal() → price + qty suffice on product sheet
 * - renderPaymentSection() → belongs to purchase flow, not product sheet
 * - hardcoded reassurance blocks
 *
 * The modal selects and renders. It never reconstructs stock, invents a SKU
 * combination, hardcodes delivery labels, or becomes a mini-checkout.
 */

'use strict';

import { state, dom } from './b-store.js';
import { fmtPrice, optimizeImgUrl } from './b-utils.js';
import {
  OPTION_STATE,
  selectModalOption,
} from './view-models/modal-selection-model.js';
import { buildCarouselSlides, goToSlide } from './b-modal-product.js';
import { setupImageUX } from './b-modal-image-ux.js';
import { wireBuyNowButton } from './b-modal-buybox-shared.js';
import { paintDetailFields } from './b-modal-product-fields.js';
import {
  buildProductContentViewModel,
  shouldOfferReadMore,
  CONTENT_LABELS,
} from './view-models/product-content-model.js';

/* ── helpers ──────────────────────────────────────────────────── */

function isMobileViewport() {
  return window.matchMedia('(max-width: 899px)').matches;
}

function isPhotoAxis(axis) {
  return /couleur|color|coloris|teinte/i.test(axis.key || axis.display_name || '');
}

function activeUnit(detail, selection) {
  return (detail.sellable_units || []).find(
    (unit) => unit.sku_id === selection.selected_sku_id
  ) || null;
}

function mediaSignature(selection) {
  return (selection.selected_media || [])
    .map((media) => `${media.id}:${media.url}`)
    .join('|');
}

function optionMessage(optionState) {
  if (optionState === OPTION_STATE.OUT_OF_STOCK) return 'Rupture';
  if (optionState === OPTION_STATE.INCOMPATIBLE) return 'Non proposé';
  return '';
}

/* ── MDM-2 : Media ────────────────────────────────────────────── */

function renderMedia(detail, selection, force = false) {
  const signature = mediaSignature(selection);
  if (!force && state.modalMediaSignature === signature) return;
  state.modalMediaSignature = signature;

  const media =
    selection.selected_media && selection.selected_media.length
      ? selection.selected_media
      : detail.media || [];

  buildCarouselSlides({
    name: detail.product.name,
    images: media.map((item) => item.url),
    image_url: media[0]?.url || '',
  });
  goToSlide(0);
  setupImageUX();
}

/* ── MDM-3 : Identity compact ─────────────────────────────────── */

/**
 * M1 — Badge stock à droite du prix (spec mobile §5.5).
 * Trois états dérivés uniquement de `unit.available_quantity` (contrat
 * product_detail_v1, sellable_units[]) : jamais de donnée inventée.
 * Sans unité résolue (ex. sélection incomplète), le pill reste masqué —
 * aucune valeur de repli fictive.
 */
function renderStockPill(unit) {
  const row = dom.modalPrice?.closest('.k-modal-price-row') || dom.modal?.querySelector('.k-modal-price-row');
  if (!row) return;

  const qty = unit?.available_quantity;
  let pill = row.querySelector('#k-modal-stock-pill');

  if (qty == null || Number.isNaN(qty)) {
    if (pill) pill.hidden = true;
    return;
  }

  if (!pill) {
    pill = document.createElement('span');
    pill.id = 'k-modal-stock-pill';
    pill.innerHTML =
      '<span class="k-mdm-stock-pill-dot"></span>' +
      '<span class="k-mdm-stock-pill-label"></span>';
    row.appendChild(pill);
  }

  let variant = 'ok';
  let label = 'En stock';
  if (qty === 0) {
    variant = 'out';
    label = 'Épuisé';
  } else if (qty <= 5) {
    variant = 'low';
    label = `Plus que ${qty}`;
  }

  pill.hidden = false;
  pill.className = `k-mdm-stock-pill k-mdm-stock-pill--${variant}`;
  pill.querySelector('.k-mdm-stock-pill-label').textContent = label;
}

// Chantier déduplication (§3) : name/sku/price/old-price/cat/promo-badge
// sont peints par paintDetailFields() (owner unique, b-modal-product-fields.js
// — même code que desktop, vérifié ligne à ligne avant convergence). Ne
// reste ici que ce qui diverge réellement du desktop : le pill de stock
// (DOM différent de renderStock desktop) et l'effacement de la description
// (déplacée sous le fold, MDM-7 — le desktop l'affiche, le mobile la vide).
function renderIdentity(detail, selection) {
  paintDetailFields(detail, selection);

  // Stock pill — right of price (M1, spec §5.5). Reuses available_quantity
  // from the active SKU unit ; never reconstructed.
  const unit = activeUnit(detail, selection);
  renderStockPill(unit);

  // Description — moved below fold (MDM-7). Clear the legacy inline desc
  // so it doesn't compete with the transactional core.
  if (dom.modalDesc) {
    dom.modalDesc.textContent = '';
    dom.modalDesc.classList.add('u-hidden');
  }
}

/* ── MDM-4 : Options SKU + availability ──────────────────────── */

function renderAxis(detail, selection, axis, onSelectionChanged) {
  const group = document.createElement('section');
  group.className = 'k-vg';
  group.dataset.axisKey = axis.key;

  const label = document.createElement('div');
  label.className = 'k-vg-label';
  const selected = selection.selected_options[axis.key] || '';
  label.innerHTML =
    '<span class="k-vg-label-type"></span>' +
    '<span class="k-vg-label-sep">·</span>' +
    '<span class="k-vg-label-val"></span>';
  label.querySelector('.k-vg-label-type').textContent = axis.display_name;
  label.querySelector('.k-vg-label-val').textContent = selected || 'Choisir';
  group.appendChild(label);

  const photo = isPhotoAxis(axis);
  const wrap = document.createElement('div');
  wrap.className = photo ? 'k-vg-skus' : 'k-vg-sizes';

  const states = new Map(
    (selection.option_states[axis.key] || []).map((entry) => [
      entry.value,
      entry.state,
    ])
  );

  axis.values.forEach((option) => {
    const stateValue = states.get(option.value) || OPTION_STATE.INCOMPATIBLE;
    const active = selected === option.value;
    const unavailable = stateValue !== OPTION_STATE.AVAILABLE;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.optionValue = option.value;
    button.dataset.optionState = stateValue;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      `${axis.display_name} ${option.value}${
        unavailable ? ` — ${optionMessage(stateValue)}` : ''
      }`
    );

    if (photo && option.thumbnail_url) {
      button.className = `k-sku${active ? ' k-sku--active' : ''}${
        unavailable ? ' k-vp--out' : ''
      }`;
      const image = document.createElement('img');
      image.src = optimizeImgUrl(option.thumbnail_url, 140);
      image.alt = '';
      image.loading = 'lazy';
      const name = document.createElement('span');
      name.className = 'k-sku-name';
      name.textContent = option.value;
      button.appendChild(image);
      button.appendChild(name);
    } else {
      button.className = `k-vp${active ? ' k-vp--active' : ''}${
        unavailable ? ' k-vp--out' : ''
      }`;
      button.textContent = option.value;
    }

    button.addEventListener('click', () => {
      state.modalSelection = selectModalOption(
        detail,
        state.modalSelection,
        axis.key,
        option.value
      );
      onSelectionChanged();
    });

    wrap.appendChild(button);
  });

  group.appendChild(wrap);
  return group;
}

function renderSelectionMessage(root, selection) {
  const message = document.createElement('div');
  message.id = 'k-modal-selection-message';
  message.className = 'k-mdm-selection-msg';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = selection.selection_message || '';
  message.hidden = !selection.selection_message;
  root.appendChild(message);
}

/* ── MDM-5 : Info strip (dispo + delivery chips) ──────────────── */

function renderInfoStrip(detail, selection, root) {
  const strip = document.createElement('div');
  strip.className = 'k-mdm-info-strip';
  strip.dataset.infoStrip = '1';

  // Availability chip — only when selection is supported
  if (selection.selection_supported) {
    const availChip = document.createElement('span');
    if (selection.selected_sku_id) {
      availChip.className = 'k-mdm-chip k-mdm-chip--ok';
      availChip.textContent = '✓ Disponible';
    } else {
      const hasSelections =
        Object.keys(selection.selected_options).length > 0;
      availChip.className = 'k-mdm-chip';
      availChip.textContent = hasSelections
        ? 'Choisissez la suite'
        : 'Choisissez vos options';
    }
    strip.appendChild(availChip);
  }

  // Delivery chips — exclusively from detail.delivery_options[]
  // Never hardcoded. Zero chips if array is empty.
  const options = detail?.delivery_options || [];
  options.forEach((option) => {
    const chip = document.createElement('span');
    const isAir = typeof option.code === 'string' && option.code.startsWith('AIR_');
    chip.className = `k-mdm-chip k-mdm-chip--delivery${isAir ? ' k-mdm-chip--air' : ''}`;
    const icon = isAir ? '✈️' : '📦';
    chip.textContent = `${icon} ${option.label}`;

    // Append meta (price, ETA) if provided by contract
    const meta = [];
    if (option.price_kmf != null) meta.push(fmtPrice(option.price_kmf));
    if (option.eta_label) meta.push(option.eta_label);
    if (meta.length > 0) {
      const metaSpan = document.createElement('span');
      metaSpan.className = 'k-mdm-chip-meta';
      metaSpan.textContent = ` · ${meta.join(' · ')}`;
      chip.appendChild(metaSpan);
    }

    strip.appendChild(chip);
  });

  // Fallback: no delivery options at all
  if (options.length === 0) {
    const fallback = document.createElement('span');
    fallback.className = 'k-mdm-chip k-mdm-chip--delivery';
    fallback.textContent = '📦 Livraison communiquée à la commande';
    strip.appendChild(fallback);
  }

  root.appendChild(strip);
}

/* ── MDM-6 : Actions state (CTA enable/disable) ──────────────── */

function renderActions(detail, selection) {
  const isSku = detail.inventory_model === 'SKU';
  const enabled = !isSku || Boolean(selection.selected_sku_id);
  [dom.addCartBtn, document.getElementById('k-buy-now-btn')].forEach(
    (button) => {
      if (!button) return;
      button.disabled = !enabled;
      if (!enabled)
        button.setAttribute('aria-describedby', 'k-modal-selection-message');
      else button.removeAttribute('aria-describedby');
    }
  );

  // Stepper: disabled for SKU products (product-id-first mutation is invalid
  // for SKU inventory — see PDC-6 doctrine note)
  [dom.qtyMinus, dom.qtyPlus].forEach((control) => {
    if (!control) return;
    control.disabled = isSku;
  });

  wireBuyNowButton(document.getElementById('k-buy-now-btn'));
}

/* ── MDM-7 : Below-fold enriched content ─────────────────────── */

/**
 * Section générique "texte replié" — utilisée par la description longue et
 * par toute section éditoriale de type TEXT. Le bouton "Lire la suite"
 * n'est posé que si offerReadMore est vrai (contenu réellement masqué par
 * le clamp visuel) — jamais un bouton systématique (règle UX mobile).
 */
function appendTextSection(root, { heading, text, offerReadMore }) {
  const section = document.createElement('section');
  section.className = 'k-mdm-desc-section k-mdm-content-section';

  const headingEl = document.createElement('h4');
  headingEl.className = 'k-mdm-section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  const textEl = document.createElement('div');
  textEl.className = offerReadMore ? 'k-mdm-desc-text' : 'k-mdm-desc-text k-mdm-desc-text--expanded';
  textEl.textContent = text;
  section.appendChild(textEl);

  if (offerReadMore) {
    const readMore = document.createElement('button');
    readMore.className = 'k-mdm-read-more';
    readMore.type = 'button';
    readMore.textContent = 'Lire la suite';
    readMore.addEventListener('click', () => {
      const expanded = textEl.classList.toggle('k-mdm-desc-text--expanded');
      readMore.textContent = expanded ? 'Réduire' : 'Lire la suite';
    });
    section.appendChild(readMore);
  }

  root.appendChild(section);
}

/** Section liste à puces compacte — points forts, composition, entretien, avertissements. */
function appendBulletSection(root, { heading, items, variant }) {
  if (!items.length) return;
  const section = document.createElement('section');
  section.className = `k-mdm-content-section k-mdm-content-section--${variant}`;

  const headingEl = document.createElement('h4');
  headingEl.className = 'k-mdm-section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  const list = document.createElement('ul');
  list.className = 'k-mdm-bullet-list';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  section.appendChild(list);
  root.appendChild(section);
}

/** Caractéristiques : liste clé/valeur, regroupée par group_key quand fourni. */
function appendSpecificationsSection(root, specificationGroups) {
  if (!specificationGroups.length) return;
  const section = document.createElement('section');
  section.className = 'k-mdm-content-section k-mdm-content-section--specs';

  const headingEl = document.createElement('h4');
  headingEl.className = 'k-mdm-section-heading';
  headingEl.textContent = CONTENT_LABELS.specifications;
  section.appendChild(headingEl);

  specificationGroups.forEach((group) => {
    if (group.group) {
      const groupHeading = document.createElement('div');
      groupHeading.className = 'k-mdm-spec-group-label';
      groupHeading.textContent = group.group;
      section.appendChild(groupHeading);
    }

    const dl = document.createElement('dl');
    dl.className = 'k-mdm-spec-list';
    group.items.forEach((item) => {
      const dt = document.createElement('dt');
      dt.textContent = item.label;
      const dd = document.createElement('dd');
      dd.textContent = item.unit ? `${item.value} ${item.unit}` : item.value;
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    section.appendChild(dl);
  });

  root.appendChild(section);
}

/** Sections éditoriales complémentaires — TEXT/BULLETS/KEY_VALUE, déjà ordonnées et filtrées par le view-model. */
function appendEditorialSections(root, sections) {
  sections.forEach((section) => {
    if (section.type === 'TEXT') {
      appendTextSection(root, {
        heading: section.title,
        text: section.text,
        offerReadMore: section.offer_read_more,
      });
      return;
    }

    if (section.type === 'BULLETS') {
      appendBulletSection(root, { heading: section.title, items: section.items, variant: 'editorial' });
      return;
    }

    if (section.type === 'KEY_VALUE') {
      const wrapper = document.createElement('section');
      wrapper.className = 'k-mdm-content-section k-mdm-content-section--specs';
      const headingEl = document.createElement('h4');
      headingEl.className = 'k-mdm-section-heading';
      headingEl.textContent = section.title;
      wrapper.appendChild(headingEl);

      const dl = document.createElement('dl');
      dl.className = 'k-mdm-spec-list';
      section.entries.forEach((entry) => {
        const dt = document.createElement('dt');
        dt.textContent = entry.label;
        const dd = document.createElement('dd');
        dd.textContent = entry.value;
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      wrapper.appendChild(dl);
      root.appendChild(wrapper);
    }
  });
}

/**
 * Rend le contenu enrichi sous le fold, dans l'ordre canonique : description,
 * points forts, caractéristiques, composition, entretien, avertissements,
 * sections éditoriales complémentaires. Une collection vide ne rend rien —
 * aucune coquille vide, aucun titre orphelin (règle MDM-9 : produit simple →
 * seule la description s'affiche).
 */
function renderBelowFold(detail, root) {
  const fold = document.createElement('hr');
  fold.className = 'k-mdm-fold';
  root.appendChild(fold);

  const vm = buildProductContentViewModel(detail.content);

  // Description longue — priorité au texte produit historique ; le chapeau
  // éditorial (content.short_description), quand distinct, l'introduit sans
  // jamais dupliquer le même texte deux fois.
  const description = detail.product.description || '';
  if (description) {
    const lead =
      vm.shortDescription && vm.shortDescription !== description ? `${vm.shortDescription}\n\n` : '';
    appendTextSection(root, {
      heading: 'Description',
      text: `${lead}${description}`,
      offerReadMore: shouldOfferReadMore(`${lead}${description}`),
    });
  }

  appendBulletSection(root, { heading: CONTENT_LABELS.highlights, items: vm.highlights.map((h) => h.label), variant: 'highlights' });
  appendSpecificationsSection(root, vm.specificationGroups);
  appendBulletSection(root, { heading: CONTENT_LABELS.materials, items: vm.materials, variant: 'materials' });
  appendBulletSection(root, { heading: CONTENT_LABELS.care, items: vm.care, variant: 'care' });
  appendBulletSection(root, { heading: CONTENT_LABELS.warnings, items: vm.warnings, variant: 'warnings' });
  appendEditorialSections(root, vm.sections);
}

/* ── Main render ──────────────────────────────────────────────── */

/**
 * Renders the canonical mobile product composition (v3) from the product
 * detail contract and the shared selection state.
 *
 * Composition order:
 *   1. Options (axes) — rendered into #k-modal-variants container
 *   2. Selection message
 *   3. Info strip (availability + delivery chips)
 *   4. Below-fold content (description)
 *   5. Identity (name, ref, price) — rendered into existing shell DOM
 *   6. Actions state — rendered into existing shell CTA bar
 *   7. Media — rendered into existing carousel
 *
 * Steps 5-7 target existing shell elements (dom.*) rather than the
 * variants container, maintaining compatibility with the shell layout.
 */
export function renderMobileProductDetail(
  detail,
  selection,
  { forceMedia = false } = {}
) {
  const container =
    dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || !isMobileViewport()) return;

  state.modalProductDetail = detail;
  state.modalSelection = selection;
  // Compatibility: backend SKU resolves from variant_combo
  state.modalVariantCombo = selection.selection_supported
    ? { ...selection.selected_options }
    : {};

  function rerender() {
    renderMobileProductDetail(detail, state.modalSelection);
  }

  // MDM-8: Remove any legacy hardcoded reassurance injected by core
  dom.modal?.querySelector('[data-mobile-reassurance]')?.remove();

  // P3-fix : classe CSS pour réduire le hero quand le produit a des variantes
  if (dom.modal) {
    dom.modal.classList.toggle('k-modal--has-variants', Boolean(selection.selection_supported));
  }

  // OPT : injecter les boutons overlay sur le hero (topbar masquée sur mobile)
  _ensureHeroOverlay();

  // Clear and rebuild the variants container
  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdc4Root = '1';
  root.className = 'k-mdm-root';
  container.appendChild(root);

  // MDM-5: Info strip (availability chip + delivery chips) — juste sous le
  // prix, AVANT couleur/taille (réf. docs/reference/reference-modale-
  // architecture.html : prix → pill livraison → couleur → taille → suggestions).
  renderInfoStrip(detail, selection, root);

  // MDM-4: Option axes
  if (selection.selection_supported) {
    detail.option_axes.forEach((axis) => {
      root.appendChild(renderAxis(detail, selection, axis, rerender));
    });
  }

  // Selection message (e.g. "L indisponible — rupture")
  renderSelectionMessage(root, selection);

  // MDM-7: Description below fold
  renderBelowFold(detail, root);

  // MDM-3: Identity into shell DOM
  renderIdentity(detail, selection);

  // MDM-6: Actions state into shell CTA bar
  renderActions(detail, selection);

  // MDM-2: Media into shell carousel
  renderMedia(detail, selection, forceMedia);
}

/**
 * OPT — Boutons overlay sur le hero mobile (topbar supprimée).
 * Injecte ←, avatar panier et ✕ en position absolue sur .k-modal-img-wrap.
 * Idempotent : ne recrée pas si déjà présents.
 */
function _ensureHeroOverlay() {
  const imgWrap = dom.modal?.querySelector('.k-modal-img-wrap');
  if (!imgWrap || imgWrap.querySelector('.k-modal-topbar-overlay')) return;

  // Conteneur overlay
  const overlay = document.createElement('div');
  overlay.className = 'k-modal-topbar-overlay';

  // ← back
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'k-modal-back-overlay';
  backBtn.setAttribute('aria-label', 'Retour');
  backBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>';
  backBtn.addEventListener('click', () => {
    // Réutilise le handler du bouton back original
    dom.modalBack?.click();
  });

  // Groupe droit : panier + ✕
  const right = document.createElement('div');
  right.className = 'k-modal-topbar-overlay-right';

  // Avatar panier
  const cartBtn = document.createElement('button');
  cartBtn.type = 'button';
  cartBtn.className = 'k-modal-cart-overlay';
  cartBtn.setAttribute('aria-label', 'Panier');
  cartBtn.innerHTML = '<img src="/images/avatar_seule.png" alt="" aria-hidden="true"><span class="k-modal-cart-badge-overlay" id="k-modal-cart-badge-overlay"></span>';
  cartBtn.addEventListener('click', () => dom.modalCartBtn?.click());

  // ✕ fermer
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'k-modal-close-overlay';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => dom.modalClose?.click());

  right.append(cartBtn, closeBtn);
  overlay.append(backBtn, right);
  imgWrap.appendChild(overlay);

  // Sync badge panier avec le badge original
  const syncBadge = () => {
    const src = document.getElementById('k-modal-cart-badge');
    const dst = document.getElementById('k-modal-cart-badge-overlay');
    if (src && dst) dst.textContent = src.textContent;
  };
  syncBadge();
  const badgeSrc = document.getElementById('k-modal-cart-badge');
  if (badgeSrc) {
    new MutationObserver(syncBadge).observe(badgeSrc, { childList: true, characterData: true, subtree: true });
  }
}


export function clearMobileProductDetailState() {
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalMediaSignature = '';
}
