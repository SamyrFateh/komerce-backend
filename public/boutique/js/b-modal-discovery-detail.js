/**
 * @komerce-arch-lite
 * @role          catalog-modal-discovery-detail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Rendre Physical Offer / Service dans l'unique shell #k-modal ; Service possède une surface dédiée et peut handoff vers WhatsApp après création de l'Inquiry.
 * @impact-areas  product-discovery, discovery-rail, modal-layout, desktop, mobile
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { requestDiscovery } from './discovery-actions.js';
import { sanitize } from './b-utils.js';
import { closeModal } from './b-modal.js';

const SLOT_ID = 'k-modal-discovery-detail';
const SERVICE_STYLE_ID = 'k-service-detail-style';
const SERVICE_STYLE_HREF = '/boutique/css/dist/service-detail.css?v=20260920';
const STORED_ACTIONS = Object.freeze(['request', 'quote', 'callback', 'call', 'whatsapp']);
const INQUIRY_ACTIONS = Object.freeze(['request', 'callback']);
let _installedSlot = null;
let _busInstalled = false;

function ensureServiceDetailStyles() {
  if (document.getElementById(SERVICE_STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = SERVICE_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = SERVICE_STYLE_HREF;
  document.head.appendChild(link);
}

function kindLabelFor(kind) {
  return kind === 'physical_offer' ? 'Offre locale' : 'Service local';
}

function statusFor(kind) {
  return kind === 'physical_offer' ? 'Disponible ici' : 'Près de vous';
}

function requestLabelFor() {
  return 'Pour quand ?';
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

function isIllustrativeDemo(detail) {
  return String(detail.provider_name || '').trim().toUpperCase().startsWith('[STAGING]');
}

function buildImage(detail, service = false) {
  const imageClass = service ? 'k-service-detail-img' : 'k-modal-discovery-img';
  const fallbackClass = service ? 'k-service-detail-media-fallback' : 'k-modal-discovery-media-fallback';
  const alt = isIllustrativeDemo(detail)
    ? `Photo illustrative de la prestation « ${detail.title} », non prise chez le prestataire`
    : detail.title;
  return detail.image_ref
    ? `<img class="${imageClass}" src="${sanitize(detail.image_ref)}" alt="${sanitize(alt)}" loading="lazy" decoding="async">`
    : `<div class="${fallbackClass}" aria-hidden="true">K</div>`;
}

function buildProvider(detail) {
  if (detail.provider_name) {
    return `<div class="k-modal-discovery-provider">${sanitize(detail.provider_name)}${detail.zone ? ` · ${sanitize(detail.zone)}` : ''}</div>`;
  }
  return detail.zone ? `<div class="k-modal-discovery-provider">${sanitize(detail.zone)}</div>` : '';
}

function buildDescription(detail) {
  return detail.description
    ? `<p class="k-modal-discovery-desc">${sanitize(detail.description)}</p>`
    : '';
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

function buildServiceIdentity(detail) {
  const provider = detail.provider_name
    ? `<span class="k-service-detail-provider-name">${sanitize(detail.provider_name)}</span>`
    : '';
  const zone = detail.zone
    ? `<span class="k-service-detail-zone"><span aria-hidden="true">⌖</span>${sanitize(detail.zone)}</span>`
    : '';
  if (!provider && !zone) return '';
  return `<div class="k-service-detail-identity">${zone}${provider}</div>`;
}

// Le service n'expose qu'un seul parcours visible : contacter le prestataire.
// Le canal WhatsApp, lorsqu'il existe, réutilise la même création d'Inquiry.
function buildServiceHowItWorks(whatsappAvailable) {
  return `
    <section class="k-service-detail-how" aria-labelledby="k-service-how-title">
      <div class="k-service-detail-how-title"><span aria-hidden="true">i</span><strong id="k-service-how-title">Comment ça marche ?</strong></div>
      <ol>
        <li><span>1</span>Expliquez votre besoin</li>
        <li><span>2</span>Komerce enregistre votre demande</li>
        <li><span>3</span>${whatsappAvailable ? 'Discutez avec le prestataire' : 'Le prestataire vous répond'}</li>
      </ol>
    </section>`;
}

function buildServiceContact(ref, detail) {
  const whatsappAvailable = detail.whatsapp_available === true;
  const actions = normalizeActions(detail);
  if (!whatsappAvailable && !actions.length) {
    return '<p class="k-modal-discovery-no-action">Contact momentanément indisponible.</p>';
  }
  return `
    <div class="k-service-detail-conversion">
      <label class="k-service-detail-note">
        <span>Votre besoin <small>(facultatif)</small></span>
        <textarea class="k-service-detail-note-input" rows="2" maxlength="600"
          autocomplete="off" spellcheck="true"
          data-discovery-service-note
          placeholder="Ex. J’ai une fuite d’eau dans la cuisine"></textarea>
      </label>
      <button class="k-service-detail-contact" type="button"
        data-discovery-service-contact
        data-discovery-kind="service"
        data-discovery-ref="${sanitize(ref)}"
        ${whatsappAvailable ? 'data-discovery-handoff="whatsapp"' : ''}>
        Contacter le prestataire <span aria-hidden="true">→</span>
      </button>
      <p class="k-service-detail-handoff-note">
        ${whatsappAvailable
          ? 'Votre demande est enregistrée avant l’ouverture de WhatsApp.'
          : 'Komerce transmet votre demande au prestataire.'}
      </p>
    </div>`;
}

function buildServiceDetailHTML(ref, detail) {
  ensureServiceDetailStyles();
  const image = buildImage(detail, true);
  const identity = buildServiceIdentity(detail);
  const description = buildDescription(detail);
  const whatsappAvailable = detail.whatsapp_available === true;
  const illustrative = isIllustrativeDemo(detail);

  return `
    <article class="k-service-detail-shell">
      <div class="k-service-detail-left">
        <div class="k-service-detail-media">${image}</div>
      </div>
      <div class="k-service-detail-body">
        <div class="k-service-detail-heading-row">
          <span class="k-service-detail-eyebrow">Service local${illustrative ? ' · Photo illustrative (démo)' : ''}</span>
        </div>
        <h2 class="k-service-detail-title">${sanitize(detail.title)}</h2>
        ${identity}
        ${description}
        ${buildServiceContact(ref, detail)}
        ${buildServiceHowItWorks(whatsappAvailable)}
      </div>
    </article>`;
}

function buildPhysicalOfferDetailHTML(ref, detail) {
  const image = buildImage(detail, false);
  const provider = buildProvider(detail);
  const description = buildDescription(detail);
  const actions = normalizeActions(detail);

  return `
    <div class="k-modal-discovery-shell">
      <div class="k-modal-discovery-media">${image}</div>
      <div class="k-modal-discovery-body">
        <div class="k-modal-discovery-meta" aria-label="Type et disponibilité">
          <span class="k-modal-discovery-badge k-modal-discovery-kind">${sanitize(kindLabelFor('physical_offer'))}</span>
          <span class="k-modal-discovery-badge">${isIllustrativeDemo(detail) ? 'Photo illustrative · démo' : sanitize(statusFor('physical_offer'))}</span>
        </div>
        <h2 class="k-modal-discovery-title">${sanitize(detail.title)}</h2>
        ${provider}
        ${description}
        <div class="k-modal-discovery-request">
          <span class="k-modal-discovery-request-label">Que souhaitez-vous faire ?</span>
          <div class="k-modal-discovery-actions" aria-label="Actions disponibles">
            ${buildActionChooserHTML('physical_offer', ref, actions)}
          </div>
        </div>
        ${actions.map(action => buildContextFormHTML('physical_offer', ref, detail, action)).join('')}
      </div>
    </div>`;
}

function buildDetailHTML(kind, ref, detail) {
  return kind === 'service'
    ? buildServiceDetailHTML(ref, detail)
    : buildPhysicalOfferDetailHTML(ref, detail);
}

function syncServiceShellClasses(slot, isService) {
  const modal = slot.closest('.k-modal');
  const overlay = slot.closest('.k-modal-overlay');
  modal?.classList.toggle('k-modal--service', isService);
  overlay?.classList.toggle('k-modal-overlay--service', isService);
}

export function renderDiscoveryModalDetail(payload) {
  const slot = document.getElementById(SLOT_ID);
  if (!slot || !payload) return false;
  const { kind, ref, detail } = payload;
  if ((kind !== 'service' && kind !== 'physical_offer') || !ref || !detail?.title) return false;

  syncServiceShellClasses(slot, kind === 'service');
  slot.dataset.discoveryKind = kind;
  slot.innerHTML = buildDetailHTML(kind, ref, detail);
  slot.hidden = false;
  return true;
}

export function clearDiscoveryModalDetail() {
  const slot = document.getElementById(SLOT_ID);
  if (!slot) return;
  syncServiceShellClasses(slot, false);
  slot.hidden = true;
  slot.innerHTML = '';
  delete slot.dataset.discoveryKind;
}

function selectAction(button) {
  const shell = button.closest('.k-modal-discovery-shell, .k-service-detail-shell');
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

function submitServiceContact(button) {
  const ref = button.dataset.discoveryRef;
  if (!ref) return;
  const shell = button.closest('.k-service-detail-shell');
  const requesterNote = shell?.querySelector('[data-discovery-service-note]')?.value?.trim() || null;
  const handoff = button.dataset.discoveryHandoff === 'whatsapp' ? 'whatsapp' : null;
  closeModal({ skipHistoryBack: true });
  requestDiscovery('service', ref, button, null, 'request', requesterNote, handoff);
}

function handleAction(event) {
  const serviceContact = event.target.closest('[data-discovery-service-contact][data-discovery-ref]');
  if (serviceContact?.matches('button')) {
    submitServiceContact(serviceContact);
    return;
  }

  const selector = event.target.closest('[data-discovery-select-action]');
  if (selector?.matches('button')) {
    selectAction(selector);
    return;
  }

  const submit = event.target.closest('[data-discovery-submit-action][data-discovery-kind][data-discovery-ref]');
  if (submit?.matches('button')) submitAction(submit);
}

export function setupDiscoveryModalDetail() {
  const slot = document.getElementById(SLOT_ID);
  if (slot && slot !== _installedSlot) {
    _installedSlot?.removeEventListener('click', handleAction);
    slot.addEventListener('click', handleAction);
    _installedSlot = slot;
  }

  if (_busInstalled) return;
  _busInstalled = true;
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
