/**
 * KOMERCE — Hub Relais : Pickup Secret (Western Union model)
 *
 * Ce module câble les 2 écrans critiques dans le hub relais :
 *   1. "Encaisser un paiement" (visite 1)
 *      → formulaire payer_name + pièce → POST /api/pickup/pay-cash
 *      → popup d'impression du reçu avec code
 *   2. "Remettre un colis au client" (visite 2)
 *      → saisie du code format A7K-3M9-P2
 *      → POST /api/pickup/verify → si OK, POST /api/pickup/collect
 *
 * Intégration :
 *   Ce fichier s'auto-greffe sur les boutons existants data-action="relais-confirm-cash"
 *   et data-action="relais-collected" de ct-views-hub-relais.js en prenant le pas sur
 *   les handlers existants (capture phase + stopImmediatePropagation).
 *
 * Voir /docs/SECURITY-MODEL.md pour la doctrine complète.
 */

(function() {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // CONSTANTES
  // ══════════════════════════════════════════════════════════════════════════

  // Seuils de vérification d'identité au paiement (en KMF)
  var ID_THRESHOLD_REQUIRED = 10000;   // pièce obligatoire au-dessus
  var ID_THRESHOLD_ADMIN    = 100000;  // escalade admin au-dessus

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtKmf(n) {
    return Number(n || 0).toLocaleString('fr-FR') + ' KMF';
  }

  // Récupérer le JWT pour les appels API
  function getAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    // Si CT fournit un helper, on l'utilise
    if (window.CT && window.CT.api && typeof window.CT.api._authHeaders === 'function') {
      Object.assign(headers, window.CT.api._authHeaders());
    }
    return headers;
  }

  // Appel API générique
  async function apiFetch(path, options) {
    options = options || {};
    options.headers = Object.assign(getAuthHeaders(), options.headers || {});
    options.credentials = 'include'; // envoyer cookies httpOnly
    var resp = await fetch(path, options);
    var data = null;
    try { data = await resp.json(); } catch(_) {}
    if (!resp.ok) {
      var err = new Error((data && data.error) || ('HTTP ' + resp.status));
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Toast (réutilise celui de CT s'il existe, sinon fallback simple)
  function toast(msg, type) {
    if (window._toast) return window._toast(msg);
    if (window.CT && window.CT.toast) return window.CT.toast(msg, type);
    // Fallback
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:20px;right:20px;background:' +
      (type === 'error' ? '#ef4444' : '#22c55e') + ';color:#fff;padding:12px 20px;' +
      'border-radius:8px;font-weight:600;z-index:100000;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function() { div.remove(); }, 3500);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL GÉNÉRIQUE
  // ══════════════════════════════════════════════════════════════════════════

  function createModal(title, bodyHTML, opts) {
    opts = opts || {};
    // Retirer toute modal précédente
    var existing = document.getElementById('pickup-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'pickup-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
      'z-index:99999', 'display:flex', 'align-items:center', 'justify-content:center',
      'padding:20px', 'backdrop-filter:blur(3px)'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:#fff', 'border-radius:14px', 'max-width:480px', 'width:100%',
      'max-height:90vh', 'overflow-y:auto',
      'box-shadow:0 20px 60px rgba(0,0,0,0.25)',
      'display:flex', 'flex-direction:column'
    ].join(';');

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between';
    header.innerHTML =
      '<h3 style="margin:0;font-size:16px;font-weight:700;color:#1e293b">' + escapeHTML(title) + '</h3>' +
      '<button id="pickup-modal-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:4px 8px">×</button>';
    box.appendChild(header);

    // Body
    var body = document.createElement('div');
    body.style.cssText = 'padding:20px';
    body.innerHTML = bodyHTML;
    box.appendChild(body);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Close handlers
    function close() { overlay.remove(); if (opts.onClose) opts.onClose(); }
    document.getElementById('pickup-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay && opts.closeOnBackdrop !== false) close();
    });

    return { overlay: overlay, body: body, close: close };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉCRAN 1 — ENCAISSEMENT CASH (VISITE 1)
  // ══════════════════════════════════════════════════════════════════════════

  async function openCashPaymentFlow(orderRef, orderId) {
    // Étape 1 : récupérer les infos de la commande
    var order;
    try {
      var data = await apiFetch('/api/pickup/status/' + orderId);
      order = data;
    } catch(e) {
      return toast('❌ Impossible de charger la commande : ' + e.message, 'error');
    }

    // Si un code existe déjà, on bloque (la régénération est réservée admin)
    if (order.secret && order.secret.exists) {
      return toast('⚠ Code déjà généré pour cette commande. Utilisez la procédure admin pour régénérer.', 'error');
    }

    // Récupérer le montant via v2Orders (ou via status si dispo)
    var totalKmf = 0;
    try {
      var ordersResp = await apiFetch('/api/orders/v2?limit=200');
      var found = (ordersResp.orders || []).find(function(o) { return o.reference === orderRef; });
      if (found) totalKmf = Number(found.total_kmf || 0);
    } catch(_) {}

    var idRequired = totalKmf >= ID_THRESHOLD_REQUIRED;
    var adminAlert = totalKmf >= ID_THRESHOLD_ADMIN;

    var html =
      '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">' +
        '<strong>💰 Encaissement cash — ' + escapeHTML(orderRef) + '</strong><br>' +
        'Montant à encaisser : <strong>' + fmtKmf(totalKmf) + '</strong>' +
        (adminAlert ? '<br><span style="color:#dc2626">⚠ Montant > 100k : validation admin requise + photo CNI</span>' :
         idRequired ? '<br><span style="color:#b45309">⚠ Pièce d\'identité obligatoire</span>' :
                      '<br><span style="color:#059669">✓ Pas de pièce requise (< 10k KMF)</span>') +
      '</div>' +

      '<form id="pickup-pay-form">' +

        '<label style="display:block;margin-bottom:14px">' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Nom du payeur *</span>' +
          '<input type="text" name="payer_name" required placeholder="Ex: Fatima Moussa" ' +
                 'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
        '</label>' +

        (idRequired ?
          '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:14px">' +
            '<label>' +
              '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Type pièce *</span>' +
              '<select name="payer_id_type" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
                '<option value="">—</option>' +
                '<option value="CNI">CNI</option>' +
                '<option value="passport">Passeport</option>' +
                '<option value="permis">Permis</option>' +
                '<option value="autre">Autre</option>' +
              '</select>' +
            '</label>' +
            '<label>' +
              '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">N° pièce *</span>' +
              '<input type="text" name="payer_id_number" required placeholder="Ex: 123456789" ' +
                     'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
            '</label>' +
          '</div>'
          : '') +

        '<label style="display:block;margin-bottom:20px">' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Note (optionnel)</span>' +
          '<input type="text" name="payer_note" placeholder="Ex: c\'est la tante d\'Ahmed" ' +
                 'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
        '</label>' +

        '<button type="submit" id="pickup-pay-submit" ' +
                'style="width:100%;padding:14px;background:#16a34a;color:#fff;border:none;border-radius:8px;' +
                'font-size:15px;font-weight:700;cursor:pointer">' +
          '💰 Confirmer encaissement ' + fmtKmf(totalKmf) +
        '</button>' +

      '</form>';

    var modal = createModal('Encaisser paiement cash', html);

    var form = document.getElementById('pickup-pay-form');
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('pickup-pay-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Encaissement en cours...';

      var formData = new FormData(form);
      var payload = {
        payer_name:      formData.get('payer_name'),
        payer_id_type:   formData.get('payer_id_type') || null,
        payer_id_number: formData.get('payer_id_number') || null,
        payer_note:      formData.get('payer_note') || null,
      };

      try {
        var resp = await apiFetch('/api/pickup/pay-cash/' + orderId, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        // Succès : fermer cette modal, ouvrir la modal "code + impression"
        modal.close();
        openCodeDisplayAndPrint(resp.order_ref, resp.code, resp.print_token, orderId);
      } catch(err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💰 Confirmer encaissement ' + fmtKmf(totalKmf);
        toast('❌ ' + err.message, 'error');
      }
    });
  }

  function openCodeDisplayAndPrint(orderRef, code, printToken, orderId) {
    var receiptUrl = '/api/pickup/receipt/' + orderId + '?token=' + encodeURIComponent(printToken);

    var html =
      '<div style="text-align:center;padding:10px 0">' +
        '<div style="background:#dcfce7;border:2px solid #16a34a;border-radius:10px;padding:16px;margin-bottom:20px">' +
          '<div style="font-size:14px;color:#166534;margin-bottom:4px">✅ Paiement encaissé</div>' +
          '<div style="font-size:13px;color:#166534">Commande : <strong>' + escapeHTML(orderRef) + '</strong></div>' +
        '</div>' +

        '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;text-align:left">' +
          '⚠ <strong>Ce code s\'affiche UNE SEULE FOIS.</strong><br>' +
          'Imprimez le reçu maintenant et remettez-le au payeur.' +
        '</div>' +

        '<div style="border:3px solid #1e293b;border-radius:10px;padding:20px;margin-bottom:20px;background:#f8fafc">' +
          '<div style="font-size:10px;letter-spacing:2px;color:#64748b;margin-bottom:8px">CODE SECRET DE RETRAIT</div>' +
          '<div style="font-size:32px;font-weight:700;letter-spacing:4px;font-family:\'Courier New\',monospace;color:#1e293b">' +
            escapeHTML(code) +
          '</div>' +
        '</div>' +

        '<button id="pickup-print-btn" style="width:100%;padding:14px;background:#1e293b;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px">' +
          '🖨 Ouvrir le reçu pour impression' +
        '</button>' +

        '<button id="pickup-done-btn" style="width:100%;padding:12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">' +
          '✓ J\'ai remis le reçu, fermer' +
        '</button>' +

      '</div>';

    var modal = createModal('Code secret généré', html, { closeOnBackdrop: false });

    document.getElementById('pickup-print-btn').addEventListener('click', function() {
      // Ouvrir le reçu dans un popup imprimable (window.print() auto-déclenché côté serveur)
      var w = window.open(receiptUrl, '_blank', 'width=420,height=700,resizable=yes,scrollbars=yes');
      if (!w) {
        toast('⚠ Popup bloqué. Ouverture dans cet onglet...', 'error');
        window.location.href = receiptUrl;
      }
    });

    document.getElementById('pickup-done-btn').addEventListener('click', function() {
      modal.close();
      // Rafraîchir la vue relais
      if (window.CT && window.CT.views && window.CT.views.relais) {
        var mainEl = document.getElementById('ct-main');
        if (mainEl) window.CT.views.relais(mainEl);
      }
      toast('✅ Encaissement enregistré pour ' + orderRef);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉCRAN 2 — REMISE DE COLIS (VISITE 2)
  // ══════════════════════════════════════════════════════════════════════════

  async function openCollectFlow(orderRef, orderId) {
    // Vérifier le statut
    var order;
    try {
      order = await apiFetch('/api/pickup/status/' + orderId);
    } catch(e) {
      return toast('❌ Impossible de charger la commande : ' + e.message, 'error');
    }

    if (!order.secret || !order.secret.exists) {
      return toast('⚠ Cette commande n\'a pas de code secret (paiement non effectué ?)', 'error');
    }

    if (order.secret.blocked_until && new Date(order.secret.blocked_until) > new Date()) {
      var mins = Math.ceil((new Date(order.secret.blocked_until) - Date.now()) / 60000);
      return toast('🚫 Bloqué suite à trop de tentatives. Réessayez dans ' + mins + ' min.', 'error');
    }

    var attempts = order.secret.attempts || 0;
    var remaining = Math.max(0, 3 - attempts);

    var html =
      '<div style="background:#dbeafe;border:1px solid #60a5fa;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">' +
        '<strong>📦 Retrait — ' + escapeHTML(orderRef) + '</strong><br>' +
        'Demandez au client de lire son code secret imprimé sur son reçu.' +
        (attempts > 0 ? '<br><span style="color:#dc2626">⚠ ' + attempts + ' tentative(s) échouée(s) — ' + remaining + ' restante(s)</span>' : '') +
      '</div>' +

      '<form id="pickup-verify-form">' +

        '<label style="display:block;margin-bottom:20px">' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px">Code secret (format A7K-3M9-P2)</span>' +
          '<input type="text" id="pickup-code-input" name="code" required ' +
                 'placeholder="___-___-__" maxlength="10" autocomplete="off" ' +
                 'style="width:100%;padding:14px;border:2px solid #cbd5e1;border-radius:8px;' +
                 'font-size:22px;font-weight:700;letter-spacing:4px;text-align:center;' +
                 'font-family:\'Courier New\',monospace;text-transform:uppercase">' +
        '</label>' +

        '<button type="submit" id="pickup-verify-submit" ' +
                'style="width:100%;padding:14px;background:#2563eb;color:#fff;border:none;border-radius:8px;' +
                'font-size:15px;font-weight:700;cursor:pointer">' +
          '🔐 Vérifier le code' +
        '</button>' +

      '</form>' +

      '<div style="text-align:center;margin-top:14px;font-size:12px;color:#64748b">' +
        'Code oublié ? <a href="#" id="pickup-lost-link" style="color:#2563eb">Procédure de perte</a>' +
      '</div>';

    var modal = createModal('Remettre un colis', html);

    // Auto-formatage du code saisi : majuscules + ajout auto des tirets
    var input = document.getElementById('pickup-code-input');
    input.addEventListener('input', function() {
      var raw = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
      if (raw.length > 6) raw = raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6);
      else if (raw.length > 3) raw = raw.slice(0, 3) + '-' + raw.slice(3);
      input.value = raw;
    });
    input.focus();

    // Procédure de perte
    document.getElementById('pickup-lost-link').addEventListener('click', function(e) {
      e.preventDefault();
      openLostCodeDialog(orderRef, orderId);
    });

    var form = document.getElementById('pickup-verify-form');
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('pickup-verify-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Vérification...';

      var code = input.value;

      try {
        await apiFetch('/api/pickup/verify/' + orderId, {
          method: 'POST',
          body: JSON.stringify({ code: code }),
        });
        // Code valide : passer à l'étape collect
        modal.close();
        openCollectConfirmation(orderRef, orderId);
      } catch(err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🔐 Vérifier le code';
        if (err.status === 401) {
          var d = err.data || {};
          input.style.border = '2px solid #ef4444';
          input.value = '';
          toast('❌ Code incorrect — ' + (d.remaining || 0) + ' tentative(s) restante(s)', 'error');
          setTimeout(function() { input.style.border = '2px solid #cbd5e1'; }, 1500);
        } else if (err.status === 429) {
          modal.close();
          toast('🚫 ' + err.message, 'error');
        } else {
          toast('❌ ' + err.message, 'error');
        }
      }
    });
  }

  function openCollectConfirmation(orderRef, orderId) {
    var html =
      '<div style="background:#dcfce7;border:2px solid #16a34a;border-radius:10px;padding:16px;margin-bottom:20px;text-align:center">' +
        '<div style="font-size:20px;margin-bottom:6px">✅</div>' +
        '<div style="font-size:15px;font-weight:700;color:#166534">Code valide</div>' +
        '<div style="font-size:13px;color:#166534;margin-top:4px">' + escapeHTML(orderRef) + '</div>' +
      '</div>' +

      '<form id="pickup-collect-form">' +

        '<label style="display:block;margin-bottom:16px">' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Nom de la personne qui retire (optionnel)</span>' +
          '<input type="text" name="collected_by_name" placeholder="Ex: Mariama (la sœur du payeur)" ' +
                 'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
        '</label>' +

        '<button type="submit" id="pickup-collect-submit" ' +
                'style="width:100%;padding:14px;background:#16a34a;color:#fff;border:none;border-radius:8px;' +
                'font-size:15px;font-weight:700;cursor:pointer">' +
          '📦 Colis remis, clôturer' +
        '</button>' +

      '</form>';

    var modal = createModal('Confirmer la remise du colis', html, { closeOnBackdrop: false });

    document.getElementById('pickup-collect-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('pickup-collect-submit');
      btn.disabled = true;
      btn.textContent = '⏳ Clôture...';

      var name = new FormData(e.target).get('collected_by_name');

      try {
        await apiFetch('/api/pickup/collect/' + orderId, {
          method: 'POST',
          body: JSON.stringify({ collected_by_name: name || null }),
        });
        modal.close();
        toast('✅ ' + orderRef + ' remis et clôturé');
        if (window.CT && window.CT.views && window.CT.views.relais) {
          var mainEl = document.getElementById('ct-main');
          if (mainEl) window.CT.views.relais(mainEl);
        }
      } catch(err) {
        btn.disabled = false;
        btn.textContent = '📦 Colis remis, clôturer';
        toast('❌ ' + err.message, 'error');
      }
    });
  }

  function openLostCodeDialog(orderRef, orderId) {
    var isAdmin = window.CT && window.CT.user && window.CT.user.role === 'admin';

    var html =
      '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;line-height:1.6">' +
        '<strong>⚠ Procédure code perdu</strong><br>' +
        '1. Demander la pièce d\'identité au client<br>' +
        '2. Vérifier que le nom correspond au <strong>payeur</strong> enregistré<br>' +
        '3. Appeler l\'admin Komerce ou utiliser la régénération admin<br>' +
        '4. L\'admin fournit un nouveau code (ancien invalidé)' +
      '</div>' +

      (isAdmin ?
        '<form id="pickup-regen-form">' +
          '<label style="display:block;margin-bottom:14px">' +
            '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Motif de régénération (obligatoire, min 5 car.) *</span>' +
            '<textarea name="reason" required minlength="5" rows="3" ' +
                      'placeholder="Ex: Client a perdu son reçu, CNI vérifiée n°123456" ' +
                      'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;font-family:inherit"></textarea>' +
          '</label>' +
          '<button type="submit" style="width:100%;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">' +
            '🔄 Régénérer un nouveau code (admin)' +
          '</button>' +
        '</form>'
        :
        '<div style="padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;color:#475569;font-size:13px">' +
          '📞 Contactez un admin Komerce pour régénérer le code.' +
        '</div>'
      );

    var modal = createModal('Code secret perdu', html);

    if (isAdmin) {
      document.getElementById('pickup-regen-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        var reason = new FormData(e.target).get('reason');
        if (!confirm('Confirmer la régénération du code pour ' + orderRef + ' ?\n\nMotif: ' + reason)) return;

        try {
          var resp = await apiFetch('/api/pickup/regenerate/' + orderId, {
            method: 'POST',
            body: JSON.stringify({ reason: reason }),
          });
          modal.close();
          // Afficher le nouveau code à l'admin
          createModal('Nouveau code généré', 
            '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px">' +
              '⚠ Transmettez ce code par canal <strong>sécurisé</strong> à l\'agent relais ' +
              '(pas par WhatsApp bénéficiaire). L\'ancien code est invalidé.' +
            '</div>' +
            '<div style="border:3px solid #dc2626;border-radius:10px;padding:20px;text-align:center">' +
              '<div style="font-size:10px;letter-spacing:2px;color:#64748b;margin-bottom:8px">NOUVEAU CODE</div>' +
              '<div style="font-size:32px;font-weight:700;letter-spacing:4px;font-family:\'Courier New\',monospace">' +
                escapeHTML(resp.code) +
              '</div>' +
            '</div>',
            { closeOnBackdrop: false }
          );
          toast('✅ Code régénéré pour ' + orderRef);
        } catch(err) {
          toast('❌ ' + err.message, 'error');
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GREFFE SUR LES BOUTONS EXISTANTS DE ct-views-hub-relais.js
  // ══════════════════════════════════════════════════════════════════════════
  //
  // On intercepte en capture phase les clics sur :
  //   • data-action="relais-confirm-cash" → ouvre openCashPaymentFlow
  //   • data-action="relais-collected"    → ouvre openCollectFlow
  //
  // stopImmediatePropagation() empêche le handler existant de se déclencher.

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.dataset.action;
    var ref    = btn.dataset.ref;
    var id     = btn.dataset.id || btn.dataset.orderId;

    // Si pas d'id mais ref, on doit le résoudre
    if (!id && ref) {
      // Dans CT, les boutons portent généralement seulement ref. On va chercher l'id via API.
      // Pour rester simple : appel v2Orders et match sur reference.
      if (action === 'relais-confirm-cash' || action === 'relais-collected') {
        e.stopImmediatePropagation();
        e.preventDefault();

        (async function() {
          try {
            var resp = await apiFetch('/api/orders/v2?limit=500');
            var order = (resp.orders || []).find(function(o) { return o.reference === ref; });
            if (!order) {
              // Peut-être c'est un parcel (colis) pour l'action collected
              try {
                var resp2 = await apiFetch('/api/parcels?limit=500');
                var parcel = (resp2.parcels || []).find(function(p) { return p.reference === ref; });
                if (parcel && parcel.main_order_id) {
                  id = parcel.main_order_id;
                }
              } catch(_) {}
            } else {
              id = order.id;
            }

            if (!id) {
              toast('❌ Commande introuvable : ' + ref, 'error');
              return;
            }

            if (action === 'relais-confirm-cash') {
              openCashPaymentFlow(ref, id);
            } else if (action === 'relais-collected') {
              openCollectFlow(ref, id);
            }
          } catch(err) {
            toast('❌ ' + err.message, 'error');
          }
        })();
      }
    }
  }, true); // capture phase

  // ══════════════════════════════════════════════════════════════════════════
  // EXPOSE POUR USAGE EXTERNE
  // ══════════════════════════════════════════════════════════════════════════

  window.KomercePickup = {
    openCashPayment: openCashPaymentFlow,
    openCollect: openCollectFlow,
    openLostCodeDialog: openLostCodeDialog,
  };

  console.log('✅ Komerce Pickup Secret module loaded (Western Union model)');

})();
