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

    // ── Identité événement ─────────────────────────────────────
    html += '<div class="ev-card">';
    html += '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
    html += '<div style="flex:1;min-width:200px;">';
    html += '<h2 class="ev-card-title">' + escHtml(info.event_name || 'Panier événement') + '</h2>';
    if (info.recipient_name) {
      html += '<div class="ev-card-sub">📍 Pour ' + escHtml(info.recipient_name) + '</div>';
    }
    html += '<div class="ev-card-sub" style="margin-top:6px;">Bonjour <strong>' + escHtml(info.contributor_name) + '</strong></div>';
    html += '</div>';
    html += '<div>' + statusBadge(info.token_status) + '</div>';
    html += '</div>';
    html += '</div>';

    // ── Montant + compteur ─────────────────────────────────────
    html += '<div class="ev-card">';
    html += '<h3 class="ev-card-title" style="font-size:15px;">💳 Votre part</h3>';
    html += '<div class="ev-totals">';
    html += '<div class="ev-totals-row ev-totals-row--final">';
    html += '<span>Montant à confirmer</span>';
    html += '<span>' + fmt(info.amount_kmf) + ' KMF</span>';
    html += '</div></div>';

    // Compteur neutre (paiements confirmés / total)
    if (info.paiements_confirmes) {
      html += '<div class="ev-help" style="margin-top:10px;text-align:center;">';
      html += '🤝 Paiements confirmés : <strong>' + escHtml(info.paiements_confirmes) + '</strong>';
      html += '</div>';
    }

    if (info.session_expires_at) {
      const dt = new Date(info.session_expires_at);
      html += '<div class="ev-help" style="margin-top:6px;text-align:center;">';
      html += '📅 Session valable jusqu\'au <strong>' +
        dt.toLocaleDateString('fr-FR') + ' ' +
        dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</strong>';
      html += '</div>';
    }
    html += '</div>';

    // ── Statut spécifique ──────────────────────────────────────
    if (isPaid) {
      html += '<div class="ev-info" style="background:#dcfce7;color:#166534;border-color:#86efac;">';
      html += '✅ <strong>Merci pour votre participation !</strong><br>';
      html += 'Votre paiement de ' + fmt(info.amount_kmf) + ' KMF est confirmé.';
      html += '</div>';
    } else if (info.token_status === 'expired') {
      html += '<div class="ev-warning">';
      html += '⏰ Cette session de paiement est terminée. Contactez le créateur du panier pour relancer.';
      html += '</div>';
    } else if (info.token_status === 'cancelled') {
      html += '<div class="ev-warning">Ce paiement a été annulé.</div>';
    } else if (isAuthorized) {
      html += '<div class="ev-info">';
      html += '⏳ <strong>Votre carte a été préautorisée.</strong><br>';
      html += 'Le débit aura lieu quand <em>tous</em> les contributeurs auront confirmé leur part.';
      html += '</div>';
    }

    // ── Formulaire Stripe ──────────────────────────────────────
    if (!isFinal && !isAuthorized) {
      html += '<div class="ev-card">';
      html += '<h3 class="ev-card-title" style="font-size:15px;">🔒 Paiement sécurisé</h3>';
      html += '<p class="ev-card-sub">Renseignez votre carte. ' +
              'Aucun débit avant que toutes les parts soient confirmées.</p>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="ev-billing-name">Nom sur la carte</label>';
      html += '<input type="text" id="ev-billing-name" class="ev-input" placeholder="Ex : ' + escHtml(info.contributor_name) + '">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label">Carte bancaire</label>';
      html += '<div id="ev-stripe-card" style="padding:12px;border:1px solid var(--ev-border);border-radius:6px;background:white;"></div>';
      html += '<div id="ev-stripe-error" class="ev-help" style="color:#dc2626;margin-top:6px;display:none;"></div>';
      html += '</div>';

      html += '<button id="ev-pay-btn" class="ev-btn ev-btn-success ev-btn-block">' +
              '💳 Confirmer ma part — ' + fmt(info.amount_kmf) + ' KMF</button>';
      html += '</div>';
    }

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    // ── Init Stripe si formulaire visible ──
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

  async function handlePay(info) {
    const btn = document.getElementById('ev-pay-btn');
    const errEl = document.getElementById('ev-stripe-error');
    const nameInput = document.getElementById('ev-billing-name');
    const billingName = (nameInput && nameInput.value || info.contributor_name || '').trim();

    if (!_stripe || !_stripeCard) {
      if (errEl) {
        errEl.textContent = 'Stripe non prêt. Rechargez la page.';
        errEl.style.display = 'block';
      }
      return;
    }
    if (!billingName) {
      if (errEl) { errEl.textContent = 'Indiquez le nom sur la carte.'; errEl.style.display = 'block'; }
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

      // ── Étape 3 : succès — recharger pour voir le nouveau statut ──
      btn.textContent = '✅ Confirmé !';
      setTimeout(() => window.location.reload(), 1200);
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
