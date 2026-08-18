/**
 * @komerce-arch
 * @role          boutique-passkey-security
 * @domain        auth-passkey
 * @layer         ui-component
 * @criticality   high
 * @inputs        authenticated_session, safe_credential_metadata
 * @outputs       authenticator_list, credential_revocation_request
 * @depends       b-utils.js, routes/auth-passkey.js
 * @used-by       b-komerce.js
 * @doctrine      auth6_authenticator_management, safe_metadata_only
 * @impact-areas  account-security, auth
 * @version       2026-08
 */
'use strict';

import { apiGet, apiDelete } from './b-utils.js';
import { withStepUpRetry } from './b-passkey-step-up.js';

function fmtWhen(iso) {
  if (!iso) return 'Jamais utilisée';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Aujourd’hui";
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderEmpty(container) {
  container.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'k-kmc-field-hint';
  empty.textContent = 'Aucune passkey active. Vous pourrez en créer une après une validation sensible par WhatsApp.';
  container.appendChild(empty);
}

function renderError(container, retry) {
  container.replaceChildren();
  const msg = document.createElement('p');
  msg.className = 'k-kmc-save-status';
  msg.textContent = '⚠️ Impossible de charger vos moyens de connexion.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'k-kmc-action-btn k-kmc-action-btn--secondary';
  btn.textContent = 'Réessayer';
  btn.addEventListener('click', retry);
  container.append(msg, btn);
}

function renderCredentials(container, credentials) {
  container.replaceChildren();
  if (!credentials.length) {
    renderEmpty(container);
    return;
  }

  const list = document.createElement('div');
  list.className = 'k-kmc-passkey-list';

  credentials.forEach(credential => {
    const row = document.createElement('article');
    row.className = 'k-kmc-passkey-row';
    row.dataset.credentialId = credential.id;

    const info = document.createElement('div');
    info.className = 'k-kmc-passkey-info';
    const label = document.createElement('strong');
    label.textContent = credential.device_label || 'Passkey';
    const meta = document.createElement('span');
    meta.textContent = credential.last_used_at
      ? `Dernière utilisation : ${fmtWhen(credential.last_used_at)}`
      : `Ajoutée : ${fmtWhen(credential.created_at)}`;
    const sync = document.createElement('small');
    sync.textContent = credential.backup_state ? 'Synchronisée' : 'Sur cet appareil';
    info.append(label, meta, sync);

    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'k-kmc-action-btn k-kmc-action-btn--danger';
    revoke.textContent = 'Révoquer';
    revoke.setAttribute('aria-label', `Révoquer ${label.textContent}`);
    revoke.addEventListener('click', async () => {
      if (!window.confirm(`Révoquer ${label.textContent} ? Cette passkey ne pourra plus servir à vous connecter.`)) return;
      revoke.disabled = true;
      revoke.textContent = 'Révocation…';
      try {
        await withStepUpRetry(
          () => apiDelete(`/api/auth/passkey/credentials/${encodeURIComponent(credential.id)}`),
          {
            reason: 'révoquer cette passkey',
            title: 'Confirmer la révocation',
            // L'utilisateur vient volontairement de retirer une Passkey : ne
            // jamais lui en reproposer une immédiatement après l'OTP.
            offerEnrollmentAfterOtp: false,
          }
        );
        row.remove();
        if (!list.children.length) renderEmpty(container);
      } catch (_) {
        revoke.disabled = false;
        revoke.textContent = 'Réessayer';
      }
    });

    row.append(info, revoke);
    list.appendChild(row);
  });

  container.appendChild(list);
}

export async function loadPasskeySecurity(container) {
  if (!container) return;
  container.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'k-kmc-field-hint';
  loading.textContent = 'Chargement des moyens de connexion…';
  container.appendChild(loading);

  try {
    const payload = await apiGet('/api/auth/passkey/credentials');
    const credentials = Array.isArray(payload?.credentials) ? payload.credentials : [];
    renderCredentials(container, credentials);
  } catch (_) {
    renderError(container, () => loadPasskeySecurity(container));
  }
}
