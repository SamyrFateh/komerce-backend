/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-track.js
   Order tracking view + favorites view
   Depends on: b-config.js, b-state.js, b-ui.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  const TRACK_STEPS = [
    { key: 'pending',            icon: '📝', label: 'Commande reçue',    sub: 'En attente de confirmation' },
    { key: 'confirmed',          icon: '✅', label: 'Confirmée',         sub: 'Votre commande est confirmée' },
    { key: 'preparing',          icon: '📦', label: 'Préparation',       sub: 'En cours de préparation' },
    { key: 'shipped_to_transit', icon: '✈️', label: 'Expédié',           sub: 'En route vers les Comores' },
    { key: 'in_transit',         icon: '🚢', label: 'En transit',        sub: 'En cours d\'acheminement' },
    { key: 'arrived_at_relay',   icon: '🏪', label: 'Arrivé au relais',  sub: 'Disponible pour retrait' },
    { key: 'delivered',          icon: '🎉', label: 'Livré',             sub: 'Commande récupérée' },
  ];

  K.buildTimeline = function (status) {
    const idx = TRACK_STEPS.findIndex(s => s.key === status);
    return TRACK_STEPS.map((s, i) => {
      const done    = i < idx;
      const current = i === idx;
      const cls     = done ? 'done' : current ? 'active' : '';
      return '<div class="k-timeline-step ' + cls + '">' +
        '<div class="k-timeline-dot">' + (done ? '✓' : s.icon) + '</div>' +
        '<div>' +
          '<div class="k-timeline-label">' + s.label + '</div>' +
          '<div class="k-timeline-sub">' + s.sub + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  };

  K.renderOrdersHistory = function (orders, container) {
    if (!orders.length) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--ink-3);">Aucune commande trouvée.</div>';
      return;
    }
    container.innerHTML = orders.map(o =>
      '<div class="k-order-card">' +
        '<div class="k-order-card-head">' +
          '<span class="k-order-ref">' + K.sanitize(o.reference || o.id) + '</span>' +
          '<span class="k-order-date">' + (o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : '') + '</span>' +
        '</div>' +
        '<div class="k-order-card-total">' + K.fmt(o.total_amount || 0, 'KMF') + '</div>' +
        '<div class="k-timeline">' + K.buildTimeline(o.status || 'pending') + '</div>' +
      '</div>'
    ).join('');
  };

  K.renderOrderDetail = function (order, container) {
    container.innerHTML =
      '<div class="k-order-card">' +
        '<div class="k-order-card-head">' +
          '<span class="k-order-ref">' + K.sanitize(order.reference || order.id) + '</span>' +
          '<span class="k-order-date">' + (order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : '') + '</span>' +
        '</div>' +
        '<div class="k-order-card-total">' + K.fmt(order.total_amount || 0, 'KMF') + '</div>' +
        '<div class="k-timeline">' + K.buildTimeline(order.status || 'pending') + '</div>' +
      '</div>';
  };

  K.prefillTrack = function (ref, phone) {
    setTimeout(() => {
      const refInput = document.getElementById('k-otp-ref');
      if (refInput && ref) { refInput.value = ref; document.getElementById('k-otp-ref-btn')?.click(); }
    }, 300);
  };

  K.renderTrackView = function () {
    let el = document.getElementById('k-track-view');
    if (!el) {
      el = document.createElement('div');
      el.id        = 'k-track-view';
      el.className = 'k-track-wrap';
      const favEl = document.getElementById('k-fav-view') || document.getElementById('k-catalog-section');
      if (favEl) favEl.after(el);
      else document.body.appendChild(el);
    }

    const otpState = { email: '' };

    el.innerHTML =
      '<h2 class="k-track-title">📦 Suivi & Historique</h2>' +

      '<!-- Step 1 -->' +
      '<div id="k-otp-step1" class="k-track-form" style="display:flex;flex-direction:column;gap:10px;">' +
        '<div>' +
          '<label class="k-form-label">Email de la commande</label>' +
          '<input class="k-form-input" id="k-otp-email" type="email" placeholder="votre@email.com" autocomplete="email" inputmode="email">' +
        '</div>' +
        '<button class="k-track-btn" id="k-otp-request-btn">Envoyer le code</button>' +
        '<div style="text-align:center;color:var(--ink-3);font-size:13px;">ou</div>' +
        '<div>' +
          '<label class="k-form-label">Référence de commande</label>' +
          '<input class="k-form-input" id="k-otp-ref" type="text" placeholder="KMR-2025-0042" autocomplete="off" style="text-transform:uppercase">' +
        '</div>' +
        '<button class="k-track-btn" style="background:var(--ivoire-dark);color:var(--ink-2);" id="k-otp-ref-btn">🔍 Suivre sans code</button>' +
      '</div>' +

      '<!-- Step 2: OTP -->' +
      '<div id="k-otp-step2" style="display:none;">' +
        '<div style="background:var(--prairie-light);border-radius:var(--radius);padding:10px 12px;font-size:13px;margin-bottom:12px;">' +
          '📧 Code envoyé à <strong id="k-otp-email-display"></strong>' +
        '</div>' +
        '<input class="k-form-input" id="k-otp-code" type="text" inputmode="numeric" placeholder="_ _ _ _ _ _" maxlength="6" autocomplete="one-time-code" style="text-align:center;font-size:22px;letter-spacing:8px;margin-bottom:8px;">' +
        '<button class="k-track-btn" id="k-otp-verify-btn" style="margin-bottom:8px;">Vérifier</button>' +
        '<button style="background:none;border:none;color:var(--terracotta);font-size:13px;cursor:pointer;text-decoration:underline;" id="k-otp-resend-btn">Renvoyer le code</button>' +
      '</div>' +

      '<!-- Step 3: Results -->' +
      '<div id="k-otp-step3" style="display:none;">' +
        '<div id="k-orders-list"></div>' +
        '<button class="k-track-btn" style="background:var(--ivoire-dark);color:var(--ink-2);margin-top:12px;" id="k-otp-back-btn">← Nouvelle recherche</button>' +
      '</div>';

    // Step 1a — OTP by email
    el.querySelector('#k-otp-request-btn').addEventListener('click', async () => {
      const email = el.querySelector('#k-otp-email').value.trim();
      if (!email || !email.includes('@')) { K.showToast('Email invalide.', 'error'); return; }
      const btn = el.querySelector('#k-otp-request-btn');
      btn.disabled = true; btn.textContent = '⏳ Envoi…';
      try {
        await K.apiPost('/api/auth/otp/request', { email });
        otpState.email = email;
        el.querySelector('#k-otp-email-display').textContent = email;
        el.querySelector('#k-otp-step1').style.display = 'none';
        el.querySelector('#k-otp-step2').style.display = 'block';
        K.showToast('📧 Code envoyé !', 'success');
      } catch (e) {
        K.showToast('Erreur lors de l\'envoi.', 'error');
        btn.disabled = false; btn.textContent = 'Envoyer le code';
      }
    });

    // Step 1b — reference lookup (no auth)
    el.querySelector('#k-otp-ref-btn').addEventListener('click', async () => {
      const ref = el.querySelector('#k-otp-ref').value.trim().toUpperCase();
      if (!ref) { K.showToast('Entrez une référence.', 'error'); return; }
      const btn = el.querySelector('#k-otp-ref-btn');
      btn.disabled = true; btn.textContent = '⏳ Recherche…';
      try {
        const data = await K.apiGet('/api/orders/public/' + encodeURIComponent(ref));
        el.querySelector('#k-otp-step1').style.display = 'none';
        el.querySelector('#k-otp-step3').style.display = 'block';
        K.renderOrderDetail(data.order || data, el.querySelector('#k-orders-list'));
      } catch (e) {
        K.showToast('Référence introuvable.', 'error');
        btn.disabled = false; btn.textContent = '🔍 Suivre sans code';
      }
    });

    // Step 2 — verify OTP
    el.querySelector('#k-otp-verify-btn').addEventListener('click', async () => {
      const code = el.querySelector('#k-otp-code').value.replace(/\s/g, '');
      if (code.length < 4) { K.showToast('Code incomplet.', 'error'); return; }
      const btn = el.querySelector('#k-otp-verify-btn');
      btn.disabled = true; btn.textContent = '⏳ Vérification…';
      try {
        const result = await K.apiPost('/api/auth/otp/verify', { email: otpState.email, code });
        el.querySelector('#k-otp-step2').style.display = 'none';
        el.querySelector('#k-otp-step3').style.display = 'block';
        K.renderOrdersHistory(result.orders || [], el.querySelector('#k-orders-list'));
      } catch (e) {
        K.showToast('Code incorrect ou expiré.', 'error');
        btn.disabled = false; btn.textContent = 'Vérifier';
      }
    });

    // Resend
    let resendTimer = null;
    el.querySelector('#k-otp-resend-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#k-otp-resend-btn');
      if (resendTimer) return;
      btn.disabled = true; btn.textContent = '⏳ Renvoi…';
      try {
        await K.apiPost('/api/auth/otp/request', { email: otpState.email });
        K.showToast('📧 Nouveau code envoyé !', 'success');
        let cd = 30;
        resendTimer = setInterval(() => {
          cd--;
          btn.textContent = 'Renvoyer (' + cd + 's)';
          if (cd <= 0) { clearInterval(resendTimer); resendTimer = null; btn.disabled = false; btn.textContent = 'Renvoyer le code'; }
        }, 1000);
      } catch (e) {
        K.showToast('Erreur de renvoi.', 'error');
        btn.disabled = false; btn.textContent = 'Renvoyer le code';
      }
    });

    // Back
    el.querySelector('#k-otp-back-btn').addEventListener('click', () => K.renderTrackView());
  };

  // ── FAV VIEW ──────────────────────────────────────────────
  K.renderFavView = function () {
    let el = document.getElementById('k-fav-view');
    if (!el) {
      el = document.createElement('div');
      el.id        = 'k-fav-view';
      el.className = 'k-fav-view-wrap';
      const catSec = document.getElementById('k-catalog-section');
      if (catSec) catSec.after(el);
    }
    const favProducts = K.state.products.filter(p => K.state.favs.includes(p.id));
    if (!favProducts.length) {
      el.innerHTML = '<div class="k-fav-empty"><span style="font-size:48px;display:block;margin-bottom:12px;">❤️</span><span style="font-size:15px;font-weight:500;">Aucun favori pour l\'instant</span></div>';
      return;
    }
    el.innerHTML = '<h2 style="font-size:18px;font-weight:700;padding:16px 12px 8px;">❤️ Mes Favoris</h2>';
    const grid = document.createElement('div');
    grid.className = 'k-grid';
    favProducts.forEach(p => grid.appendChild(K._buildCard(p)));
    el.appendChild(grid);
  };

})(window.K = window.K || {});
