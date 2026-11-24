/**
 * @komerce-arch
 * @role          g8-admin-refund-staging-operator-ui
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        authenticated-role, local refund and PSP item-refund projections
 * @outputs       two-step PSP sandbox item refund plus explicit local payout decisions
 * @depends       GET/POST /api/admin/orders, PSP refund reservation/execution, relay cash handoff
 * @used-by       public/g8-remboursements.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      two_step_refund_decision, no_blind_retry, source_payee_verified_external, distinct_actors, staging_flags
 * @impact-areas  admin-dashboard, refunds, relay
 * @version       2026-11
 */
'use strict';
(function initG8Operator() {
  const state = document.querySelector('#g8-status');
  const list = document.querySelector('#g8-list');
  const title = document.querySelector('#g8-title');
  const env = document.querySelector('#g8-env');
  const back = document.querySelector('#g8-back');
  const refresh = document.querySelector('#g8-refresh');
  let userRole = null;

  const fieldDefs = Object.freeze({
    holder_id: 'Identifiant UUID du détenteur au relais',
    original_payer_proof_ref: 'Référence de la preuve du payeur initial',
    identity_check_proof_ref: 'Contrôle d’identité indépendant (référence)',
    operator_id: 'UUID de l’admin qui exécute le virement',
    payer_fingerprint: 'Empreinte SHA-256 du payeur attesté',
    transfer_ref: 'Référence unique du virement opéré',
    transfer_proof_ref: 'Reçu du virement réellement effectué',
    operator_verification_ref: 'Référence du contrôle indépendant portail opérateur',
    capture_external_transaction_id: 'Référence de la capture source vérifiée',
    amount_minor: 'Montant natif (unités mineures)',
    currency: 'Devise',
    payee_fingerprint: 'Empreinte SHA-256 du bénéficiaire constaté',
    signed_receipt_ref: 'Référence de la quittance client signée',
    payer_signature_proof_ref: 'Preuve de la signature du payeur',
    witness_proof_ref: 'Attestation du témoin (référence distincte)'
  });

  function announce(message, tone) {
    state.textContent = message;
    state.className = 'status' + (tone ? ' ' + tone : '');
  }
  function node(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = String(content);
    return el;
  }
  function append(parent, tag, className, content) {
    const child = node(tag, className, content);
    parent.appendChild(child);
    return child;
  }
  function money(row) {
    if (row.payment_mode === 'cash_relais') {
      const val = Number(row.amount_kmf);
      return Number.isFinite(val) ? val.toLocaleString('fr-FR') + ' KMF' : 'Montant indisponible';
    }
    return String(row.amount_minor) + ' unités mineures · ' + String(row.currency);
  }
  async function json(url, method, payload) {
    const options = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method) {
      options.method = method;
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload || {});
    }
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Accès ou action refusé (' + response.status + ')');
      error.status = response.status;
      error.code = body.code || '';
      throw error;
    }
    return body;
  }
  function inputForm(parent, action, definitions, endpoint, caution, requireConfirmation) {
    const form = append(parent, 'form', 'proof-form');
    form.noValidate = false;
    const controls = new Map();
    definitions.forEach(function (def) {
      const key = typeof def === 'string' ? def : def.key;
      const initial = typeof def === 'string' ? '' : String(def.value || '');
      const label = append(form, 'label', 'field');
      append(label, 'span', '', fieldDefs[key] || key);
      const input = append(label, 'input');
      input.name = key;
      input.type = 'text';
      input.required = true;
      input.autocomplete = 'off';
      input.maxLength = key.includes('fingerprint') ? 64 : 200;
      if (key.includes('fingerprint')) input.setAttribute('pattern', '[a-f0-9]{64}');
      if (key.endsWith('_id') && !key.includes('transaction')) input.minLength = 36;
      input.value = initial;
      controls.set(key, input);
    });
    if (caution) append(form, 'p', 'hint', caution);
    const button = append(form, 'button', 'action' + (requireConfirmation ? ' action-warning' : ''), action);
    button.type = 'submit';
    button.setAttribute('data-g8-action', endpoint.split('/').slice(-2).join('-'));
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const payload = {};
      controls.forEach((control, key) => { payload[key] = control.value.trim(); });
      if (requireConfirmation && !window.confirm(requireConfirmation)) return;
      button.disabled = true;
      announce('Enregistrement en cours…');
      try {
        const result = await json(endpoint, 'POST', payload);
        announce(result.paid
          ? 'Remboursement déclaré et comptabilisé : reçu ' + (result.receiptRef || result.documentStatus || 'à réconcilier')
          : 'État enregistré : ' + String(result.status || 'en attente') + '. Aucune remise supplémentaire automatique.', 'ok');
        await load(true);
      } catch (error) {
        announce((error.code ? error.code + ' — ' : '') + error.message, 'error');
      } finally { button.disabled = false; }
    });
  }
  function clickAction(parent, label, endpoint, confirmText) {
    const button = append(parent, 'button', 'action action-warning', label);
    button.type = 'button';
    button.setAttribute('data-g8-action', endpoint.split('/').slice(-2).join('-'));
    button.addEventListener('click', async function () {
      if (!window.confirm(confirmText)) return;
      button.disabled = true;
      announce('Enregistrement en cours…');
      try {
        const result = await json(endpoint, 'POST', {});
        announce('État : ' + String(result.status || 'en attente') +
          '. Un éventuel rejeu ne déclenche aucun nouveau paiement.', 'ok');
        await load(true);
      } catch (error) {
        announce((error.code ? error.code + ' — ' : '') + error.message, 'error');
      } finally { button.disabled = false; }
    });
  }
  function adminCase(row, box) {
    const stem = '/api/admin/orders/' + encodeURIComponent(row.order_id) +
      '/items/' + encodeURIComponent(row.order_item_id) +
      '/local-refund-reservations/' + encodeURIComponent(row.reservation_id);
    if (row.payment_mode === 'cash_relais') {
      const stage = row.cash_status || 'non autorisé';
      append(box, 'p', 'case-summary', 'Espèces · ' + stage +
        (row.cash_holder_id ? ' · relais affecté' : ''));
      if (!row.cash_authorization_id) {
        inputForm(box, 'Autoriser la remise au relais', [
          'holder_id', 'original_payer_proof_ref', 'identity_check_proof_ref'
        ], stem + '/authorize-cash',
        'Contrôler le payeur d’origine et la disponibilité de la garde avant d’autoriser.',
        'Avez-vous personnellement vérifié les pièces d’identité et le payeur de la transaction encaissée ?');
      } else {
        append(box, 'p', 'hint', 'Remise gérée par le détenteur affecté au relais. Aucune deuxième autorisation.');
      }
      return;
    }
    const status = row.mobile_status || 'non autorisé';
    append(box, 'p', 'case-summary', 'Mobile Money manuel · ' + status +
      '. Aucun transfert n’est effectué par Komerce.');
    if (!row.mobile_status) {
      inputForm(box, 'Autoriser le vireme