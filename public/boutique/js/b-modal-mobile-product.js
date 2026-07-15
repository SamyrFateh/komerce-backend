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
 * @version       2026-07
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
import { getCurrentPrice, renderSubtotalInto, renderPaymentModes, startGroupCartFlow } from './b-modal-buybox-shared.js';

function isMobileViewport() {
  return window.matchMedia('(max-width: 899px)').matches;
}

function isPhotoAxis(axis) {
  return /couleur|color|coloris|teinte/i.test(axis.key || axis.display_name || '');
}

function activeUnit(detail, selection) {
  return (detail.sellable_units || []).find((unit) => unit.sku_id === selection.selected_sku_id) || null;
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

  // b-modal-image-ux relit les slides réels à chaque appel. Après un changement
  // couleur, le fullscreen et le compteur suivent donc la nouvelle galerie.
  setupImageUX();
}

function renderIdentity(detail) {
  if (dom.modalName) dom.modalName.textContent = detail.product.name;
  if (dom.modalDesc) {
    dom.modalDesc.textContent = detail.product.description || '';
    dom.modalDesc.classList.remove('is-expanded');
  }
  if (dom.modalCat) {
    dom.modalCat.textContent = detail.product.category || '';
  }

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
}

function renderPriceAndReference(detail, selection) {
  const unit = activeUnit(detail, selection);
  const price = getCurrentPrice(detail, selection);
  if (dom.modalPrice) dom.modalPrice.textContent = fmtPrice(price);

  // PDC-4 : l'ancien prix vient du contrat ou reste absent. La modal ne le
  // reconstruit jamais depuis promo_pct.
  if (dom.modalOldPrice) {
    if (detail.pricing.old_price_kmf != null) {
      dom.modalOldPrice.textContent = fmtPrice(detail.pricing.old_price_kmf);
      dom.modalOldPrice.classList.remove('u-hidden');
    } else {
      dom.modalOldPrice.textContent = '';
      dom.modalOldPrice.classList.add('u-hidden');
    }
  }

  if (dom.modalSku) {
    const reference = unit?.sku || detail.product.reference;
    dom.modalSku.textContent = reference ? `Réf. ${reference}` : '';
    dom.modalSku.hidden = !reference;
  }
}

function renderStock(selection) {
  if (!dom.modalStock) return;

  if (!selection.selection_supported) {
    dom.modalStock.textContent = '';
    dom.modalStock.className = 'k-modal-stock';
    dom.modalStock.hidden = true;
    return;
  }

  dom.modalStock.hidden = false;
  if (selection.selected_sku_id) {
    dom.modalStock.textContent = '✓ Disponible';
    dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
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

  // PDC-6 : le stepper modal (+/-) mute le panier "product-id first"
  // (quickAdd/quickRemove résolvent par product.id, jamais par selected_sku_id).
  // Ce n'est donc jamais une voie de mutation valide pour un produit SKU —
  // même une fois le SKU résolu et le CTA actif — sous peine de contourner la
  // sélection SKU. Il n'est réautorisé que pour l'inventaire historique
  // (LEGACY_VARIANTS / simple), où la mutation product-id first reste valide.
  [dom.qtyMinus, dom.qtyPlus].forEach((control) => {
    if (!control) return;
    control.disabled = isSku;
  });
}

function optionMessage(optionState) {
  if (optionState === OPTION_STATE.OUT_OF_STOCK) return 'Rupture';
  if (optionState === OPTION_STATE.INCOMPATIBLE) return 'Non proposé';
  return '';
}

function renderSelectionMessage(root, selection) {
  const wrap = document.createElement('div');
  wrap.className = 'k-modal-reassurance';
  wrap.dataset.selectionMessage = '1';

  const message = document.createElement('div');
  message.id = 'k-modal-selection-message';
  message.className = 'k-modal-reassurance-toggle';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = selection.selection_message || '';
  message.hidden = !selection.selection_message;

  wrap.appendChild(message);
  root.appendChild(wrap);
}

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
    (selection.option_states[axis.key] || []).map((entry) => [entry.value, entry.state])
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
      `${axis.display_name} ${option.value}${unavailable ? ` — ${optionMessage(stateValue)}` : ''}`
    );

    if (photo && option.thumbnail_url) {
      // k-vp--out rend l'indisponibilité sans pointer-events:none : contrairement
      // à l'ancien k-sku--out, le clic reste possible pour expliquer la raison.
      button.className = `k-sku${active ? ' k-sku--active' : ''}${unavailable ? ' k-vp--out' : ''}`;
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

function deliveryMeta(option) {
  const parts = [];
  if (option.price_kmf != null) parts.push(fmtPrice(option.price_kmf));
  if (option.eta_label) parts.push(option.eta_label);
  if (!option.available && option.unavailable_reason) parts.push(option.unavailable_reason);
  return parts.join(' · ');
}

function renderDeliveryOptions(detail, root) {
  const delivery = document.createElement('section');
  delivery.className = 'k-modal-reassurance';
  delivery.dataset.productDeliveryOptions = '1';
  const options = detail?.delivery_options || [];

  if (!options.length) {
    const row = document.createElement('div');
    row.className = 'k-modal-reassurance-toggle';
    row.innerHTML =
      '<span class="k-modal-reassurance-main">' +
        '<span class="k-modal-reassurance-icon">📦</span>' +
        '<span class="k-modal-reassurance-label">Livraison</span>' +
        '<span class="k-modal-reassurance-delay">· communiquée à la commande</span>' +
      '</span>';
    delivery.appendChild(row);
  } else {
    options.forEach((option) => {
      const row = document.createElement('div');
      row.className = 'k-modal-reassurance-toggle';
      const main = document.createElement('span');
      main.className = 'k-modal-reassurance-main';
      main.innerHTML = '<span class="k-modal-reassurance-icon">📦</span>';

      const label = document.createElement('span');
      label.className = 'k-modal-reassurance-label';
      label.textContent = option.label;
      main.appendChild(label);

      const metaText = deliveryMeta(option);
      if (metaText) {
        const meta = document.createElement('span');
        meta.className = 'k-modal-reassurance-delay';
        meta.textContent = `· ${metaText}`;
        main.appendChild(meta);
      }

      row.appendChild(main);
      delivery.appendChild(row);
    });
  }

  root.appendChild(delivery);
}

function renderSubtotal(detail, selection, root) {
  let subtotal = root.querySelector('.k-modal-subtotal');
  if (!subtotal) {
    subtotal = document.createElement('div');
    subtotal.className = 'k-modal-subtotal k-modal-subtotal--mobile';
    root.appendChild(subtotal);
  }
  renderSubtotalInto(subtotal, detail, selection, state.modalQty);
}

// MDP-2 : mêmes modes de paiement qu'en desktop (Carte / Cash / Panier
// partagé / Cagnotte), même logique (b-modal-buybox-shared.js). Seule la
// composition diffère : ici le sélecteur est composé dans le flux naturel
// de `root`, au lieu du placement desktop géré par b-modal-approche-c-hybrid.js.
function renderPaymentSection(detail, selection, root) {
  let payment = root.querySelector('.k-buybox-payment-mobile');
  if (!payment) {
    payment = document.createElement('div');
    payment.className = 'k-buybox-payment-mobile';
    root.appendChild(payment);
  }

  renderPaymentModes(payment, {
    activeMode: state.modalPaymentMode,
    onModeChange: (key) => { state.modalPaymentMode = key; },
    onGroupSelect: () => {
      startGroupCartFlow(state.modalProduct, state.modalQty, payment);
    },
  });
}

/**
 * Rend la composition mobile PDC-4 depuis le contrat détail et l'état de
 * sélection unique. Cette fonction peut être rappelée après chaque sélection.
 */
export function renderMobileProductDetail(detail, selection, { forceMedia = false } = {}) {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || !isMobileViewport()) return;

  state.modalProductDetail = detail;
  state.modalSelection = selection;
  // Compatibilité transactionnelle de transition : le backend SKU résout encore
  // autoritairement depuis variant_combo. Le snapshot lisible suit donc exactement
  // l'état PDC-3 ; il n'est plus construit par le renderer legacy à deux axes.
  state.modalVariantCombo = selection.selection_supported
    ? { ...selection.selected_options }
    : {};

  function rerender() {
    renderMobileProductDetail(detail, state.modalSelection);
  }

  // Le legacy core injecte encore temporairement sa reassurance hardcodée.
  // PDC-4 la retire dès que le vrai contrat détail est disponible.
  dom.modal?.querySelector('[data-mobile-reassurance]')?.remove();

  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdc4Root = '1';
  container.appendChild(root);

  if (selection.selection_supported) {
    detail.option_axes.forEach((axis) => {
      root.appendChild(renderAxis(detail, selection, axis, rerender));
    });
  }

  renderSelectionMessage(root, selection);
  renderDeliveryOptions(detail, root);
  renderIdentity(detail);
  renderPriceAndReference(detail, selection);
  renderStock(selection);
  renderActions(detail, selection);
  renderSubtotal(detail, selection, root);
  renderPaymentSection(detail, selection, root);
  renderMedia(detail, selection, forceMedia);
}

export function clearMobileProductDetailState() {
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalMediaSignature = '';
}
