/**
 * @komerce-arch-lite
 * @role          catalog-modal-discovery-detail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Rendre Physical Offer / Service dans l'unique shell #k-modal et projeter plusieurs actions autorisées sans déduire l'interaction du kind.
 * @impact-areas  product-discovery, discovery-rail, modal-layout, desktop
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { requestDiscovery } from './discovery-actions.js';
import { sanitize } from './b-utils.js';
import { closeModal } from './b-modal.js';

const SLOT_ID = 'k-modal-discovery-detail';
const ALLOWED_ACTIONS = Object.freeze(['request', 'quote', 'callback', 'call', 'whatsapp']);
const INQUIRY_ACTIONS = Object.freeze(['request', 'quote', 'callback']);
let _installed = false;

function kindLabelFor(kind) {
  return kind === 'physical_offer' ? 'Produit local' : 'Service local';
}

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

function normalizeActions(detail = {}) {
  // Contrat legacy : une ancienne projection sans `actions` continue à suivre
  // exactement le parcours Commander/Demander historique.
  if (!Array.isArray(detail.actions)) return ['request'];

  const phone = typeof detail.public_contact?.phone === 'string'
    ? detail.public_contact.phone.trim()
    : '';
  const whatsapp = typeof detail.public_contact?.whatsapp === 'string'
    ? detail.public_contact.whatsapp.trim()
    : '';
  const seen = new Set();
  const actions = [];

  for (const raw of detail.actions) {
    const action = String(raw || '').trim().toLowerCase();
    if (!ALLOWED_ACTIONS.includes(action) || seen.has(action)) continue;
    if (action === 'call' && !phone) continue;
    if (action === 'whatsapp' && !whatsapp) continue;
    seen.add(action);
    actions.push(action);
  }
  return actions;
}

function actionLabelFor(action, kind) {
  if (action === 'quote') return 'Demander un devis';
  if (action === 'callback') return 'Être rappelé';
  if (action === 'call') return 'Appeler';
  if (action === 'whatsapp') return 'WhatsApp';
  return ctaFor(kind);
}

function telHref(value) {
  const normalized = String(value || '').trim().replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : null;
}

function whatsappHref(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits ? `https://wa.me/${digits}` : null;
}

function buildActionHTML(kind, ref, detail, actions) {
  if (!actions.length) {
    return '<p class="k-modal-discovery-no-action">Contact momentanément indisponible.</p>';
  }

  const contact = detail.public_contact || {};
  return actions.map((action, index) => {
    const label = sanitize(actionLabelFor(action, kind));
    const priorityClass = index === 0 ? ' is-primary' : ' is-secondary';
    const sharedClass = `k-discovery-cta k-modal-discovery-cta k-modal-discovery-action${priorityClass}`;

    if (action === 'call') {
      const href = telHref(contact.phone);
      if (!href) return '';
      return `<a class="${sharedClass}" href="${sanitize(href)}"
        data-discovery-direct-action="call">${label}</a>`;
    }

    if (action === 'whatsapp') {
      const href = whatsappHref(contact.whatsapp);
      if (!href) return '';
      return `<a class="${sharedClass}" href="${sanitize(href)}"
        target="_blank" rel="noopener noreferrer"
        data-discovery-direct-action="whatsapp">${label}</a>`;
    }

    return `<button class="${sharedClass}" type="button"
      data-discovery-modal-action="${sanitize(action)}"
      data-discovery-kind="${sanitize(kind)}"
      data-discovery-ref="${sanitize(ref)}">${label}</button>`;
  }).join('');
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
  const actions = normalizeActions(detail);
  const hasInquiryAction = actions.some(action => INQUIRY_ACTIONS.includes(action));
  const requestField = hasInquiryAction
    ? `<label class="k-modal-discovery-request">
        <span class="k-modal-discovery-request-label">${sanitize(requestLabelFor(kind))} <span>· facultatif</span></span>
        <input class="k-modal-discovery-request-input" type="text" maxlength="160"
          autocomplete="off" spellcheck="true"
          data-discovery-requested-window
          placeholder="${sanitize(requestPlaceholderFor(kind))}">
      </label>`
    : '';

  return `
    <div class="k-modal-discovery-shell">
      <div class="k-modal-discovery-media">${image}</div>
      <div class="k-modal-discovery-body">
        <div class="k-modal-discovery-meta" aria-label="Type et disponibilité">
          <span class="k-modal-discovery-badge k-modal-discovery-kind">${sanitize(kindLabelFor(kind))}</span>
          <span class="k-modal-discovery-badge">${sanitize(statusFor(kind))}</span>
        </div>
        <h2 class="k-modal-discovery-title">${sanitize(detail.title)}</h2>
        ${provider}
        ${description}
        ${requestField}
        <div class="k-modal-discovery-actions" aria-label="Actions disponibles">
          ${buildActionHTML(kind, ref, detail, actions)}
        </div>
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
  const direct = event.target.closest('[data-discovery-direct-action]');
  if (direct) {
    closeModal({ skipHistoryBack: true });
    return;
  }

  const button = event.target.closest('[data-discovery-modal-action][data-discovery-kind][data-discovery-ref]');
  if (!button || !button.matches('button')) return;
  const action = button.dataset.discoveryModalAction;
  const kind = button.dataset.discoveryKind;
  const ref = button.dataset.discoveryRef;
  if (!INQUIRY_ACTIONS.includes(action) || !kind || !ref) return;

  const detailShell = button.closest('.k-modal-discovery-shell');
  const requestInput = detailShell?.querySelector('[data-discovery-requested-window]');
  const requestedWindow = requestInput?.value?.trim() || null;

  // Continue inside Komerce: close the detail lifecycle without browser-back,
  // then hand the business action to the canonical Inquiry path.
  closeModal({ skipHistoryBack: true });
  requestDiscovery(kind, ref, button, requestedWindow, action);
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

export {
  kindLabelFor,
  normalizeActions,
  actionLabelFor,
  telHref,
  whatsappHref,
};
