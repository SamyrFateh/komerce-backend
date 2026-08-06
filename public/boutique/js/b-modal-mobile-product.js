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
 * - hardcoded reassurance blocks (a duplicated, locally-owned mobile block)
 *
 * Réintroduit (2026-07, fidélité 4 états, état C+D) : réassurance compacte
 * mobile — PAS un nouveau bloc hardcodé, mais un appel à renderTrust(),
 * l'owner unique déjà utilisé par le desktop (b-modal-desktop-product.js).
 * Toujours affichée (produit simple ET enrichi) car garantie transactionnelle
 * factuelle, jamais du contenu éditorial conditionnel. Voir renderTrust().
 *
 * The modal selects and renders. It never reconstructs stock, invents a SKU
 * combination, hardcodes delivery labels, or becomes a mini-checkout.
 */

'use strict';

import { state, dom, getRequestedTransportRail } from './b-store.js';
import { fmtPrice, optimizeImgUrl } from './b-utils.js';
import {
  OPTION_STATE,
  selectModalOption,
} from './view-models/modal-selection-model.js';
import { buildCarouselSlides, goToSlide } from './b-modal-product.js';
import { setupImageUX } from './b-modal-image-ux.js';
import { wireBuyNowButton, wireAddToListButton } from './b-modal-buybox-shared.js';
import { canAddToActiveSharedList } from './group/group-side-cart.js';
import { reconcileDeliverySelection } from './view-models/delivery-mode-model.js';
import { paintDetailFields } from './b-modal-product-fields.js';
import { renderTrust, renderShare } from './b-modal-desktop-product.js';
import {
  buildProductContentViewModel,
  shouldOfferReadMore,
  CONTENT_LABELS,
} from './view-models/product-content-model.js';
import { isDesktop } from './b-scroll-owner.js';

/* ── helpers ──────────────────────────────────────────────────── */

// §4 — isMobileViewport() remplacée par !isDesktop() (unification viewport).
function isMobileViewport() {
  return !isDesktop();
}

function isPhotoAxis(axis) {
  return /couleur|color|coloris|teinte/i.test(axis.key || axis.display_name || '');
}

/* F5 — Palette nom→hex partagée avec b-modal-desktop-product.js */
const _COLOR_HEX_MAP = {
  blanc: '#ffffff', white: '#ffffff',
  noir: '#1a1a1a', black: '#1a1a1a',
  gris: '#9e9e9e', grey: '#9e9e9e', gray: '#9e9e9e',
  naturel: '#c4a882', beige: '#f0e0c8', camel: '#c19a6b',
  marron: '#795548', brun: '#6d4c41', chocolat: '#4e342e',
  rouge: '#d32f2f', red: '#d32f2f', bordeaux: '#7b1fa2',
  corail: '#ff7043', coral: '#ff7043', rose: '#f48fb1', pink: '#f48fb1',
  orange: '#f57c00', ocre: '#e65100',
  jaune: '#fbc02d', yellow: '#fbc02d', or: '#ffd54f', gold: '#ffd54f',
  vert: '#388e3c', green: '#388e3c', kaki: '#827717', olive: '#827717',
  bleu: '#1565c0', blue: '#1565c0', marine: '#0d47a1', navy: '#0d47a1',
  turquoise: '#00897b', cyan: '#0097a7',
  violet: '#6a1b9a', purple: '#7b1fa2', lilas: '#9c27b0',
};
function _colorNameToHex(name) {
  if (!name) return '#bdbdbd';
  const key = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return _COLOR_HEX_MAP[key] || '#bdbdbd';
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
    } else if (photo) {
      // F5 — Swatch couleur pur (pas de thumbnail) : cercle CSS coloré
      button.className = `k-sku k-sku--color${active ? ' k-sku--active' : ''}${
        unavailable ? ' k-vp--out' : ''
      }`;
      button.style.background = _colorNameToHex(option.value);
      button.title = option.value;
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

/* ── Icône livraison (SVG uniquement — doctrine "un seul langage graphique") ──
 * Dupliquée volontairement côté desktop (b-modal-desktop-product.js) : les deux
 * surfaces ont des rendus DOM distincts par architecture (cf. reference-modale-
 * architecture.html), ce n'est pas un état partagé qui justifierait un import. */
function _deliveryIconSvg(isAir) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  if (isAir) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '22'); line.setAttribute('y1', '2');
    line.setAttribute('x2', '11'); line.setAttribute('y2', '13');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '22 2 15 22 11 13 2 9 22 2');
    svg.append(line, poly);
  } else {
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '3.27 6.96 12 12.01 20.73 6.96');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12'); line.setAttribute('y1', '22.08');
    line.setAttribute('x2', '12'); line.setAttribute('y2', '12');
    svg.append(path1, poly, line);
  }
  return svg;
}

/* ── MDM-5 : Info strip (dispo + delivery chips) ──────────────── */

function renderInfoStrip(detail, selection, root) {
  const strip = document.createElement('div');
  strip.className = 'k-mdm-info-strip';
  strip.dataset.infoStrip = '1';

  // Availability chip — only when selection is supported AND incomplete.
  // P2 stock-en-double (2026-07) : quand selected_sku_id résout, le produit
  // est par définition disponible (resolveSelectedSku ne renvoie que des
  // unités stock_status===AVAILABLE) — l'info est déjà portée par le pill
  // stock près du prix (renderStockPill). La répéter ici sous "✓ Disponible"
  // est un pur doublon. Les vraies exceptions (rupture, incompatibilité)
  // restent surfacées ailleurs via selection.selection_message (message
  // dédié sous les groupes de variantes), jamais via ce chip. Le chip ne
  // reste donc utile que pour guider une sélection encore incomplète.
  if (selection.selection_supported && !selection.selected_sku_id) {
    const availChip = document.createElement('span');
    const hasSelections =
      Object.keys(selection.selected_options).length > 0;
    availChip.className = 'k-mdm-chip';
    availChip.textContent = hasSelections
      ? 'Choisissez la suite'
      : 'Choisissez vos options';
    strip.appendChild(availChip);
  }

  // Delivery chips — exclusively from detail.delivery_options[]
  // Never hardcoded. Zero chips if array is empty. Les options indisponibles
  // restent affichées (info transparente, comportement historique du chip
  // mobile) mais ne participent jamais au choix interactif.
  const options = detail?.delivery_options || [];
  const availableOptions = options.filter((option) => option.available !== false);
  // Plusieurs options réellement disponibles → chaque chip disponible
  // devient un choix explicite (role=radio), miroir du sélecteur desktop
  // (.k-dsel-wrap) — voir b-modal-desktop-product.js::renderDeliverySelector.
  const isInteractive = availableOptions.length > 1;
  const selectedRail = isInteractive ? getRequestedTransportRail() : null;

  if (isInteractive) {
    strip.setAttribute('role', 'radiogroup');
    strip.setAttribute('aria-label', 'Mode de livraison');
  }

  options.forEach((option) => {
    const isAir = typeof option.code === 'string' && option.code.startsWith('AIR_');
    const isClickable = isInteractive && option.available !== false;
    const isSelected = isClickable && option.code === selectedRail;
    const chip = document.createElement(isClickable ? 'button' : 'span');
    chip.className = `k-mdm-chip k-mdm-chip--delivery${isAir ? ' k-mdm-chip--air' : ''}`;
    if (isClickable) {
      chip.type = 'button';
      chip.dataset.rail = option.code;
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(isSelected));
      if (isSelected) chip.classList.add('k-mdm-chip--delivery-selected');
    }
    const iconWrap = document.createElement('span');
    iconWrap.className = 'k-mdm-chip-icon';
    iconWrap.appendChild(_deliveryIconSvg(isAir));
    chip.append(iconWrap, document.createTextNode(` ${option.label}`));

    // P1 livraison mobile (2026-07) : chaque mode de livraison a sa propre
    // zone verticale (chip pleine largeur, meta sur sa propre ligne) au lieu
    // d'une rangée horizontale dense — voir CSS .k-mdm-chip--delivery.
    // Append meta (price, ETA) if provided by contract
    const meta = [];
    if (option.price_kmf != null) meta.push(fmtPrice(option.price_kmf));
    if (option.eta_label) meta.push(option.eta_label);
    if (meta.length > 0) {
      const metaSpan = document.createElement('span');
      metaSpan.className = 'k-mdm-chip-meta';
      metaSpan.textContent = meta.join(' · ');
      chip.appendChild(metaSpan);
    }

    if (isClickable) {
      chip.addEventListener('click', () => {
        state.modalDeliverySelection = { requested_transport_rail: option.code };
        strip.querySelectorAll('.k-mdm-chip--delivery[data-rail]').forEach((c) => {
          const active = c.dataset.rail === option.code;
          c.classList.toggle('k-mdm-chip--delivery-selected', active);
          c.setAttribute('aria-checked', String(active));
        });
      });
    }

    strip.appendChild(chip);
  });

  // Fallback: no delivery options at all
  if (options.length === 0) {
    const fallback = document.createElement('span');
    fallback.className = 'k-mdm-chip k-mdm-chip--delivery';
    const fallbackIcon = document.createElement('span');
    fallbackIcon.className = 'k-mdm-chip-icon';
    fallbackIcon.appendChild(_deliveryIconSvg(false));
    fallback.append(fallbackIcon, document.createTextNode(' Livraison communiquée à la commande'));
    strip.appendChild(fallback);
  }

  root.appendChild(strip);
}

/* ── MDM-6 : Actions state (CTA enable/disable) ──────────────── */

function renderActions(detail, selection) {
  const isSku = detail.inventory_model === 'SKU';
  const enabled = !isSku || Boolean(selection.selected_sku_id);
  // Mandat §3.2 — remplacement, jamais coexistence (voir b-modal-desktop-product.js
  // pour le même correctif côté desktop).
  const replacedBySharedListCta = canAddToActiveSharedList();
  [dom.addCartBtn, document.getElementById('k-buy-now-btn')].forEach(
    (button) => {
      if (!button) return;
      button.hidden = replacedBySharedListCta;
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
  // Lot 3 GAP-07 — visible uniquement si une liste ouverte appartenant au
  // créateur courant est active (canAddToActiveSharedList côté module).
  wireAddToListButton(document.getElementById('k-add-to-list-btn'));
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
function renderBelowFold(detail, root, vm) {
  const fold = document.createElement('hr');
  fold.className = 'k-mdm-fold';
  root.appendChild(fold);

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
 *   1. Info strip (availability + delivery chips)
 *   2. Options (axes) — rendered into #k-modal-variants container
 *   3. Selection message
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

  // Fidélité 4 états (2026-07) : calculé une fois, réutilisé pour le
  // below-fold éditorial uniquement. Rien d'inventé ici — `hasEnrichedContent`
  // reflète strictement la présence de données éditoriales réelles
  // (content.*), jamais une heuristique produit.
  const contentVm = buildProductContentViewModel(detail.content);

  // P3-fix : classe CSS pour réduire le hero quand le produit a des variantes
  if (dom.modal) {
    dom.modal.classList.toggle('k-modal--has-variants', Boolean(selection.selection_supported));
    // DOCTRINE (confirmée 2026-07, cf. HANDOFF §6 règle D) : réassurance,
    // partage ET suggestions sont TOUJOURS montés — jamais conditionnés à
    // hasEnrichedContent, sur aucune surface. Les suggestions non-enrichies
    // sont du cross-sell légitime (d'autres produits), pas du faux contenu
    // enrichi sur l'article courant. On ne masque donc plus jamais
    // #k-modal-suggestions via cette classe — la classe
    // .k-modal--suggestions-hidden et sa règle CSS sont retirées.
  }

  // Réassurance transactionnelle — toujours affichée (produit simple ET
  // enrichi), même owner unique que le desktop (voir renderTrust()).
  renderTrust();

  // Partage produit — toujours affiché (produit simple ET enrichi), même
  // owner unique que le desktop (RÉF-2026-07 doc canonique §3 : Partage =
  // Oui/Oui). Absent jusqu'ici côté mobile — renderShare() n'était appelée
  // que depuis renderDesktopProductDetail(), jamais depuis ce renderer.
  renderShare(detail);

  // Clear and rebuild the variants container
  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdc4Root = '1';
  root.className = 'k-mdm-root';
  container.appendChild(root);

  // Réconcilier l'état de sélection livraison avec le contrat produit courant.
  // Mobile et desktop partagent state.modalDeliverySelection — jamais dataset DOM.
  // Afficher une option, même unique, n'est pas un choix explicite du client :
  // requested_transport_rail reste null tant qu'aucun clic n'a eu lieu. Seul un
  // choix précédent encore valide parmi les options actuelles est conservé.
  const deliveryOptions = detail?.delivery_options || [];
  state.modalDeliverySelection = reconcileDeliverySelection(
    deliveryOptions,
    state.modalDeliverySelection
  );

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
  renderBelowFold(detail, root, contentVm);

  // MDM-3: Identity into shell DOM
  renderIdentity(detail, selection);

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
