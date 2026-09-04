/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-pickup-secret
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
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
    // Étape 1 : récupérer les infos de la commande (via /status qui renvoie tout)
    var order;
    try {
      order = await apiFetch('/api/pickup/status/' + orderId);
    } catch(e) {
      return toast('❌ Impossible de charger la commande : ' + e.message, 'error');
    }

    // Si un code existe déjà, on bloque (la régénération est réservée admin)
    if (order.secret && order.secret.exists) {
      return toast('⚠ Code déjà généré pour cette commande. Utilisez la procédure admin pour régénérer.', 'error');
    }

    var totalKmf       = Number(order.total_kmf || 0);
    var clientName     = order.client_name || '';
    var currentPhone   = (order.tracking && order.tracking.primary)   || '';
    var currentPhone2  = (order.tracking && order.tracking.secondary) || '';

    var idRequired = totalKmf >= ID_THRESHOLD_REQUIRED;
    var adminAlert = totalKmf >= ID_THRESHOLD_ADMIN;

    var html =
      // ── Récapitulatif de la commande ─────────────────────────────
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;line-height:1.6">' +
        '<div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;margin-bottom:6px">COMMANDE</div>' +
        '<div style="font-size:15px;font-weight:700;color:#1e293b">' + escapeHTML(orderRef) +
          (clientName ? ' · ' + escapeHTML(clientName) : '') +
        '</div>' +
        '<div style="font-size:20px;font-weight:800;color:#dc2626;margin-top:4px">' + fmtKmf(totalKmf) + ' à encaisser</div>' +
        (adminAlert ? '<div style="margin-top:6px;color:#dc2626;font-size:12px">⚠ Montant > 100k : validation admin requise</div>' :
         idRequired ? '<div style="margin-top:6px;color:#b45309;font-size:12px">⚠ Pièce d\'identité obligatoire</div>' :
                      '<div style="margin-top:6px;color:#059669;font-size:12px">✓ Pas de pièce requise (< 10k KMF)</div>') +
      '</div>' +

      '<form id="pickup-pay-form">' +

        // ── SECTION 1 : Numéros de suivi (confirmer/ajouter) ────────
        '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin-bottom:14px">' +
          '<div style="font-size:12px;font-weight:700;color:#1e40af;margin-bottom:10px">📞 Numéros de suivi</div>' +

          // Numéro principal
          '<label style="display:block;margin-bottom:10px">' +
            '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">Numéro principal (notifs colis)</span>' +
            '<input type="tel" name="tracking_phone_primary" value="' + escapeHTML(currentPhone) + '" ' +
                   'placeholder="+269 333 44 88" ' +
                   'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
            (currentPhone ? '<span style="display:block;font-size:11px;color:#16a34a;margin-top:3px">✓ Confirmez ou corrigez avec le client</span>' :
                            '<span style="display:block;font-size:11px;color:#dc2626;margin-top:3px">⚠ Aucun numéro enregistré, à saisir</span>') +
          '</label>' +

          // Bouton ajouter un 2e numéro (personne de confiance)
          '<div id="pickup-secondary-wrap">' +
            (currentPhone2 ?
              '<label style="display:block">' +
                '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">📞 Personne de confiance (optionnel)</span>' +
                '<input type="tel" name="tracking_phone_secondary" value="' + escapeHTML(currentPhone2) + '" ' +
                       'placeholder="+269 333 11 22" ' +
                       'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
              '</label>'
              :
              '<button type="button" id="pickup-add-secondary" ' +
                      'style="width:100%;padding:8px;background:transparent;border:1px dashed #60a5fa;border-radius:6px;color:#1e40af;font-size:12px;font-weight:600;cursor:pointer">' +
                '+ Ajouter une personne de confiance (recevra aussi les notifs)' +
              '</button>'
            ) +
          '</div>' +
        '</div>' +

        // ── SECTION 2 : Identité du payeur ──────────────────────────
        '<div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:14px">' +
          '<div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:10px">👤 Identité du payeur présent</div>' +

          '<label style="display:block;margin-bottom:' + (idRequired ? '10px' : '4px') + '">' +
            '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">Nom du payeur *</span>' +
            '<input type="text" name="payer_name" required placeholder="Ex: Fatima Moussa" ' +
                   'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
          '</label>' +

          (idRequired ?
            '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">' +
              '<label>' +
                '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">Type pièce *</span>' +
                '<select name="payer_id_type" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
                  '<option value="">—</option>' +
                  '<option value="CNI">CNI</option>' +
                  '<option value="passport">Passeport</option>' +
                  '<option value="permis">Permis</option>' +
                  '<option value="autre">Autre</option>' +
                '</select>' +
              '</label>' +
              '<label>' +
                '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">N° pièce *</span>' +
                '<input type="text" name="payer_id_number" required placeholder="Ex: 123456789" ' +
                       'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
              '</label>' +
            '</div>'
            : '') +
        '</div>' +

        // ── SECTION 3 : Note libre ──────────────────────────────────
        '<label style="display:block;margin-bottom:20px">' +
          '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">Note (optionnel)</span>' +
          '<input type="text" name="payer_note" placeholder="Ex: c\'est la tante d\'Ahmed, commande pour sa nièce" ' +
                 'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
        '</label>' +

        // ── Bouton valider ──────────────────────────────────────────
        '<button type="submit" id="pickup-pay-submit" ' +
                'style="width:100%;padding:16px;background:#16a34a;color:#fff;border:none;border-radius:8px;' +
                'font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(22,163,74,0.3)">' +
          '💰 Confirmer encaissement ' + fmtKmf(totalKmf) +
        '</button>' +

      '</form>';

    var modal = createModal('Encaisser paiement cash', html);

    // Handler : bouton "+ Ajouter une personne de confiance"
    var addBtn = document.getElementById('pickup-add-secondary');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var wrap = document.getElementById('pickup-secondary-wrap');
        wrap.innerHTML =
          '<label style="display:block">' +
            '<span style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px">📞 Personne de confiance (optionnel)</span>' +
            '<input type="tel" name="tracking_phone_secondary" autofocus ' +
                   'placeholder="+269 333 11 22" ' +
                   'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
            '<span style="display:block;font-size:11px;color:#64748b;margin-top:3px">Cette personne recevra aussi les notifs de suivi du colis.</span>' +
          '</label>';
        var newInput = wrap.querySelector('input[type="tel"]');
        if (newInput) newInput.focus();
      });
    }

    var form = document.getElementById('pickup-pay-form');
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('pickup-pay-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Encaissement en cours...';

      var formData = new FormData(form);
      var payload = {
        payer_name:                formData.get('payer_name'),
        payer_id_type:             formData.get('payer_id_type') || null,
        payer_id_number:           formData.get('payer_id_number') || null,
        payer_note:                formData.get('payer_note') || null,
        tracking_phone_primary:    formData.get('tracking_phone_primary') || null,
        tracking_phone_secondary:  formData.get('tracking_phone_secondary') || null,
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
    var masked = order.secret.masked || '•••-•••-••';

    // Deux modes : scan QR (principal) ou saisie 4 chars (fallback)
    var html =
      '<div style="background:#dbeafe;border:1px solid #60a5fa;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">' +
        '<strong>📦 Retrait — ' + escapeHTML(orderRef) + '</strong><br>' +
        'Scannez le QR code imprimé sur le reçu du client.' +
        '<div style="font-size:11px;color:#64748b;margin-top:4px">Code attendu : ' + escapeHTML(masked) + ' (masqué côté agent)</div>' +
        (attempts > 0 ? '<div style="color:#dc2626;margin-top:4px">⚠ ' + attempts + ' tentative(s) échouée(s) — ' + remaining + ' restante(s)</div>' : '') +
      '</div>' +

      // ── MODE A : Scan QR (par défaut) ───────────────────────────
      '<div id="pickup-mode-scan">' +
        '<div id="pickup-scan-wrap" style="position:relative;border:2px solid #2563eb;border-radius:12px;overflow:hidden;background:#000;aspect-ratio:1;max-height:320px;margin:0 auto 12px">' +
          '<video id="pickup-scan-video" autoplay playsinline muted ' +
                 'style="width:100%;height:100%;object-fit:cover;display:block"></video>' +
          '<div style="position:absolute;inset:0;border:3px solid rgba(255,255,255,0.8);border-radius:12px;pointer-events:none;' +
               'box-shadow:0 0 0 9999px rgba(0,0,0,0.3)"></div>' +
          '<div id="pickup-scan-status" ' +
               'style="position:absolute;bottom:0;left:0;right:0;padding:8px;background:rgba(0,0,0,0.65);color:#fff;font-size:12px;text-align:center">' +
            '🔍 Pointez la caméra sur le QR du reçu' +
          '</div>' +
        '</div>' +
        '<button type="button" id="pickup-switch-manual" ' +
                'style="width:100%;padding:12px;background:transparent;border:1px dashed #94a3b8;border-radius:8px;color:#475569;font-size:13px;cursor:pointer">' +
          '⌨ Saisir les 4 derniers caractères à la place' +
        '</button>' +
      '</div>' +

      // ── MODE B : Saisie 4 chars (caché par défaut) ──────────────
      '<div id="pickup-mode-manual" style="display:none">' +
        '<form id="pickup-verify-form">' +
          '<label style="display:block;margin-bottom:16px">' +
            '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px">Les 4 derniers caractères du code</span>' +
            '<input type="text" id="pickup-code-input" name="code" required ' +
                   'placeholder="____" maxlength="4" autocomplete="off" ' +
                   'style="width:100%;padding:18px;border:2px solid #cbd5e1;border-radius:8px;' +
                   'font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;' +
                   'font-family:\'Courier New\',monospace;text-transform:uppercase">' +
            '<span style="display:block;font-size:11px;color:#64748b;margin-top:6px;text-align:center">Le code complet (8 chars) est aussi accepté si le client le donne entier</span>' +
          '</label>' +
          '<button type="submit" id="pickup-verify-submit" ' +
                  'style="width:100%;padding:14px;background:#2563eb;color:#fff;border:none;border-radius:8px;' +
                  'font-size:15px;font-weight:700;cursor:pointer">' +
            '🔐 Vérifier le code' +
          '</button>' +
        '</form>' +
        '<button type="button" id="pickup-back-scan" ' +
                'style="width:100%;padding:10px;margin-top:10px;background:transparent;border:none;color:#2563eb;font-size:13px;cursor:pointer">' +
          '← Retour au scan QR' +
        '</button>' +
      '</div>' +

      '<div style="text-align:center;margin-top:14px;font-size:12px;color:#64748b">' +
        'Code perdu ? <a href="#" id="pickup-lost-link" style="color:#2563eb">Procédure de perte</a>' +
      '</div>' +
      '<div style="text-align:center;margin-top:6px;font-size:12px;color:#64748b">' +
        'Pas de code / pièce d\'identité ? <a href="#" id="pickup-exceptional-link" style="color:#2563eb">Autorisation nominative</a>' +
      '</div>';

    var modal = createModal('Remettre un colis', html, {
      onClose: function() { stopScanning(); }
    });

    // ── Scan QR logic ────────────────────────────────────────────
    var videoEl     = document.getElementById('pickup-scan-video');
    var statusEl    = document.getElementById('pickup-scan-status');
    var scanStream  = null;
    var scanLoopId  = null;
    var jsQRLoaded  = false;
    var lastScanAt  = 0;
    var barcodeDetector = null;

    async function startScanning() {
      try {
        // Préférer caméra arrière sur mobile
        scanStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        videoEl.srcObject = scanStream;
        await videoEl.play();

        // Tenter BarcodeDetector (Chromium)
        if ('BarcodeDetector' in window) {
          try {
            barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
          } catch(_) { barcodeDetector = null; }
        }

        // Si pas de BarcodeDetector, charger jsQR en CDN
        if (!barcodeDetector && !window.jsQR) {
          await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js');
          jsQRLoaded = true;
        }

        statusEl.textContent = '🔍 Pointez la caméra sur le QR du reçu';
        scanLoop();
      } catch(err) {
        statusEl.textContent = '❌ Caméra inaccessible — utilisez la saisie manuelle';
        statusEl.style.background = 'rgba(220,38,38,0.9)';
        console.warn('[PICKUP-SCAN] getUserMedia error:', err);
      }
    }

    function stopScanning() {
      if (scanLoopId) { cancelAnimationFrame(scanLoopId); scanLoopId = null; }
      if (scanStream) {
        scanStream.getTracks().forEach(function(t) { t.stop(); });
        scanStream = null;
      }
    }

    function loadScript(src) {
      return new Promise(function(res, rej) {
        var s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    async function scanLoop() {
      if (!scanStream) return;
      var now = Date.now();
      // Throttle : 1 scan / 200ms
      if (now - lastScanAt < 200) {
        scanLoopId = requestAnimationFrame(scanLoop);
        return;
      }
      lastScanAt = now;

      try {
        var qrData = null;
        if (barcodeDetector) {
          // Path Chromium : BarcodeDetector (rapide)
          var codes = await barcodeDetector.detect(videoEl);
          if (codes && codes.length > 0) qrData = codes[0].rawValue;
        } else if (window.jsQR && videoEl.readyState === 4) {
          // Path jsQR : copie frame → canvas → décodage
          var canvas = document.createElement('canvas');
          canvas.width  = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var result = window.jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (result) qrData = result.data;
        }

        if (qrData) {
          stopScanning();
          statusEl.textContent = '✅ QR détecté, vérification...';
          statusEl.style.background = 'rgba(22,163,74,0.9)';
          await processQrPayload(qrData);
          return;
        }
      } catch(err) {
        console.warn('[PICKUP-SCAN] scan error:', err);
      }

      scanLoopId = requestAnimationFrame(scanLoop);
    }

    async function processQrPayload(raw) {
      var payload = null;
      var code = null;
      var rawStr = String(raw || '').trim();

      // Format Komerce v1 : "KMR1." + base64url(JSON)
      if (rawStr.indexOf('KMR1.') === 0) {
        try {
          var b64 = rawStr.slice(5).replace(/-/g, '+').replace(/_/g, '/');
          // Re-padder le base64 si nécessaire
          while (b64.length % 4) b64 += '=';
          var decoded = atob(b64);
          payload = JSON.parse(decoded);
          code = payload && payload.c;
        } catch(e) {
          console.warn('[PICKUP-SCAN] Base64 decode failed:', e);
        }
      }

      // Fallback rétro-compat : JSON en clair (anciens reçus)
      if (!code) {
        try {
          payload = JSON.parse(rawStr);
          code = payload && payload.c;
        } catch(_) { /* pas du JSON */ }
      }

      // Fallback final : le QR encode juste le code brut
      if (!code) {
        // On vérifie que ça ressemble à un code Komerce (chars autorisés + longueur 8)
        var clean = rawStr.replace(/[-\s]/g, '').toUpperCase();
        if (/^[A-HJ-NP-Z2-9]{8}$/.test(clean)) {
          code = clean;
        }
      }

      if (!code) {
        toast('❌ QR invalide : ce n\'est pas un QR Komerce', 'error');
        modal.close();
        return;
      }

      await verifyAndCollect(code);
    }

    async function verifyAndCollect(code) {
      try {
        await apiFetch('/api/pickup/verify/' + orderId, {
          method: 'POST',
          body: JSON.stringify({ code: code }),
        });
        modal.close();
        openCollectConfirmation(orderRef, orderId, code);
      } catch(err) {
        if (err.status === 401) {
          var d = err.data || {};
          toast('❌ Code incorrect — ' + (d.remaining || 0) + ' tentative(s) restante(s)', 'error');
          modal.close();
        } else if (err.status === 429) {
          toast('🚫 ' + err.message, 'error');
          modal.close();
        } else {
          toast('❌ ' + err.message, 'error');
          modal.close();
        }
      }
    }

    // ── Switch scan ↔ saisie manuelle ────────────────────────────
    document.getElementById('pickup-switch-manual').addEventListener('click', function() {
      stopScanning();
      document.getElementById('pickup-mode-scan').style.display = 'none';
      document.getElementById('pickup-mode-manual').style.display = 'block';
      var input = document.getElementById('pickup-code-input');
      if (input) {
        input.focus();
        // Auto-formatage : uppercase + max 8 chars (4 ou 8 acceptés)
        input.addEventListener('input', function() {
          var raw = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          // Si <= 4 chars : pas de tiret. Si 5-8 chars : format A7K-3M9-P2
          if (raw.length > 4) {
            raw = raw.slice(0, 8);
            input.maxLength = 10;
            if (raw.length > 6) raw = raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6);
            else if (raw.length > 3) raw = raw.slice(0, 3) + '-' + raw.slice(3);
          } else {
            input.maxLength = 8;
          }
          input.value = raw;
        });
      }
    });

    document.getElementById('pickup-back-scan').addEventListener('click', function() {
      document.getElementById('pickup-mode-manual').style.display = 'none';
      document.getElementById('pickup-mode-scan').style.display = 'block';
      startScanning();
    });

    // ── Form submit (mode manuel) ────────────────────────────────
    document.getElementById('pickup-verify-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('pickup-verify-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Vérification...';
      var input = document.getElementById('pickup-code-input');
      await verifyAndCollect(input.value);
      submitBtn.disabled = false;
      submitBtn.textContent = '🔐 Vérifier le code';
    });

    // ── Procédure de perte ───────────────────────────────────────
    document.getElementById('pickup-lost-link').addEventListener('click', function(e) {
      e.preventDefault();
      stopScanning();
      openLostCodeDialog(orderRef, orderId);
    });

    // ── Retrait exceptionnel par autorisation nominative (Lot 5) ─
    document.getElementById('pickup-exceptional-link').addEventListener('click', function(e) {
      e.preventDefault();
      stopScanning();
      openExceptionalPickupFlow(orderRef, orderId);
    });

    // ── Démarrer le scan automatiquement ─────────────────────────
    startScanning();
  }

  function openCollectConfirmation(orderRef, orderId, pickupCode) {
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
          '📦 Confirmer la remise' +
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
        var collected = await apiFetch('/api/pickup/collect/' + orderId, {
          method: 'POST',
          body: JSON.stringify({
            collected_by_name: name || null,
            pickup_code: pickupCode,
          }),
        });
        modal.close();
        toast(collected.partial
          ? '✅ Lot remis · d’autres articles restent à retirer'
          : '✅ ' + orderRef + ' entièrement remis');
        if (window.CT && window.CT.views && window.CT.views.relais) {
          var mainEl = document.getElementById('ct-main');
          if (mainEl) window.CT.views.relais(mainEl);
        }
      } catch(err) {
        btn.disabled = false;
        btn.textContent = '📦 Confirmer la remise';
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
  // RETRAIT EXCEPTIONNEL PAR AUTORISATION NOMINATIVE (Lot 5)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Substitution exceptionnelle au code secret — jamais le moyen normal.
  // L'agent ne voit ni ne saisit le nom attendu : il saisit le nom présenté
  // sur la pièce d'identité, la comparaison stricte se fait côté serveur
  // (services/pickup-secret-service.js::collectByAuthorizedName). Doctrine :
  //   - GET /exceptional-pickup/:orderId d'abord — ne révèle qu'un booléen +
  //     une raison technique, jamais le nom attendu ni son existence détaillée
  //   - la case "pièce contrôlée" est une attestation de l'agent, jamais
  //     pré-cochée
  //   - en cas de non-concordance (NAME_MISMATCH), le formulaire reste ouvert
  //     pour une nouvelle tentative (compteur dédié, 3 max) — mais un blocage
  //     (429) ou tout autre refus définitif ferme le formulaire

  async function openExceptionalPickupFlow(orderRef, orderId) {
    var avail;
    try {
      avail = await apiFetch('/api/pickup/exceptional-pickup/' + orderId);
    } catch(e) {
      return toast('❌ Impossible de vérifier la disponibilité : ' + e.message, 'error');
    }

    if (!avail.available) {
      var reasonMsg = {
        CROSS_RELAIS:             'Cette commande appartient à un autre relais.',
        BLOCKED:                  'Trop de tentatives échouées sur cette commande — réessayez plus tard.',
        NO_ACTIVE_AUTHORIZATION:  'Le client n\'a autorisé personne pour un retrait exceptionnel. Orientez-le vers Mon Komerce ou la procédure de perte de code.',
      }[avail.reason] || 'Retrait exceptionnel indisponible pour cette commande.';
      return toast('⚠ ' + reasonMsg, 'error');
    }

    var html =
      '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;line-height:1.6">' +
        '<strong>⚠ Retrait exceptionnel — ' + escapeHTML(orderRef) + '</strong><br>' +
        '1. Demandez une pièce d\'identité à la personne présente<br>' +
        '2. Comparez le nom saisi ci-dessous avec la pièce — le nom attendu ne vous est jamais communiqué à l\'avance<br>' +
        '3. Cochez la case uniquement après avoir vérifié la pièce' +
      '</div>' +

      '<form id="pickup-exceptional-form">' +
        '<label style="display:block;margin-bottom:12px">' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Prénom(s) — tel quel sur la pièce *</span>' +
          '<input type="text" name="given_names" id="exceptional-given" required maxlength="100" autocomplete="off" ' +
                 'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
        '</label>' +
        '<label style="display:block;margin-bottom:12px">' +
          '<span style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">Nom de famille — tel quel sur la pièce *</span>' +
          '<input type="text" name="family_name" id="exceptional-family" required maxlength="100" autocomplete="off" ' +
                 'style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' +
        '</label>' +
        '<label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:16px;font-size:13px;color:#334155">' +
          '<input type="checkbox" name="document_checked" id="exceptional-doc-checked" required style="margin-top:2px">' +
          '<span>Je certifie avoir contrôlé une pièce d\'identité correspondant à ce nom</span>' +
        '</label>' +
        '<div id="exceptional-error" style="display:none;background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px"></div>' +
        '<button type="submit" id="pickup-exceptional-submit" ' +
                'style="width:100%;padding:14px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">' +
          '📦 Vérifier et remettre le colis' +
        '</button>' +
      '</form>';

    var modal   = createModal('Retrait exceptionnel — pièce d\'identité', html, { closeOnBackdrop: false });
    var errorEl = document.getElementById('exceptional-error');

    document.getElementById('pickup-exceptional-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn      = document.getElementById('pickup-exceptional-submit');
      var givenEl  = document.getElementById('exceptional-given');
      var familyEl = document.getElementById('exceptional-family');
      var docEl    = document.getElementById('exceptional-doc-checked');

      errorEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = '⏳ Vérification...';

      try {
        var resp = await apiFetch('/api/pickup/exceptional-pickup/' + orderId + '/collect', {
          method: 'POST',
          body: JSON.stringify({
            given_names:      givenEl.value.trim(),
            family_name:      familyEl.value.trim(),
            document_checked: docEl.checked,
          }),
        });
        modal.close();
        toast('✅ ' + (resp.order_ref || orderRef) + ' remis (retrait exceptionnel)');
        if (window.CT && window.CT.views && window.CT.views.relais) {
          var mainEl = document.getElementById('ct-main');
          if (mainEl) window.CT.views.relais(mainEl);
        }
      } catch(err) {
        var d = err.data || {};
        var terminal = false; // true = plus rien à tenter, on ferme le formulaire
        var msg;

        if (err.status === 401 && d.code === 'NAME_MISMATCH') {
          msg = '❌ Le nom ne correspond pas à l\'autorisation enregistrée — ' + (d.remaining || 0) + ' tentative(s) restante(s).';
        } else if (err.status === 429 || d.code === 'BLOCKED') {
          msg = '🚫 Trop de tentatives — réessayez plus tard.';
          terminal = true;
        } else if (d.code === 'ALREADY_COLLECTED') {
          msg = 'ℹ️ Cette commande est déjà marquée comme récupérée.';
          terminal = true;
        } else if (d.code === 'CROSS_RELAIS_BLOCKED') {
          msg = '⛔ Cette commande appartient à un autre relais.';
          terminal = true;
        } else if (d.code === 'NO_ACTIVE_AUTHORIZATION') {
          msg = '⚠ Aucune autorisation active — orientez le client vers Mon Komerce.';
          terminal = true;
        } else if (d.code === 'ORDER_NOT_FOUND') {
          msg = '❌ Commande introuvable.';
          terminal = true;
        } else {
          msg = '❌ ' + (err.message || 'Erreur inconnue');
        }

        if (terminal) {
          modal.close();
          toast(msg, 'error');
          return;
        }

        errorEl.textContent = msg;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '📦 Vérifier et remettre le colis';
      }
    });
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
    openExceptionalPickup: openExceptionalPickupFlow,
  };

  console.log('✅ Komerce Pickup Secret module loaded (Western Union model)');

})();
