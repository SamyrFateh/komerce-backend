/**
 * @komerce-arch
 * @role          boutique-account-view
 * @domain        account
 * @layer         ui-page
 * @criticality   medium
 * @inputs        client_session, wallet_balance, private_documents, profile
 * @outputs       komerce_view, authenticated_pdf_download
 * @depends       b-utils.js, b-identity.js, b-bus.js, documents API, wallet API
 * @used-by       b-nav.js, boutique.js
 * @doctrine      wallet_visible_client, navigation_sans_friction, otp_une_fois
 * @impact-areas  account, wallet, documents, boutique-navigation
 * @version       2026-08-documents
 */
'use strict';

/**
 * @module b-komerce
 * @brief Mon Komerce — page personnelle unique (Lot 4B, étendue Lot 5).
 *
 * Doctrine : Mon Komerce est une seule page, sans sous-onglet, sans menu
 * secondaire. Sans session, la page explique pourquoi s'identifier et ne
 * déclenche l'authentification qu'après un clic explicite.
 *
 *   Mes documents essentiels (factures et remboursements)
 *   Mon wallet (solde compact, sans historique de mouvements)
 *   Mon profil  (nom, email lecture seule, WhatsApp du compte, devise)
 *   Retrait & sécurité (code de retrait informatif + autorisation
 *     nominative de retrait exceptionnel — Lot 5, états NONE/ACTIVE)
 *
 * Point d'entrée canonique : openMonKomerce({ focus })
 *   focus = 'wallet' → scroll jusqu'au bloc wallet après chargement.
 */

import { apiGet, apiPut, apiDelete, apiDownload } from './b-utils.js';
import { getCurrentIdentity, requireIdentity, restoreIdentity } from './b-identity.js';
import { bus } from './b-bus.js';
import { loadPasskeySecurity } from './b-passkey-security.js';
import { withStepUpRetry } from './b-passkey-step-up.js';

// ── État interne ───────────────────────────────────────────────────────────────

let _renderSeq = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isAuthErr(e) {
  return e && (e.status === 401 || e.status === 403);
}

function maskPhone(phone) {
  const v = String(phone || '').trim();
  if (!v) return '';
  if (v.length <= 6) return v;
  return v.slice(0, 4) + '\u2022\u2022\u2022\u2022' + v.slice(-2);
}

function fmtDateFr(iso) {
  if (!iso) return null;
  try {
    const raw = String(iso);
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) { return null; }
}

// ── Shell (unique, créé une seule fois) ────────────────────────────────────────

function ensureShell() {
  let el = document.getElementById('k-komerce-view');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'k-komerce-view';
  el.className = 'k-komerce-view';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-label', 'Mon Komerce');
  el.innerHTML = /* LOT4B_STATIC_ACCOUNT_SHELL */
    '<header class="k-kmc-header">' +
      '<h2 class="k-kmc-title">Mon Komerce</h2>' +
      '<p class="k-kmc-subtitle">Compte personnel prot\u00e9g\u00e9</p>' +
    '</header>' +
    '<div class="k-kmc-page-grid">' +
      '<div class="k-kmc-col-primary">' +
        '<section id="k-kmc-documents-block" class="k-kmc-block" aria-label="Mes documents"></section>' +
        '<section id="k-kmc-wallet-block" class="k-kmc-block k-kmc-block--compact" aria-label="Mon wallet"></section>' +
      '</div>' +
      '<div class="k-kmc-col-secondary">' +
        '<section id="k-kmc-profile-block" class="k-kmc-block" aria-label="Mon profil"></section>' +
        '<section id="k-kmc-security-block" class="k-kmc-block" aria-label="Retrait et s\u00e9curit\u00e9"></section>' +
      '</div>' +
    '</div>';

  // "Mes listes" retiré de Mon Komerce (2026-08) : ce raccourci ne faisait
  // que rediriger vers l'onglet Suivi > Listes, donnant l'impression de deux
  // endroits différents pour la même chose. Suivi reste l'unique entrée.

  const anchor = document.getElementById('k-track-view')
    || document.getElementById('k-fav-view')
    || document.getElementById('k-catalog-section');
  if (anchor) anchor.after(el);
  else document.body.appendChild(el);

  return el;
}

// ── États partagés ────────────────────────────────────────────────────────────

function renderBlockLoading(block) {
  block.innerHTML = /* LOT4B_STATIC_LOADING */
    '<div class="k-kmc-loading">' +
      '<div class="k-kmc-spin"></div>' +
      '<p>Chargement\u2026</p>' +
    '</div>';
}

function renderBlockError(block, err, onRetry) {
  const isTimeout = !!(err && (err.isTimeout || err.name === 'TimeoutError'));
  block.innerHTML = /* LOT4B_STATIC_ERROR */
    '<div class="k-kmc-empty">' +
      '<div class="k-kmc-empty-icon">\u26a0\ufe0f</div>' +
      '<div class="k-kmc-empty-title">' +
        (isTimeout ? 'Cela met trop de temps \u00e0 r\u00e9pondre' : 'Impossible de charger') +
      '</div>' +
      '<div class="k-kmc-empty-sub">V\u00e9rifiez votre connexion puis r\u00e9essayez.</div>' +
      '<button class="k-kmc-action-btn" id="k-kmc-retry">\ud83d\udd04 R\u00e9essayer</button>' +
    '</div>';
  block.querySelector('#k-kmc-retry')?.addEventListener('click', onRetry);
}

function renderSessionExpired() {
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const documentsBlock = document.getElementById('k-kmc-documents-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  [walletBlock, documentsBlock, profileBlock, secBlock].forEach(b => { if (b) b.replaceChildren(); });
  if (walletBlock) {
    walletBlock.innerHTML = /* LOT4B_STATIC_REAUTH */
      '<div class="k-kmc-empty">' +
        '<div class="k-kmc-empty-icon">\ud83d\udd10</div>' +
        '<div class="k-kmc-empty-title">Session expir\u00e9e</div>' +
        '<div class="k-kmc-empty-sub">Confirmez votre num\u00e9ro WhatsApp pour continuer.</div>' +
        '<button class="k-kmc-action-btn" id="k-kmc-reauth">\ud83d\udcf2 M\u2019identifier</button>' +
      '</div>';
    walletBlock.querySelector('#k-kmc-reauth')?.addEventListener('click', async () => {
      const btn = walletBlock.querySelector('#k-kmc-reauth');
      btn.disabled = true;
      btn.textContent = '\u23f3 Identification\u2026';
      const user = await requireIdentity({ reason: 'mon-komerce', title: 'Mon Komerce' });
      if (user) _loadAndRender(++_renderSeq);
      else { btn.disabled = false; btn.textContent = '\ud83d\udcf2 M\u2019identifier'; }
    });
  }
}

function focusRequestedBlock(focus) {
  if (focus !== 'wallet') return;
  requestAnimationFrame(() => {
    document.getElementById('k-kmc-wallet-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderIdentityRequired({ focus = null } = {}) {
  const documentsBlock = document.getElementById('k-kmc-documents-block');
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  const blocks = [documentsBlock, walletBlock, profileBlock, secBlock];

  blocks.forEach((block) => {
    if (!block) return;
    block.replaceChildren();
    block.hidden = block !== documentsBlock;
  });

  if (!documentsBlock) return;
  documentsBlock.innerHTML = /* LOT4B_STATIC_IDENTITY_REQUIRED */
    '<div class="k-kmc-empty">' +
      '<div class="k-kmc-empty-icon">\ud83d\udd10</div>' +
      '<div class="k-kmc-empty-title">Identifiez-vous pour acc\u00e9der \u00e0 Mon Komerce</div>' +
      '<div class="k-kmc-empty-sub">Retrouvez vos documents, votre wallet et vos informations personnelles.</div>' +
      '<button class="k-kmc-action-btn" id="k-kmc-identify">M\u2019identifier</button>' +
    '</div>';

  documentsBlock.querySelector('#k-kmc-identify')?.addEventListener('click', async () => {
    const btn = documentsBlock.querySelector('#k-kmc-identify');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '\u23f3 Identification\u2026';

    const user = await requireIdentity({ reason: 'mon-komerce', title: 'Acc\u00e9der \u00e0 Mon Komerce' });
    if (user) {
      _loadAndRender(++_renderSeq);
      focusRequestedBlock(focus);
      return;
    }

    btn.disabled = false;
    btn.textContent = 'M\u2019identifier';
  });
}

// ── Bloc wallet compact ───────────────────────────────────────────────────────

function renderWalletBlock(block, wallet) {
  const balance = Number(wallet?.balance_kmf ?? 0);
  const expiry = fmtDateFr(wallet?.expires_at);
  block.replaceChildren();

  const title = document.createElement('h3');
  title.className = 'k-kmc-block-title';
  title.textContent = 'Mon wallet';
  block.appendChild(title);

  const summary = document.createElement('div');
  summary.className = 'k-kmc-wallet-summary';
  const amount = document.createElement('strong');
  amount.textContent = `${balance.toLocaleString('fr-FR')} KMF`;
  const detail = document.createElement('span');
  detail.textContent = balance > 0
    ? (expiry ? `Utilisable jusqu’au ${expiry}` : 'Solde disponible')
    : 'Aucun solde disponible';
  summary.append(amount, detail);
  block.appendChild(summary);
}

async function loadWalletBlock(block) {
  if (!block) return;
  renderBlockLoading(block);
  try {
    renderWalletBlock(block, await apiGet('/api/wallet'));
  } catch (err) {
    renderBlockError(block, err, () => loadWalletBlock(block));
  }
}

// ── Bloc documents privés ────────────────────────────────────────────────────

const DOCUMENT_LABELS = {
  invoice: 'Facture',
  refund_receipt: 'Remboursement',
};

function renderDocumentsBlock(block, documents) {
  const essentialDocuments = documents.filter((row) => DOCUMENT_LABELS[row?.document_type]);
  block.replaceChildren();
  const title = document.createElement('h3');
  title.className = 'k-kmc-block-title';
  title.textContent = 'Mes documents';
  block.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'k-kmc-documents-hint';
  hint.textContent = 'Vos justificatifs restent privés et se téléchargent depuis votre compte.';
  block.appendChild(hint);

  if (!essentialDocuments.length) {
    const empty = document.createElement('div');
    empty.className = 'k-kmc-documents-empty';
    empty.textContent = 'Aucun document disponible pour le moment.';
    block.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'k-kmc-documents-list';
  essentialDocuments.forEach((documentRow) => {
    const row = document.createElement('article');
    row.className = 'k-kmc-document-row';

    const info = document.createElement('div');
    info.className = 'k-kmc-document-info';
    const name = document.createElement('strong');
    name.textContent = DOCUMENT_LABELS[documentRow.document_type] || 'Document';
    const reference = document.createElement('span');
    reference.textContent = documentRow.reference || '—';
    const meta = document.createElement('small');
    const parts = [fmtDateFr(documentRow.issued_at)];
    if (documentRow.amount_kmf != null) {
      parts.push(`${Number(documentRow.amount_kmf).toLocaleString('fr-FR')} KMF`);
    }
    meta.textContent = parts.filter(Boolean).join(' · ');
    info.append(name, reference, meta);

    row.appendChild(info);
    if (documentRow.download_url) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'k-kmc-document-download';
      button.textContent = 'Télécharger';
      button.setAttribute('aria-label', `Télécharger ${name.textContent} ${reference.textContent}`);
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Préparation…';
        try {
          const file = await apiDownload(documentRow.download_url, { timeoutMs: 20000 });
          const url = URL.createObjectURL(file.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = file.filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        } catch (err) {
          button.textContent = err && err.status === 401 ? 'Session expirée' : 'Réessayer';
          return;
        } finally {
          button.disabled = false;
          if (button.textContent === 'Préparation…') button.textContent = original;
        }
      });
      row.appendChild(button);
    } else {
      const pending = document.createElement('span');
      pending.className = 'k-kmc-document-pending';
      pending.textContent = 'En préparation';
      row.appendChild(pending);
    }
    list.appendChild(row);
  });
  block.appendChild(list);
}

async function loadDocumentsBlock(block) {
  if (!block) return;
  renderBlockLoading(block);
  try {
    const payload = await apiGet('/api/auth/me/documents');
    renderDocumentsBlock(block, Array.isArray(payload?.documents) ? payload.documents : []);
  } catch (err) {
    renderBlockError(block, err, () => loadDocumentsBlock(block));
  }
}

// ── Bloc profil (nom + devise + email lecture seule + WhatsApp du compte) ──────

function renderProfileBlock(block, me) {
  const phone     = maskPhone(me?.phone);
  const fullName0 = me?.full_name || '';
  const currency0 = me?.currency_pref === 'EUR' ? 'EUR' : 'KMF';

  // Note : email non modifiable — PUT /api/auth/me n'accepte que full_name et
  // currency_pref. Email affiché en lecture seule si présent, sinon omis.
  block.innerHTML = /* LOT4B_STATIC_PROFILE_SHELL */
    '<form class="k-kmc-form" id="k-kmc-profile-form" novalidate>' +
      '<h3 class="k-kmc-block-title">Mon profil</h3>' +
      '<label class="k-kmc-field">' +
        '<span>Nom complet</span>' +
        '<input type="text" id="k-kmc-fullname" maxlength="100" autocomplete="name">' +
      '</label>' +
      (me?.email
        ? '<label class="k-kmc-field k-kmc-field--readonly">' +
            '<span>Email</span>' +
            '<input type="text" id="k-kmc-email" disabled aria-readonly="true">' +
          '</label>'
        : '') +
      '<label class="k-kmc-field k-kmc-field--readonly">' +
        '<span>WhatsApp du compte</span>' +
        '<input type="text" id="k-kmc-account-phone" disabled aria-readonly="true">' +
      '</label>' +
      '<p class="k-kmc-field-hint">Le WhatsApp du compte ne se modifie pas ici \u2014 il se confirme par code lors d\u2019une prochaine commande.</p>' +
      '<label class="k-kmc-field">' +
        '<span>Devise d\u2019affichage</span>' +
        '<select id="k-kmc-currency">' +
          '<option value="KMF"' + (currency0 === 'KMF' ? ' selected' : '') + '>Franc comorien (KMF)</option>' +
          '<option value="EUR"' + (currency0 === 'EUR' ? ' selected' : '') + '>Euro (EUR)</option>' +
        '</select>' +
      '</label>' +
      '<p class="k-kmc-save-status" id="k-kmc-save-status" role="status" aria-live="polite"></p>' +
      '<button type="submit" class="k-kmc-action-btn" id="k-kmc-profile-save" disabled>' +
        'Enregistrer mes modifications' +
      '</button>' +
    '</form>';

  const form     = block.querySelector('#k-kmc-profile-form');
  const nameInput = block.querySelector('#k-kmc-fullname');
  const curSelect = block.querySelector('#k-kmc-currency');
  const saveBtn   = block.querySelector('#k-kmc-profile-save');
  const status    = block.querySelector('#k-kmc-save-status');
  const emailInput = block.querySelector('#k-kmc-email');
  const phoneInput = block.querySelector('#k-kmc-account-phone');

  // Données API assignées comme propriétés DOM : jamais interpolées dans HTML.
  nameInput.value = String(fullName0);
  if (emailInput) emailInput.value = String(me?.email || '');
  if (phoneInput) phoneInput.value = phone || '\u2014';

  let pendingSubmit = false;

  function checkDirty() {
    const dirty = nameInput.value.trim() !== fullName0 || curSelect.value !== currency0;
    saveBtn.disabled = !dirty || pendingSubmit;
  }

  nameInput.addEventListener('input', checkDirty);
  curSelect.addEventListener('change', checkDirty);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pendingSubmit || saveBtn.disabled) return;
    const newName     = nameInput.value.trim();
    const newCurrency = curSelect.value;
    if (!newName) { nameInput.focus(); return; }

    pendingSubmit = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement\u2026';
    status.textContent = '';

    try {
      await apiPut('/api/auth/me', { full_name: newName, currency_pref: newCurrency });
      status.textContent = '\u2705 Enregistr\u00e9';
      // Update baselines so dirty-check reflects new state
      // (re-render not needed; keep form values as-is)
    } catch (_) {
      status.textContent = '\u26a0\ufe0f \u00c9chec \u2014 r\u00e9essayez';
      saveBtn.disabled = false;
    } finally {
      pendingSubmit = false;
      saveBtn.textContent = 'Enregistrer mes modifications';
      checkDirty();
    }
  });
}

// ── Bloc retrait & sécurité (code informatif + autorisation nominative Lot 5) ──

function renderSecurityBlock(block, me) {
  const phone = maskPhone(me?.phone);
  block.innerHTML = /* LOT4B_STATIC_SECURITY_SHELL */
    '<div class="k-kmc-security">' +
      '<h3 class="k-kmc-block-title">Retrait &amp; s\u00e9curit\u00e9</h3>' +
      '<div class="k-kmc-sec-row">' +
        '<span class="k-kmc-sec-label">WhatsApp du compte</span>' +
        '<span class="k-kmc-sec-value" id="k-kmc-security-phone"></span>' +
      '</div>' +
      '<div class="k-kmc-auth-block" id="k-kmc-passkeys-block">' +
        '<h4 class="k-kmc-auth-title">Moyens de connexion</h4>' +
        '<p class="k-kmc-field-hint">Vos passkeys permettent de vous connecter sans code WhatsApp. Révoquez uniquement un appareil que vous ne souhaitez plus autoriser.</p>' +
        '<div id="k-kmc-passkeys-content"></div>' +
      '</div>' +
      '<div class="k-kmc-sec-doctrine">' +
        '<p>Le code de retrait est envoy\u00e9 sur votre WhatsApp lorsque votre commande est pr\u00eate au relais. Vous pouvez le transmettre \u00e0 la personne de votre choix.</p>' +
        '<p>Ce code est personnel et unique \u00e0 chaque commande : ne le partagez qu\u2019avec la personne qui viendra r\u00e9cup\u00e9rer votre colis.</p>' +
      '</div>' +
      '<div class="k-kmc-auth-block" id="k-kmc-auth-block">' +
        '<h4 class="k-kmc-auth-title">Autorisation de retrait exceptionnel</h4>' +
        '<p class="k-kmc-field-hint">Si le code n\u2019a pas \u00e9t\u00e9 re\u00e7u ou transmis, vous pouvez autoriser nomm\u00e9ment une personne \u2014 l\u2019agent relais contr\u00f4lera sa pi\u00e8ce d\u2019identit\u00e9 et comparera le nom, sans jamais conna\u00eetre \u00e0 l\u2019avance le nom attendu.</p>' +
        '<div id="k-kmc-auth-content"></div>' +
      '</div>' +
    '</div>';
  const phoneValue = block.querySelector('#k-kmc-security-phone');
  if (phoneValue) phoneValue.textContent = phone || '\u2014';

  loadPasskeySecurity(block.querySelector('#k-kmc-passkeys-content'));
  _loadAuthSection(block.querySelector('#k-kmc-auth-content'));
}

// ── Sous-bloc autorisation nominative (Lot 5) ───────────────────────────────
// États : NONE (aucune autorisation active) / ACTIVE (résumé + modifier/supprimer).
// Jamais d'interpolation HTML des noms saisis/renvoyés — assignation via
// .textContent / .value uniquement, même doctrine que le bloc profil.

async function _loadAuthSection(container) {
  if (!container) return;
  renderBlockLoading(container);
  let data = null, err = null;
  try { data = await apiGet('/api/auth/me/pickup-authorization'); }
  catch (e) { err = e; }

  if (err) {
    renderBlockError(container, err, () => _loadAuthSection(container));
    return;
  }

  if (data && data.status === 'ACTIVE') _renderAuthActive(container, data);
  else _renderAuthForm(container, null);
}

function _renderAuthActive(container, data) {
  container.innerHTML = /* LOT5_STATIC_AUTH_ACTIVE */
    '<div class="k-kmc-sec-row">' +
      '<span class="k-kmc-sec-label">Personne autoris\u00e9e</span>' +
      '<span class="k-kmc-sec-value" id="k-kmc-auth-name">' +
        '<span id="k-kmc-auth-given"></span> <span id="k-kmc-auth-family"></span>' +
      '</span>' +
    '</div>' +
    (fmtDateFr(data.updated_at)
      ? '<p class="k-kmc-field-hint" id="k-kmc-auth-updated"></p>'
      : '') +
    '<p class="k-kmc-save-status" id="k-kmc-auth-status" role="status" aria-live="polite"></p>' +
    '<div class="k-kmc-auth-actions">' +
      '<button type="button" class="k-kmc-action-btn k-kmc-action-btn--secondary" id="k-kmc-auth-edit">Modifier</button>' +
      '<button type="button" class="k-kmc-action-btn k-kmc-action-btn--danger" id="k-kmc-auth-delete">Supprimer</button>' +
    '</div>';

  const givenEl  = container.querySelector('#k-kmc-auth-given');
  const familyEl = container.querySelector('#k-kmc-auth-family');
  if (givenEl)  givenEl.textContent  = data.given_names;
  if (familyEl) familyEl.textContent = data.family_name;
  const updatedEl = container.querySelector('#k-kmc-auth-updated');
  if (updatedEl) updatedEl.textContent = `Enregistr\u00e9e le ${fmtDateFr(data.updated_at)}.`;

  container.querySelector('#k-kmc-auth-edit')?.addEventListener('click', () => {
    _renderAuthForm(container, { given_names: data.given_names, family_name: data.family_name });
  });

  container.querySelector('#k-kmc-auth-delete')?.addEventListener('click', async () => {
    const btn = container.querySelector('#k-kmc-auth-delete');
    const status = container.querySelector('#k-kmc-auth-status');
    if (!window.confirm('Supprimer cette autorisation de retrait exceptionnel ?')) return;
    btn.disabled = true;
    try {
      await withStepUpRetry(() => apiDelete('/api/auth/me/pickup-authorization'));
      _renderAuthForm(container, null);
    } catch (_) {
      btn.disabled = false;
      if (status) status.textContent = '\u26a0\ufe0f \u00c9chec \u2014 r\u00e9essayez';
    }
  });
}

function _renderAuthForm(container, prefill) {
  const isEdit = !!prefill;
  container.innerHTML = /* LOT5_STATIC_AUTH_FORM */
    '<form class="k-kmc-form" id="k-kmc-auth-form">' +
      '<label class="k-kmc-field">' +
        '<span>Pr\u00e9nom(s)</span>' +
        '<input type="text" id="k-kmc-auth-given" maxlength="100" autocomplete="off">' +
      '</label>' +
      '<label class="k-kmc-field">' +
        '<span>Nom de famille</span>' +
        '<input type="text" id="k-kmc-auth-family" maxlength="100" autocomplete="off">' +
      '</label>' +
      '<p class="k-kmc-field-hint">Saisissez le nom exactement tel qu\u2019il figure sur la pi\u00e8ce d\u2019identit\u00e9 de la personne autoris\u00e9e.</p>' +
      '<p class="k-kmc-save-status" id="k-kmc-auth-status" role="status" aria-live="polite"></p>' +
      '<div class="k-kmc-auth-actions">' +
        (isEdit ? '<button type="button" class="k-kmc-action-btn k-kmc-action-btn--secondary" id="k-kmc-auth-cancel">Annuler</button>' : '') +
        '<button type="submit" class="k-kmc-action-btn" id="k-kmc-auth-save" disabled>' +
          (isEdit ? 'Enregistrer les modifications' : 'Enregistrer l\u2019autorisation') +
        '</button>' +
      '</div>' +
    '</form>';

  const form      = container.querySelector('#k-kmc-auth-form');
  const givenInput  = container.querySelector('#k-kmc-auth-given');
  const familyInput = container.querySelector('#k-kmc-auth-family');
  const saveBtn   = container.querySelector('#k-kmc-auth-save');
  const status    = container.querySelector('#k-kmc-auth-status');

  givenInput.value  = prefill ? String(prefill.given_names) : '';
  familyInput.value = prefill ? String(prefill.family_name) : '';

  function checkFilled() {
    saveBtn.disabled = !givenInput.value.trim() || !familyInput.value.trim();
  }
  givenInput.addEventListener('input', checkFilled);
  familyInput.addEventListener('input', checkFilled);
  checkFilled();

  container.querySelector('#k-kmc-auth-cancel')?.addEventListener('click', () => {
    _loadAuthSection(container);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveBtn.disabled) return;
    const givenNames = givenInput.value.trim();
    const familyName  = familyInput.value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement\u2026';
    status.textContent = '';

    try {
      const result = await withStepUpRetry(() => apiPut('/api/auth/me/pickup-authorization', {
        given_names: givenNames, family_name: familyName,
      }));
      _renderAuthActive(container, result);
    } catch (_) {
      status.textContent = '\u26a0\ufe0f \u00c9chec \u2014 r\u00e9essayez';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Enregistrer les modifications' : 'Enregistrer l\u2019autorisation';
    }
  });
}

// ── Chargement et assemblage de la page ────────────────────────────────────────

async function _loadAndRender(seq) {
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const documentsBlock = document.getElementById('k-kmc-documents-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  if (!walletBlock || !documentsBlock || !profileBlock || !secBlock) return;

  [walletBlock, documentsBlock, profileBlock, secBlock].forEach((block) => { block.hidden = false; });

  renderBlockLoading(documentsBlock);
  renderBlockLoading(walletBlock);
  renderBlockLoading(profileBlock);
  renderBlockLoading(secBlock);

  let me = null, meErr = null;
  me = await apiGet('/api/auth/me').catch(e => { meErr = e; return null; });

  if (seq !== _renderSeq) return; // stale render

  if (!me && isAuthErr(meErr)) {
    renderSessionExpired();
    return;
  }
  if (!me && meErr) {
    renderBlockError(profileBlock, meErr, () => _loadAndRender(++_renderSeq));
    secBlock.replaceChildren();
    return;
  }

  renderProfileBlock(profileBlock, me);
  renderSecurityBlock(secBlock, me);
  loadDocumentsBlock(documentsBlock);
  loadWalletBlock(walletBlock);
}

// ── Point d'entrée canonique ───────────────────────────────────────────────────

/**
 * Ouvre Mon Komerce.
 * - Ouvre toujours le shell avant de vérifier l'identité.
 * - Sans session, affiche une explication et attend un clic explicite avant OTP.
 * - Émet 'komerce:show' pour que b-nav.js synchronise la navigation.
 * - Si focus='wallet', positionne le viewport sur le bloc wallet.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.focus] 'wallet' pour scroller sur le wallet
 */
export async function openMonKomerce({ focus = null } = {}) {
  // 1. Monter et afficher le shell sans provoquer d'effet de bord d'authentification.
  const el = ensureShell();
  el.classList.add('show');

  // 2. Synchroniser la navigation (b-nav.js écoute 'komerce:show').
  bus.emit('komerce:show');

  // 3. Une première visite reste informative jusqu'au clic « M'identifier ».
  const identity = getCurrentIdentity() || await restoreIdentity();
  if (!identity) {
    ++_renderSeq; // invalide un éventuel rendu authentifié encore en vol
    renderIdentityRequired({ focus });
    return;
  }

  // 4. Une session locale présente autorise la vérification serveur et le rendu.
  _loadAndRender(++_renderSeq);

  // 5. Positionner sur le bloc demandé si nécessaire
  focusRequestedBlock(focus);
}
