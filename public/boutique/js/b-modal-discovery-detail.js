/**
 * @komerce-arch-lite
 * @role          catalog-modal-discovery-detail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Rendre Physical Offer / Service dans l'unique shell #k-modal sans les convertir en Product.
 * @impact-areas  product-discovery, discovery-rail, modal-layout
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { requestDiscovery } from './discovery-actions.js';
import { sanitize } from './b-utils.js';
import { closeModal } from './b-modal.js';

const SLOT_ID = 'k-modal-discovery-detail';
let _installed = false;

function statusFor(kind) {
  return kind === 'physical_offer' ? 'Préparation sur commande' : 'Sur demande';
}

function ctaFor(kind) {
  return kind === 'physical_offer' ? 'Commander' : 'Demander';
}

function requestLabelFor(kind) {
  return kind === 'physical_offer' ? 'Pour quand ?' : 'Quand souhaitez-vous l’intervention ?';
}

function requestPlaceholderFor(kind) {
  return kind === 'physical_offer' ? 'Ex. vendredi soir' : 'Ex. samedi matin';
}

function buildDetailHTML(kind, ref, detail) {
  const image = detail.image_ref
    ? `<img class="k-modal-discovery-img" src="${sanitize(detail.image_ref)}" alt="${sanitize(detail.title)}" loading="lazy" decoding="async">`
    : '<div class="k-modal-discovery-media-fallback" aria-hidden="true">K</div>';
  const provider = detail.provider_name
    ? `<div class="k-modal-discovery-provider">${sanitize(detail.provider_name)}${detail.zone ? ` · ${sanitize(detail.zone)}` : ''}</div>`
    : (detail.zone ? `<div class="k-modal-discovery-provider">${sanitize(detail.zone)}</div>` : '');
  const description = detail.description
    ? `<p class="k-modal-discovery-desc">${sanitize(detail.description)}</p>`
    : '';

  return `
    <div class="k-modal-discovery-shell">
      <div class="k-modal-discovery-media">${image}</div>
      <div class="k-modal-discovery-body">
        <span class="k-modal-discovery-badge">${sanitize(statusFor(kind))}</span>
        <h2 class="k-modal-discovery-title">${sanitize(detail.title)}</h2>
        ${provider}
        ${description}
        <label class="k-modal-discovery-request">
          <span class="k-modal-discovery-request-label">${sanitize(requestLabelFor(kind))} <span>· facultatif</span></span>
          <input class="k-modal-discovery-request-input" type="text" maxlength="160"
            autocomplete="off" spellcheck="true"
            data-discovery-requested-window
            placeholder="${sanitize(requestPlaceholderFor(kind))}">
        </label>
        <button class="k-discovery-cta k-modal-discovery-cta" type="button"
          data-discovery-modal-action="${sanitize(kind)}"
          data-discovery-ref="${sanitize(ref)}">${sanitize(ctaFor(kind))}</button>
      </div>
    </div>`;
}

export function renderDiscoveryModalDetail(payload) {
  const slot = document.getElementById(SLOT_ID);
  if (!slot || !payload) return false;
  const { kind, ref, detail } = payload;
  if ((kind !== 'service' && kind !== 'physical_offer') || !ref || !detail?.title) return false;

  slot.dataset.discoveryKind = kind;
  slot.innerHTML = buildDetailHTML(kind, ref, detail);
  slot.hidden = false;
  return true;
}

export function clearDiscoveryModalDetail() {
  const slot = document.getElementById(SLOT_ID);
  if (!slot) return;
  slot.hidden = true;
  slot.innerHTML = '';
  delete slot.dataset.discoveryKind;
}

function handleAction(event) {
  const button = event.target.closest('[data-discovery-modal-action][data-discovery-ref]');
  if (!button || !button.matches('button')) return;
  const kind = button.dataset.discoveryModalAction;
  const ref = button.dataset.discoveryRef;
  if (!kind || !ref) return;

  const detailShell = button.closest('.k-modal-discovery-shell');
  const requestInput = detailShell?.querySelector('[data-discovery-requested-window]');
  const requestedWindow = requestInput?.value?.trim() || null;

  // Continue inside Komerce: close the detail lifecycle without browser-back,
  // then hand the business action to the canonical Inquiry path.
  closeModal({ skipHistoryBack: true });
  requestDiscovery(kind, ref, button, requestedWindow);
}

export function setupDiscoveryModalDetail() {
  if (_installed) return;
  _installed = true;

  const slot = document.getElementById(SLOT_ID);
  if (!slot) return;
  slot.addEventListener('click', handleAction);
  bus.on('modal:discovery-opened', renderDiscoveryModalDetail);
  bus.on('modal:closed', clearDiscoveryModalDetail);
}
