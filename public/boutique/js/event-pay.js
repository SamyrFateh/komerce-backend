/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page PAIEMENT (boutique)

   Route : /event/pay/:paymentToken
   Lit   : GET  /api/collective-payments/:token         (info)
   Pay   : POST /api/collective-payments/:token/pay-card (Stripe intent)
   Conf  : Stripe.confirmCardPayment côté front

   Aucun débit n'est effectué avant que tous les contributeurs aient validé.
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl   = document.getElementById('ev-error-block');

  let _stripe = null;
  let _stripeCard = null;

  function getPaymentToken() {
    const m = window.location.pathname.match(/\/event\/pay\/([^\/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function showError(msg) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = msg;
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function loadPublicConfig() {
    try {
      const r = await fetch('/api/public/config', { credentials: 'omit' });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }

  function statusBadge(status) {
    if (status === 'paid') return '<span class="ev-badge ev-badge-paid">✓ Payé</span>';
    if (status === 'authorized') return '<span class="ev-badge ev-badge-finalized">⏳ Préautorisé</span>';
    if (status === 'expired') return '<span class="ev-badge ev-badge-conception" style="background:#fee2e2;color:#991b1b;">Expiré</span>';
    if (status === 'cancelled') return '<span class="ev-badge ev-badge-conception" style="background:#fee2e2;color:#991b1b;">Annulé</span>';
    return '<span class="ev-badge ev-badge-conception">À confirmer</span>';
  }

  function render(info) {
    const isPaid       = info.token_status === 'paid';
    const isAuthorized = info.token_status === 'authorized';
    const isFinal      = isPaid || info.token_status === 'expired' || info.token_status === 'cancelled';

    let html = '';

    // ── Bloc unique : identité + montant + statut ──────────────
    html += '<div class="ev-card" style="margin-bottom:12px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
    html += '<div>';
    html += '<h2 class="ev-card-title" style="margin-bottom:2px;">' + escHtml(info.event_name || 'Panier événement') + '</h2>';
    html += '<div class="ev-card-sub" style="margin:0;">Bonjour <strong>' + escHtml(info.contributor_name) + '</strong>';
    if (info.recipient_name) html += ' · Pour ' + escHtml(info.recipient_name);
    html += '</div>';
    html += '</div>';
    html += '<div>' + statusBadge(info.token_status) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--ev-bg);border-radius:8px;">';
    html += '<span style="font-size:13px;color:var(--ev-text-muted);">Votre part</span>';
    html += '<span style="font-size:18px;font-weight:700;color:var(--ev-text);">' + fmt(info.amount_kmf) + ' KMF</span>';
    html += '</div>';
    if (info.paiements_confirmes) {
      html += '<div class="ev-help" style="margin-top:8px;text-align:center;">🤝 ' + escHtml(info.paiements_confirmes) + ' confirmé(s)</div>';
    }
    html += '</div>';

    // ── Statut final ───────────────────────────────────────────
    if (isPaid) {
      html += '<div class="ev-info" style="background:#dcfce7;color:#166534;border-color:#86efac;text-align:center;">';
      html += '✅ <strong>Paiement confirmé — Merci !</strong>';
      html += '</div>';
    } else if (info.token_status === 'expired') {
      html += '<div class="ev-warning">⏰ Session expirée. Contactez le créateur du panier.</div>';
    } else if (info.token_status === 'cancelled') {
      html += '<div class="ev-warning">Ce paiement a été annulé.</div>';
    } else if (isAuthorized) {
      html += '<div class="ev-info" style="text-align:center;">';
      html += '⏳ <strong>Carte préautorisée.</strong> Le débit aura lieu quand tous auront confirmé.';
      html += '</div>';
    }

    // ── Formulaire Stripe (direct, sans titre superflu) ────────
    if (!isFinal && !isAuthorized) {
      html += '<div class="ev-card">';
      html += '<div class="ev-field" style="margin-bottom:10px;">';
      html += '<label class="ev-label">Carte bancaire</label>';
      html += '<div id="ev-stripe-card" style="padding:12px;border:1.5px solid var(--ev-border);border-radius:10px;background:white;"></div>';
      html += '<div id="ev-stripe-error" class="ev-help" style="color:#dc2626;margin-top:6px;display:none;"></div>';
      html += '</div>';
      html += '<button id="ev-pay-btn" class="ev-btn ev-btn-success ev-btn-block" style="font-size:16px;padding:14px 20px;">' +
              '🔒 Confirmer — ' + fmt(info.amount_kmf) + ' KMF</button>';
      html += '<div class="ev-help" style="text-align:center;margin-top:8px;">Aucun débit avant que tous les contributeurs aient confirmé</div>';
      html += '</div>';
    }

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    if (!isFinal && !isAuthorized) {
      initStripeForm(info);
    }
  }

  async function initStripeForm(info) {
    const cfg = await loadPublicConfig();
    if (!cfg || !cfg.stripe_public_key) {
      const errEl = document.getElementById('ev-stripe-error');
      if (errEl) {
        errEl.textContent = 'Paiement carte temporairement indisponible. Contactez le créateur.';
        errEl.style.display = 'block';
      }
      const btn = document.getElementById('ev-pay-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Indisponible'; }
      return;
    }

    if (typeof Stripe === 'undefined') {
      console.error('Stripe.js non chargé');
      return;
    }

    try {
      _stripe = Stripe(cfg.stripe_public_key);
      const elements = _stripe.elements();
      _stripeCard = elements.create('card', {
        style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
        hidePostalCode: true,
      });
      _stripeCard.mount('#ev-stripe-card');
      _stripeCard.on('change', (ev) => {
        const errEl = document.getElementById('ev-stripe-error');
        if (errEl) {
          errEl.textContent = ev.error ? ev.error.message : '';
          errEl.style.display = ev.error ? 'block' : 'none';
        }
      });
    } catch (e) {
      console.error('Stripe init failed:', e);
      const errEl = document.getElementById('ev-stripe-error');
      if (errEl) {
        errEl.textContent = 'Erreur d\'initialisation Stripe.';
        errEl.style.display = 'block';
      }
      return;
    }

    const payBtn = document.getElementById('ev-pay-btn');
    if (!payBtn) return;
    payBtn.addEventListener('click', () => handlePay(info));
  }

  async function waitForStatusChange(token, maxAttempts = 8, delayMs = 1500) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, delayMs));
      try {
        const r = await fetch('/api/collective-payments/' + encodeURIComponent(token));
        if (!r.ok) break;
        const data = await r.json();
        if (data.token_status === 'authorized' || data.token_status === 'paid') break;
      } catch (_) { break; }
    }
  }

  async function handlePay(info) {
    const btn = document.getElementById('ev-pay-btn');
    const errEl = document.getElementById('ev-stripe-error');
    const billingName = (info.contributor_name || '').trim();

    if (!_stripe || !_stripeCard) {
      if (errEl) {
        errEl.textContent = 'Stripe non prêt. Rechargez la page.';
        errEl.style.display = 'block';
      }
      return;
    }
    btn.disabled = true;
    btn.textContent = '⏳ Sécurisation…';
    if (errEl) { errEl.style.display = 'none'; }

    try {
      // ── Étape 1 : créer/récupérer le PaymentIntent côté backend ──
      const intentRes = await fetch('/api/collective-payments/' +
        encodeURIComponent(getPaymentToken()) + '/pay-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!intentRes.ok) {
        const err = await intentRes.json().catch(() => ({}));
        throw new Error(err.message || ('Erreur ' + intentRes.status));
      }
      const intent = await intentRes.json();

      btn.textContent = '⏳ Validation…';

      // ── Étape 2 : confirmer côté Stripe ──
      const result = await _stripe.confirmCardPayment(intent.client_secret, {
        payment_method: {
          card: _stripeCard,
          billing_details: { name: billingName },
        },
      });

      if (result.error) {
        throw new Error(result.error.message || 'Paiement refusé.');
      }

      // ── Étape 3 : succès — attendre confirmation backend puis reload ──
      btn.textContent = '✅ Confirmé !';
      await waitForStatusChange(getPaymentToken());
      window.location.reload();
    } catch (e) {
      console.error('handlePay:', e);
      if (errEl) { errEl.textContent = e.message || 'Échec du paiement.'; errEl.style.display = 'block'; }
      btn.disabled = false;
      btn.textContent = '💳 Confirmer ma part — ' + fmt(info.amount_kmf) + ' KMF';
    }
  }

  async function load() {
    const token = getPaymentToken();
    if (!token) { showError('Lien de paiement invalide.'); return; }
    try {
      const res = await fetch('/api/collective-payments/' + encodeURIComponent(token));
      if (res.status === 404) { showError('Lien de paiement introuvable ou déjà utilisé.'); return; }
      if (!res.ok) { showError('Erreur ' + res.status + ' lors du chargement.'); return; }
      const data = await res.json();
      render(data);
    } catch (err) {
      console.error(err);
      showError('Erreur réseau. Réessayez plus tard.');
    }
  }

  load();
})();
