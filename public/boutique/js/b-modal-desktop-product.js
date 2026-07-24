/**
 * @komerce-arch
 * @role          desktop-product-modal-renderer
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state
 * @outputs       desktop_product_modal_dom
 * @depends       b-store.js, b-utils.js, b-scroll-owner.js, b-modal-product.js, b-modal-image-ux.js, view-models/modal-selection-model.js, view-models/product-content-model.js
 * @used-by       b-modal-product-detail-bootstrap.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, desktop, sku-selection, delivery-options, media-carousel, product-content
 * @version       2026-07 — Lot Content, commit 4 (contenu enrichi partagé)
 */

'use strict';

import { state, dom, modalZone } from './b-store.js';
import { fmtPrice, optimizeImgUrl } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';
import {
  OPTION_STATE,
  selectModalOption,
} from './view-models/modal-selection-model.js';
import { buildCarouselSlides, goToSlide } from './b-modal-product.js';
import { setupImageUX } from './b-modal-image-ux.js';
import { renderSubtotalInto, renderPaymentModes, startGroupCartFlow, wireBuyNowButton } from './b-modal-buybox-shared.js';
import { deriveDeliveryMode } from './view-models/delivery-mode-model.js';
import { showToast } from './b-cart-core.js';
import { paintDetailFields } from './b-modal-product-fields.js';
import {
  buildProductContentViewModel,
  shouldOfferReadMore,
  CONTENT_LABELS,
} from './view-models/product-content-model.js';

let _qtyObserver = null;
let _qtyObservedEl = null;

function isPhotoAxis(axis) {
  return /couleur|color|coloris|teinte/i.test(axis.key || axis.display_name || '');
}

/* F5 — Palette de correspondance nom → hex pour les axes couleur sans thumbnail.
   La clé est le nom normalisé (minuscule, sans accent).
   Étendue au fil des couleurs rencontrées en production. */
const COLOR_HEX_MAP = {
  // Neutres
  blanc: '#ffffff', white: '#ffffff',
  noir: '#1a1a1a', black: '#1a1a1a',
  gris: '#9e9e9e', grey: '#9e9e9e', gray: '#9e9e9e',
  // Bruns / naturels
  naturel: '#c4a882', beige: '#f0e0c8', camel: '#c19a6b',
  marron: '#795548', brun: '#6d4c41', chocolat: '#4e342e',
  // Rouges
  rouge: '#d32f2f', red: '#d32f2f', bordeaux: '#7b1fa2',
  corail: '#ff7043', coral: '#ff7043', rose: '#f48fb1', pink: '#f48fb1',
  // Oranges
  orange: '#f57c00', ocre: '#e65100',
  // Jaunes
  jaune: '#fbc02d', yellow: '#fbc02d', or: '#ffd54f', gold: '#ffd54f',
  // Verts
  vert: '#388e3c', green: '#388e3c', kaki: '#827717', olive: '#827717',
  // Bleus
  bleu: '#1565c0', blue: '#1565c0', marine: '#0d47a1', navy: '#0d47a1',
  turquoise: '#00897b', cyan: '#0097a7',
  // Violets
  violet: '#6a1b9a', purple: '#7b1fa2', lilas: '#9c27b0',
};

function colorNameToHex(name) {
  if (!name) return '#bdbdbd';
  // Normalise : minuscule, supprime accents
  const key = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
  return COLOR_HEX_MAP[key] || '#bdbdbd';
}

function mediaSignature(selection) {
  return (selection.selected_media || []).map((media) => `${media.id}:${media.url}`).join('|');
}

function renderMedia(detail, selection, force = false) {
  const signature = mediaSignature(selection);
  if (!force && state.modalMediaSignature === signature) return;
  state.modalMediaSignature = signature;

  const media = selection.selected_media && selection.selected_media.length
    ? selection.selected_media
    : (detail.media || []);

  buildCarouselSlides({
    name: detail.product.name,
    images: media.map((item) => item.url),
    image_url: media[0]?.url || '',
  });
  goToSlide(0);
  setupImageUX();
}

// Chantier déduplication (§3) : name/sku/price/old-price/cat/promo-badge
// sont peints par paintDetailFields() (owner unique, b-modal-product-fields.js).
// Ne restent ici que les zones réellement propres au desktop : desc (le
// mobile l'efface, MDM-7) et la neutralisation des anciennes zones legacy
// (aed/flash/stock-bar), qui n'existent pas côté mobile.
function renderIdentity(detail) {
  if (dom.modalDesc) {
    dom.modalDesc.textContent = detail.product.description || '';
    dom.modalDesc.classList.remove('is-expanded');
  }

  // Les anciennes zones reconstruisaient prix EUR, économie et faux stock depuis
  // le produit brut. PDC-5 les neutralise ; PDC-6 supprimera leur code legacy.
  const aed = document.getElementById('k-modal-aed-price');
  const flash = document.getElementById('k-modal-flash-bar');
  const stockBar = document.getElementById('k-modal-stock-bar');
  if (aed) aed.innerHTML = '';
  if (flash) flash.innerHTML = '';
  if (stockBar) stockBar.innerHTML = '';
}

function renderStock(selection) {
  if (!dom.modalStock) return;

  if (!selection.selection_supported) {
    dom.modalStock.textContent = '';
    dom.modalStock.hidden = true;
    return;
  }

  dom.modalStock.hidden = false;

  if (selection.selected_sku_id) {
    // P2-fix : badge numérique ● N en stock / Plus que N / Épuisé
    // Même logique que renderStockPill() dans b-modal-mobile-product.js
    // (contrat product_detail_v1, sellable_units[].available_quantity)
    const unit = (state.modalProductDetail?.sellable_units || [])
      .find((u) => u.sku_id === selection.selected_sku_id);
    const qty = unit?.available_quantity;

    if (qty == null || Number.isNaN(qty)) {
      dom.modalStock.textContent = '● En stock';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
    } else if (qty === 0) {
      dom.modalStock.textContent = '● Épuisé';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--out';
    } else if (qty <= 5) {
      dom.modalStock.textContent = `● Plus que ${qty}`;
      dom.modalStock.className = 'k-modal-stock k-modal-stock--low';
    } else {
      dom.modalStock.textContent = `● ${qty} en stock`;
      dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
    }
    return;
  }

  dom.modalStock.textContent = Object.keys(selection.selected_options).length > 0
    ? 'Choisissez la suite'
    : 'Choisissez vos options';
  dom.modalStock.className = 'k-modal-stock';
}

function renderActions(detail, selection) {
  const isSku = detail.inventory_model === 'SKU';
  const enabled = !isSku || Boolean(selection.selected_sku_id);
  [dom.addCartBtn, document.getElementById('k-buy-now-btn')].forEach((button) => {
    if (!button) return;
    button.disabled = !enabled;
    if (!enabled) button.setAttribute('aria-describedby', 'k-modal-selection-message');
    else button.removeAttribute('aria-describedby');
  });

  // PDC-6 : le stepper modal (+/-) mute encore le panier "product-id first"
  // (quickAdd/quickRemove résolvent par product.id, jamais par selected_sku_id).
  // Ce n'est donc jamais une voie de mutation valide pour un produit SKU,
  // même une fois le SKU résolu et les CTA réactivés. Le stepper reste permis
  // uniquement pour l'inventaire historique/non-SKU où cette mutation reste valide.
  [dom.qtyMinus, dom.qtyPlus].forEach((control) => {
    if (!control) return;
    control.disabled = isSku;
  });

  wireBuyNowButton(document.getElementById('k-buy-now-btn'));

  // T-023/D11 : layout AVAILABLE_EMPTY (Ajouter + Acheter côte à côte) vs
  // AVAILABLE_FILLED (stepper + Acheter) — porté par modal-shell.css via
  // .k-modal-actions--filled. État dérivé de la présence du produit dans
  // le panier (state.cart, clé product.id), pas de la sélection SKU.
  const actionsEl = modalZone('.k-modal-actions');
  if (actionsEl) {
    const productId = detail.product?.id;
    const inCart = Boolean(
      productId != null
      && (state.cart || []).some((item) => String(item.product?.id) === String(productId) && (item.qty || 0) > 0)
    );
    actionsEl.classList.toggle('k-modal-actions--filled', inCart);
  }
}

/**
 * Bandeau de garanties transactionnelles — pas de l'enrichissement éditorial,
 * donc toujours affiché, produit simple ou enrichi. Contenu statique : rendu
 * une seule fois par ouverture de modal, pas rebuild à chaque changement de
 * sélection (variantes).
 *
 * Exporté (2026-07, États 4-modale/état C+D) : owner unique reste ce fichier
 * (seul writer de #k-modal-trust, cf. scripts/modal-ownership.contract.json),
 * mais b-modal-mobile-product.js importe et appelle cette même fonction pour
 * peupler la réassurance compacte mobile — pas de duplication de contenu, pas
 * de second writer, juste un second appelant du même owner. L'idempotence
 * (childElementCount) protège contre le double-appel desktop+mobile au même
 * cycle de rendu.
 */
export function renderTrust() {
  const el = document.getElementById('k-modal-trust');
  if (!el || el.childElementCount) return;
  el.innerHTML = `
    <span class="k-modal-trust-item"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Paiement sécurisé</span>
    <span class="k-modal-trust-item"><svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8l4 2v6l-4 2"/></svg>Retrait en relais</span>
    <span class="k-modal-trust-item"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Stock garanti</span>
  `;
}

/**
 * Partage produit (WhatsApp + copier le lien) — dépend de l'id produit,
 * donc rerendu uniquement quand le produit affiché change.
 */
function renderShare(detail) {
  const el = document.getElementById('k-modal-share-row');
  if (!el) return;
  const productId = detail?.product?.id;
  if (productId == null) {
    el.innerHTML = '';
    el.dataset.pid = '';
    return;
  }
  if (el.dataset.pid === String(productId)) return;
  el.dataset.pid = String(productId);

  const url = `${window.location.origin}/?p=${productId}`;
  const message = encodeURIComponent(`👀 Regarde ce que j'ai trouvé sur Komerce !\n${url}`);
  el.innerHTML = `
    <button class="k-modal-share-btn k-modal-share-btn--wa" type="button" data-href="https://wa.me/?text=${message}">
      <svg viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
      WA
    </button>
    <button class="k-modal-share-btn" type="button" data-action="copy">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      Lien
    </button>
  `;
  el.querySelector('.k-modal-share-btn--wa')?.addEventListener('click', (event) => {
    window.open(event.currentTarget.dataset.href, '_blank');
  });
  el.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => showToast('🔗 Lien copié !'));
  });
}

function optionReason(optionState) {
  if (optionState === OPTION_STATE.OUT_OF_STOCK) return 'Rupture';
  if (optionState === OPTION_STATE.INCOMPATIBLE) return 'Non proposé';
  return '';
}

function renderSelectionMessage(root, selection) {
  const message = document.createElement('p');
  message.id = 'k-modal-selection-message';
  message.className = 'k-modal-selection-message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = selection.selection_message || '';
  message.hidden = !selection.selection_message;
  root.appendChild(message);
}

function renderAxis(detail, selection, axis, onSelectionChanged) {
  const group = document.createElement('section');
  group.className = 'k-vg';
  group.dataset.axisKey = axis.key;

  const label = document.createElement('div');
  label.className = 'k-vg-label';
  const type = document.createElement('span');
  type.className = 'k-vg-label-type';
  type.textContent = axis.display_name;
  const sep = document.createElement('span');
  sep.className = 'k-vg-label-sep';
  sep.textContent = '·';
  const value = document.createElement('span');
  value.className = 'k-vg-label-val';
  value.textContent = selection.selected_options[axis.key] || 'Choisir';
  label.append(type, sep, value);
  group.appendChild(label);

  const photo = isPhotoAxis(axis);
  const wrap = document.createElement('div');
  wrap.className = photo ? 'k-vg-skus' : 'k-vg-sizes';
  const states = new Map(
    (selection.option_states[axis.key] || []).map((entry) => [entry.value, entry.state])
  );

  axis.values.forEach((option) => {
    const stateValue = states.get(option.value) || OPTION_STATE.INCOMPATIBLE;
    const active = selection.selected_options[axis.key] === option.value;
    const unavailable = stateValue !== OPTION_STATE.AVAILABLE;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.optionValue = option.value;
    button.dataset.optionState = stateValue;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      `${axis.display_name} ${option.value}${unavailable ? ` — ${optionReason(stateValue)}` : ''}`
    );

    if (photo && option.thumbnail_url) {
      button.className = `k-sku${active ? ' k-sku--active' : ''}${unavailable ? ' k-vp--out' : ''}`;
      const image = document.createElement('img');
      image.src = optimizeImgUrl(option.thumbnail_url, 140);
      image.alt = '';
      image.loading = 'lazy';
      const name = document.createElement('span');
      name.className = 'k-sku-name';
      name.textContent = option.value;
      button.append(image, name);
    } else if (photo) {
      // F5 — Swatch couleur pur (pas de thumbnail) : cercle CSS coloré
      button.className = `k-sku k-sku--color${active ? ' k-sku--active' : ''}${unavailable ? ' k-vp--out' : ''}`;
      button.style.background = colorNameToHex(option.value);
      button.title = option.value;
    } else {
      button.className = `k-vp${active ? ' k-vp--active' : ''}${unavailable ? ' k-vp--out' : ''}`;
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

function renderDeliveryModePill(container, detail) {
  const { mode, label, lead_time_label } = deriveDeliveryMode(detail?.delivery_options);
  const pill = document.createElement('div');
  pill.className = `k-modal-delivery-pill k-modal-delivery-pill--${mode}`;
  pill.dataset.deliveryMode = mode;

  const icon = document.createElement('span');
  icon.className = 'k-modal-delivery-pill-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = mode === 'air' ? '✈️' : '🚢';
  pill.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = lead_time_label ? `${label} · ${lead_time_label}` : label;
  pill.appendChild(text);

  container.appendChild(pill);
}

function deliveryMeta(option) {
  const parts = [];
  if (option.price_kmf != null) parts.push(fmtPrice(option.price_kmf));
  if (option.eta_label) parts.push(option.eta_label);
  if (!option.available && option.unavailable_reason) parts.push(option.unavailable_reason);
  return parts.join(' · ');
}

/* ── Icône livraison (SVG uniquement — doctrine "un seul langage graphique") ──
 * Dupliquée volontairement côté mobile (b-modal-mobile-product.js) : les deux
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

/**
 * Desktop : livraison = pill compacte uniquement (mode + délai).
 * Le détail des options et le bloc paiement appartiennent au tunnel
 * de commande, pas à la fiche produit. Conforme aux maquettes validées.
 */
function renderDeliveryOptions(detail) {
  const el = document.getElementById('k-modal-delivery');
  if (!el) return;
  el.innerHTML = '';
  renderDeliveryModePill(el, detail);
}

/* ── Lot Content, commit 4 : contenu enrichi sous la zone transactionnelle ──
 * Même view-model que le mobile (view-models/product-content-model.js) —
 * seule la composition DOM diffère. Aucun recalcul métier ici : tri,
 * filtrage, regroupement et décision "Lire la suite" viennent tous du
 * view-model partagé.
 */

function appendEnrichedTextBlock(container, { heading, text, offerReadMore }) {
  const block = document.createElement('div');
  block.className = 'k-modal-enriched-block';

  const title = document.createElement('h3');
  title.className = 'k-modal-section-title';
  title.textContent = heading;
  block.appendChild(title);

  const textEl = document.createElement('p');
  textEl.className = offerReadMore ? 'k-modal-enriched-text' : 'k-modal-enriched-text is-expanded';
  textEl.textContent = text;
  block.appendChild(textEl);

  if (offerReadMore) {
    const readMore = document.createElement('button');
    readMore.type = 'button';
    readMore.className = 'k-modal-enriched-read-more';
    readMore.textContent = 'Lire la suite';
    readMore.addEventListener('click', () => {
      const expanded = textEl.classList.toggle('is-expanded');
      readMore.textContent = expanded ? 'Réduire' : 'Lire la suite';
    });
    block.appendChild(readMore);
  }

  container.appendChild(block);
}

function appendEnrichedBulletBlock(container, { heading, items, variant }) {
  if (!items.length) return;
  const block = document.createElement('div');
  block.className = `k-modal-enriched-block k-modal-enriched-block--${variant}`;

  const title = document.createElement('h3');
  title.className = 'k-modal-section-title';
  title.textContent = heading;
  block.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'k-modal-enriched-bullet-list';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  block.appendChild(list);
  container.appendChild(block);
}

function appendEnrichedKeyValueBlock(container, { heading, entries }) {
  const block = document.createElement('div');
  block.className = 'k-modal-enriched-block k-modal-enriched-block--specs';

  const title = document.createElement('h3');
  title.className = 'k-modal-section-title';
  title.textContent = heading;
  block.appendChild(title);

  const dl = document.createElement('dl');
  dl.className = 'k-modal-enriched-spec-list';
  entries.forEach(({ label, value }) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  block.appendChild(dl);
  container.appendChild(block);
}

function appendEnrichedSpecifications(container, specificationGroups) {
  if (!specificationGroups.length) return;
  const block = document.createElement('div');
  block.className = 'k-modal-enriched-block k-modal-enriched-block--specs';

  const title = document.createElement('h3');
  title.className = 'k-modal-section-title';
  title.textContent = CONTENT_LABELS.specifications;
  block.appendChild(title);

  specificationGroups.forEach((group) => {
    if (group.group) {
      const groupLabel = document.createElement('div');
      groupLabel.className = 'k-modal-enriched-spec-group-label';
      groupLabel.textContent = group.group;
      block.appendChild(groupLabel);
    }
    const dl = document.createElement('dl');
    dl.className = 'k-modal-enriched-spec-list';
    group.items.forEach((item) => {
      const dt = document.createElement('dt');
      dt.textContent = item.label;
      const dd = document.createElement('dd');
      dd.textContent = item.unit ? `${item.value} ${item.unit}` : item.value;
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    block.appendChild(dl);
  });

  container.appendChild(block);
}

/**
 * Rend content.* dans #k-modal-enriched-content, sous la zone transactionnelle
 * (galerie + buy box). No-op si le conteneur est absent du shell (compat
 * markup non encore migré) ou si le produit n'a aucune matière enrichie —
 * jamais de bloc vide, comme en mobile.
 */
function renderEnrichedContent(detail) {
  const container = document.getElementById('k-modal-enriched-content');
  if (!container) return;
  container.innerHTML = '';

  const vm = buildProductContentViewModel(detail.content);
  if (!vm.hasEnrichedContent) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  appendEnrichedBulletBlock(container, { heading: CONTENT_LABELS.highlights, items: vm.highlights.map((h) => h.label), variant: 'highlights' });
  appendEnrichedSpecifications(container, vm.specificationGroups);
  appendEnrichedBulletBlock(container, { heading: CONTENT_LABELS.materials, items: vm.materials, variant: 'materials' });
  appendEnrichedBulletBlock(container, { heading: CONTENT_LABELS.care, items: vm.care, variant: 'care' });
  appendEnrichedBulletBlock(container, { heading: CONTENT_LABELS.warnings, items: vm.warnings, variant: 'warnings' });

  vm.sections.forEach((section) => {
    if (section.type === 'TEXT') {
      appendEnrichedTextBlock(container, { heading: section.title, text: section.text, offerReadMore: section.offer_read_more });
    } else if (section.type === 'BULLETS') {
      appendEnrichedBulletBlock(container, { heading: section.title, items: section.items, variant: 'editorial' });
    } else if (section.type === 'KEY_VALUE') {
      appendEnrichedKeyValueBlock(container, { heading: section.title, entries: section.entries });
    }
  });
}

function renderSubtotal(detail, selection) {
  const actions = modalZone('.k-modal-actions');
  if (!actions) return;
  let subtotal = actions.querySelector('.k-modal-subtotal');
  if (!subtotal) {
    subtotal = document.createElement('div');
    subtotal.className = 'k-modal-subtotal';
    actions.appendChild(subtotal);
  }

  renderSubtotalInto(subtotal, detail, selection, state.modalQty);
}

function renderPaymentSection(detail, selection) {
  const el = document.getElementById('k-modal-payment');
  if (!el) return;

  renderPaymentModes(el, {
    activeMode: state.modalPaymentMode,
    onModeChange: (key) => { state.modalPaymentMode = key; },
    onGroupSelect: () => {
      startGroupCartFlow(state.modalProduct, state.modalQty, el);
    },
  });
}

function ensureQtyObserver() {
  const qtyEl = dom.modalQtyVal;
  if (!qtyEl || typeof MutationObserver === 'undefined') return;
  if (_qtyObserver && _qtyObservedEl === qtyEl) return;

  if (_qtyObserver) _qtyObserver.disconnect();
  _qtyObservedEl = qtyEl;
  _qtyObserver = new MutationObserver(() => {
    if (!isDesktop() || !state.modalProductDetail || !state.modalSelection) return;
    renderSubtotal(state.modalProductDetail, state.modalSelection);
  });
  _qtyObserver.observe(qtyEl, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

/**
 * Composition desktop : galerie à gauche et Buy Box à droite. Toute disponibilité
 * provient de `selection`; ce renderer ne lit jamais product_variants.stock.
 */
export function renderDesktopProductDetail(detail, selection, { forceMedia = false } = {}) {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || !isDesktop()) return;

  state.modalProductDetail = detail;
  state.modalSelection = selection;
  state.modalVariantCombo = selection.selection_supported
    ? { ...selection.selected_options }
    : {};

  function rerender() {
    renderDesktopProductDetail(detail, state.modalSelection);
  }

  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdc5Root = '1';
  container.appendChild(root);

  if (selection.selection_supported) {
    (detail.option_axes || []).forEach((axis) => {
      root.appendChild(renderAxis(detail, selection, axis, rerender));
    });
  }
  renderSelectionMessage(root, selection);

  paintDetailFields(detail, selection);
  renderIdentity(detail);
  renderStock(selection);
  renderActions(detail, selection);
  renderTrust();
  renderShare(detail);
  renderDeliveryOptions(detail);
  renderEnrichedContent(detail);
  renderMedia(detail, selection, forceMedia);
  ensureQtyObserver();
}

export function refreshDesktopProductSubtotal() {
  if (!state.modalProductDetail || !state.modalSelection) return;
  renderSubtotal(state.modalProductDetail, state.modalSelection);
}

export function clearDesktopProductDetailState() {
  if (_qtyObserver) _qtyObserver.disconnect();
  _qtyObserver = null;
  _qtyObservedEl = null;
}
