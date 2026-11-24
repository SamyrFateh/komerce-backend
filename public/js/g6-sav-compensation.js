/** @komerce-arch-lite
 * @role g6-n26b-admin-compensation-screen
 * @domain refunds
 * @layer ui-page
 * @owner backend-core
 * @purpose Explicit admin-only decision on an existing physical return; no direct wallet/PSP calls.
 * @db-read none
 * @db-write none
 */
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let proposal = null;
  function message(text) { $('sav-status').textContent = text; }
  async function api(url, options) {
    const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, ...options });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Error((body.code ? body.code + ' : ' : '') + (body.error || 'HTTP ' + r.status));
    return body;
  }
  function syncAmount() {
    const reship = $('sav-movement').value === 'reship';
    $('sav-amount').disabled = reship;
    if (reship) $('sav-amount').value = '0';
    else if (proposal) $('sav-amount').value = String(proposal.suggested_amount);
  }
  $('sav-movement').addEventListener('change', syncAmount);
  $('sav-lookup').addEventListener('submit', async ev => {
    ev.preventDefault();
    const id = $('sav-id').value.trim();
    if (!uuid.test(id)) { message('UUID de dossier invalide.'); return; }
    $('sav-proposal').hidden = true;
    proposal = null;
    try {
      const p = await api('/api/relay/returns/' + encodeURIComponent(id) + '/compensation-proposal');
      if (p.request_id !== id) throw Error('Réponse de dossier incohérente.');
      proposal = p;
      $('sav-details').textContent = 'Commande ' + p.order_reference + ' · valeur de ligne ' + p.line_value + ' ' + p.currency +
        ' · barème indicatif ' + p.scale_pct + '% · proposition ' + p.suggested_amount + ' ' + p.currency;
      $('sav-movement').value = 'wallet_credit';
      syncAmount();
      $('sav-proposal').hidden = false;
      message('Proposition lue. Aucun mouvement effectué.');
    } catch (err) { message('Lecture refusée : ' + err.message); }
  });
  $('sav-decision').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!proposal) return;
    const movement = $('sav-movement').value;
    const amount = movement === 'reship' ? 0 : Number($('sav-amount').value);
    const reason = $('sav-reason').value.trim();
    if (!['wallet_credit', 'ledger_refund', 'reship'].includes(movement) || !Number.isSafeInteger(amount) ||
        amount < 0 || (movement !== 'reship' && (amount < 1 || amount > proposal.line_value)) || reason.length < 10) {
      message('Montant ou motif invalide ; aucune décision envoyée.'); return;
    }
    const warning = movement === 'wallet_credit'
      ? 'Confirmer le crédit WALLET EFFECTIF au payeur initial ?'
      : movement === 'ledger_refund'
        ? 'Confirmer la décision de remboursement via ledger ? Une réservation ne prouve PAS un paiement externe.'
        : 'Confirmer une commande de remplacement sans facturation ? Le serveur contrôle le stock.';
    if (!window.confirm(warning + '\nCette décision est unique et irréversible pour ce dossier.')) return;
    const button = $('sav-submit');
    button.disabled = true;
    try {
      const out = await api('/api/relay/returns/' + encodeURIComponent(proposal.request_id) + '/compensation', {
        method: 'POST',
        body: JSON.stringify({ movement, amount, reason, scale_code: proposal.scale_code })
      });
      $('sav-proposal').hidden = true;
      proposal = null;
      message('Décision enregistrée' + (out.replayed ? ' (rejeu idempotent)' : '') +
        '. Statut de remboursement : ' + (out.refund_status || 'aucun remboursement externe attesté') +
        '. Relire le ledger et les documents avant certification.');
    } catch (err) {
      message('Décision non confirmée : ' + err.message + '. Vérifier l’état serveur avant tout nouvel essai.');
    } finally { button.disabled = false; }
  });
  api('/api/auth/me').then(info => {
    const actor = info.user || info;
    if (actor.role !== 'admin') throw Error('Accès administrateur requis.');
    message('Administrateur authentifié. Saisir un dossier SAV existant.');
  }).catch(err => {
    $('sav-lookup').hidden = true;
    message('Accès refusé : ' + err.message);
  });
}());
