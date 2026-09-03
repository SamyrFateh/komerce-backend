/**
 * @komerce-arch-lite
 * @role          catalog-modal-discovery-detail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Rendre Physical Offer / Service dans l'unique shell #k-modal avec deux intentions lisibles : demander ou être rappelé, toujours sur un propos connu.
 * @impact-areas  product-discovery, discovery-rail, modal-layout, desktop, mobile
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { requestDiscovery } from './discovery-actions.js';
import { sanitize } from './b-utils.js';
import { closeModal } from './b-modal.js';

const SLOT_ID = 'k-modal-discovery-detail';
const STORED_ACTIONS = Object.freeze(['request', 'quote', 'callback', 'call', 'whatsapp']);
const INQUIRY_ACTIONS = Object.freeze(['request', 'callback']);
let _installed = false;

function kindLabelFor(kind) {
  return kind === 'physical_offer' ? 'Offre locale' : 'Service';
}

function statusFor(kind) {
  return kind === 'physical_offer' ? 'Disponible ici' : 'Sur demande';
}

function requestLabelFor(kind) {
  return kind === 'physical_offer' ? 'Pour quand ?' : 'Pour quand ?';
}

function requestPlaceholderFor(kind) {
  return kind === 'physical_offer' ? 'Ex. vendredi soir' : 'Ex. cette semaine';
}

function publicActionFor(raw) {
  const action = String(raw || '').trim().toLowerCase();
  if (!STORED_ACTIONS.includes(action)) return null;
  if (action === 'request' || action === 'quote') return 'request';
  if (action === 'callback' || action === 'call' || action === 'whatsapp') return 'callback';
  return null;
}

function normalizeActions(detail = {}) {
  // Projection legacy : une ancienne fiche sans actions reste demandable.
  if (!Array.isArray(detail.actions)) return ['request'];
  const seen = new Set();
  const actions = [];
  for (const raw of detail.actions) {
    const action = publicActionFor(raw);
    if (!action || seen.has(action)) continue;
    seen.add(action);
    actions.push(action);
  }
  return actions;
}

function actionLabelFor(action, kind) {
  if (action === 'callback') return 'Être rappelé';
  return kind === 'physical_offer' ? 'Demander cette offre' : 'Demander ce service';
}

function subjectFor(detail = {}) {
  const parts = [detail.title, detail.provider_name].filter(Boolean);
  return parts.join(' · ');
}

function requestNotePlaceholderFor(kind) {
  return kind === 'physical_offer'
    ? 'Ex. quantité souhaitée, lieu de livraison, précision utile…'
    : 'Ex. véhicule, panne, dimensions, besoin précis…';
}

function callbackNotePlaceholderFor(detail = {}) {
  return detail.title
    ? `Ex. Je souhaite échanger à propos de « ${detail.title} »…`
    : 'Ajoutez une précision pour le rappel…';
}

function buildActionChooserHTML(kind, ref, actions) {
  if (!actions.length) {
    return '<p class="k-modal-discovery-no-action">Demande momentanément indisponible.</p>';
  }
  return actions.map((action, index) => {
    const label = sanitize(actionLabelFor(action, kind));
    const priorityClass = index === 0 ? ' is-primary' : ' is-secondary';
    return `<button class="k-discovery-cta k-modal-discovery-cta k-modal-discovery-action${priorityClass}" type="button"
      data-discovery-select-action="${sanitize(action)}"
      data-discovery-kind="${sanitize(kind)}"
      data-discovery-ref="${sanitize(ref)}"
      aria-expanded="false">${label}</button>`;
  }).join('');
}

function buildContextFormHTML(kind, ref, detail, action) {
  const isCallback = action === 'callback';
  const subject = subjectFor(detail);
  const noteLabel = isCallback ? 'Une précision pour le rappel' : 'Précisez votre besoin';
  const notePlaceholder = isCallback
    ? callbackNotePlaceholderFor(detail)
    : requestNotePlaceholderFor(kind);
  const timing = isCallback ? '' : `
    <label class="k-modal-discovery-request">
      <span class="k-modal-discovery-request-label">${sanitize(requestLabelFor(kind))} <span>· facultatif</span></span>
      <input class="k-modal-discovery-request-input" type="text" maxlength="160"
        autocomplete="off" spellcheck="true"
        data-discovery-requested-window
        placeholder="${sanitize(requestPlaceholderFor(kind))}">
    </label>`;

  return `<section class="k-modal-discovery-context-form"
      data-discovery-action-form="${sanitize(action)}" hidden>
    <div class="k-modal-discovery-request">
      <span class="k-modal-discovery-request-label">${isCallback ? 'Objet du rappel' : 'Votre demande concerne'}</span>
      <div class="k-modal-discovery-provider" data-discovery-known-subject>${sanitize(subject)}</div>
    </div>
    <label class="k-modal-discovery-request">
      <span class="k-modal-discovery-request-label">${sanitize(noteLabel)} <span>· facultatif</span></span>
      <textarea class="k-modal-discovery-request-input" rows="3" maxlength="600"
        autocomplete="off" spellcheck="true"
        data-discovery-requester-note
        placeholder="${sanitize(notePlaceholder)}"></textarea>
    </label>
    ${timing}
    <button class="k-discovery-cta k-modal-discovery-cta is-primary" type="button"
      data-discovery-submit-action="${sanitize(action)}"
      data-discovery-kind="${sanitize(kind)}"
      data-discovery-ref="${sanitize(ref)}">
      ${isCallback ? 'Demander à être rappelé' : 'Envoyer ma demande'}
    </button>
  </section>`;
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
        <div class="k-modal-discovery-request">
          <span class="k-modal-discovery-request-label">Que souhaitez-vous faire ?</span>
          <div class="k-modal-discovery-actions" aria-label="Actions disponibles">
            ${buildActionChooserHTML(kind, ref, actions)}
          </div>
        </div>
        ${actions.map(action => buildContextFormHTML(kind, ref, detail, action)).join('')}
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

function selectAction(button) {
  const shell = button.closest('.k-modal-discovery-shell');
  if (!shell) return;
  const action = button.dataset.discoverySelectAction;
  if (!INQUIRY_ACTIONS.includes(action)) return;

  shell.querySelectorAll('[data-discovery-select-action]').forEach(candidate => {
    candidate.setAttribute('aria-expanded', candidate === button ? 'true' : 'false');
  });
  shell.querySelectorAll('[data-discovery-action-form]').forEach(form => {
    form.hidden = form.dataset.discoveryActionForm !== action;
  });
  const activeForm = shell.querySelector(`[data-discovery-action-form="${action}"]`);
  activeForm?.querySelector('textarea, input')?.focus();
}

function submitAction(button) {
  const action = button.dataset.discoverySubmitAction;
  const kind = button.dataset.discoveryKind;
  const ref = button.dataset.discoveryRef;
  if (!INQUIRY_ACTIONS.includes(action) || !kind || !ref) return;

  const form = button.closest('[data-discovery-action-form]');
  const requestedWindow = form?.querySelector('[data-discovery-requested-window]')?.value?.trim() || null;
  const requesterNote = form?.querySelector('[data-discovery-requester-note]')?.value?.trim() || null;

  closeModal({ skipHistoryBack: true });
  requestDiscovery(kind, ref, button, requestedWindow, action, requesterNote);
}

function handleAction(event) {
  const selector = event.target.closest('[data-discovery-select-action]');
  if (selector?.matches('button')) {
    selectAction(selector);
    return;
  }

  const submit = event.target.closest('[data-discovery-submit-action][data-discovery-kind][data-discovery-ref]');
  if (submit?.matches('button')) submitAction(submit);
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
  subjectFor,
  publicActionFor,
};
