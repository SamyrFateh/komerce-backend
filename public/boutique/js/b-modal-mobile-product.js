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
 *   IDENTITY COMPACT (name 1-line + ref inline | price + old_price + promo tag)
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
import {
  SELECTION_AVAILABILITY,
  getCurrentPrice,
  getSelectionAvailability,
  renderSelectionStockInto,
} from './b-modal-buybox-shared.js';
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

function renderIdentity(detail, selection) {
  // Name — single line, overflow handled by CSS clamp
  if (dom.modalName) dom.modalName.textContent = detail.product.name;

  // Reference — compact inline
  const unit = activeUnit(detail, selection);
  if (dom.modalSku) {
    const reference = unit?.sku || detail.product.reference;
    dom.modalSku.textContent = reference ? `Réf. ${reference}` : '';
    dom.modalSku.hidden = !reference;
  }

  // Price
  const price = getCurrentPrice(detail, selection);
  if (dom.modalPrice) dom.modalPrice.textContent = fmtPrice(price);

  // Old price — only if contract provides it, never reconstructed
  if (dom.modalOldPrice) {
    if (detail.pricing.old_price_kmf != null) {
      dom.modalOldPrice.textContent = fmtPrice(detail.pricing.old_price_kmf);
      dom.modalOldPrice.classList.remove('u-hidden');
    } else {
      dom.modalOldPrice.textContent = '';
      dom.modalOldPrice.classList.add('u-hidden');
    }
  }

  // Promo badge on media
  const promo = Number(detail.pricing.promo_pct || 0);
  if (dom.modalPromoBadge) {
    if (promo > 0) {
      dom.modalPromoBadge.textContent = `-${promo}%`;
      dom.modalPromoBadge.classList.add('show');
      dom.modal?.classList.add('k-modal--has-promo');
    } else {
      dom.modalPromoBadge.textContent = '';
      dom.modalPromoBadge.classList.remove('show');
      dom.modal?.classList.remove('k-modal--has-promo');
    }
  }

  // Description — moved below fold (MDM-7). Clear the legacy inline desc
  // so it doesn't compete with the transactional core.
  if (dom.modalDesc) {
    dom.modalDesc.textContent = '';
    dom.modalDesc.classList.add('u-hidden');
  }

  // Category — hidden on mobile (no visual weight needed)
  if (dom.modalCat) {
    dom.modalCat.textContent = '';
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

  // Availability chip — même projection que #k-modal-stock.
  const availability = getSelectionAvailability(detail, selection);
  if (availability.state !== SELECTION_AVAILABILITY.HIDDEN) {
    const availChip = document.createElement('span');
    availChip.className = availability.state === SELECTION_AVAILABILITY.AVAILABLE
      ? 'k-mdm-chip k-mdm-chip--ok'
      : 'k-mdm-chip';
    availChip.dataset.availabilityState = availability.state;
    availChip.textContent = availability.label;
    strip.appendChild(availChip);
  }

  // Delivery chips — exclusively from detail.delivery_options[]
  // Never hardcoded. Zero chips if array is empty.
  const options = detail?.delivery_options || [];
  options.forEach((option) => {
    const chip = document.createElement('span');
    chip.className = 'k-mdm-chip k-mdm-chip--delivery';
    const icon = /express|air|aérien/i.test(option.label) ? '✈️' : '📦';
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
  const enabled = !isSku || getSelectionAvailability(detail, selection).canPurchase;
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

  // Clear and rebuild the variants container
  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdc4Root = '1';
  root.className = 'k-mdm-root';
  container.appendChild(root);

  // MDM-4: Option axes
  if (selection.selection_supported) {
    detail.option_axes.forEach((axis) => {
      root.appendChild(renderAxis(detail, selection, axis, rerender));
    });
  }

  // Selection message (e.g. "L indisponible — rupture")
  renderSelectionMessage(root, selection);

  // MDM-5: Info strip (availability chip + delivery chips)
  renderInfoStrip(detail, selection, root);

  // MDM-7: Description below fold
  renderBelowFold(detail, root);

  // MDM-3: Identity into shell DOM
  renderIdentity(detail, selection);

  // Statut canonique du shell — présent et synchronisé aussi sur mobile.
  renderSelectionStockInto(dom.modalStock, detail, selection);

  // MDM-6: Actions state into shell CTA bar
  renderActions(detail, selection);

  // MDM-2: Media into shell carousel
  renderMedia(detail, selection, forceMedia);
}

export function clearMobileProductDetailState() {
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalMediaSignature = '';
}
