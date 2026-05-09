/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page PAIEMENT CASH (boutique)

   Route : /event/pay/:paymentToken
   Lit   : GET  /api/collective-payments/:token        (info contributeur)
   Pay   : POST /api/collective-payments/:token/pay-cash  (à implémenter backend)

   Aucun paiement réel ici : juste une confirmation "je paierai cash au relais".
   Le backend doit marquer le contributor comme `authorized` (ou équivalent).
   La commande sera créée quand tous auront confirmé.
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl   = document.getElementById('ev-error-block');

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

  function statusBadge(status) {
    if (status === 'paid') return '<span class="ev-badge ev-badge-paid">✓ Payé</span>';
    if (status === 'authorized') return '<span class="ev-badge ev-badge-auth">Confirmé</span>';
    if (status === 'expired') return '<span class="ev-badge" style="background:#fee2e2;color:#991b1b;">Expiré</span>';
    if (status === 'cancelled') return '<span class="ev-badge" style="background:#fee2e2;color:#991b1b;">Annulé</span>';
    return '<span class="ev-badge ev-badge-pending">À confirmer</span>';
  }

  function render(info) {
    const isPaid       = info.token_status === 'paid';
    const isAuthorized = info.token_status === 'authorized';
    const isFinal      = isPaid || info.token_status === 'expired' || info.token_status === 'cancelled';

    let html = '';

    // ── Hero vert (paiement / confirmation) ────────────────────
    html += '<div class="ev-hero ev-hero--pay">';
    html += '<div class="ev-hero-badge">' + statusBadge(info.token_status) + '</div>';
    html += '<div class="ev-hero-eyebrow">Bonjour ' + escHtml(info.contributor_name || '') + '</div>';
    html += '<h1 class="ev-hero-title">' + escHtml(info.event_name || 'Panier collectif') + '</h1>';
    html += '<div class="ev-hero-amount">';
    html += '<span class="ev-hero-amount-num">' + fmt(info.amount_kmf) + '</span>';
    html += '<span class="ev-hero-amount-cur">KMF</span>';
    html += '</div>';
    if (info.recipient_name) {
      html += '<p class="ev-hero-sub" style="margin-top:10px;">Pour <strong>' + escHtml(info.recipient_name) + '</strong></p>';
    }
    html += '</div>';

    // ── Statut final ───────────────────────────────────────────
    if (isPaid) {
      html += '<div class="ev-alert ev-alert-success" style="text-align:center;">';
      html += '✅ <strong>Paiement confirmé — Merci !</strong>';
      html += '</div>';
    } else if (info.token_status === 'expired') {
      html += '<div class="ev-alert ev-alert-warn">⏰ Lien expiré. Contactez l\'organisateur du panier.</div>';
    } else if (info.token_status === 'cancelled') {
      html += '<div class="ev-alert ev-alert-warn">Cette participation a été annulée.</div>';
    } else if (isAuthorized) {
      html += '<div class="ev-alert ev-alert-violet" style="text-align:center;">';
      html += '🤝 <strong>Votre engagement est noté.</strong><br>';
      html += '<span style="font-size:13px;">Vous paierez <strong>' + fmt(info.amount_kmf) + ' KMF</strong> en cash au retrait du panier en relais. ';
      html += 'L\'organisateur sera notifié dès que tous auront confirmé.</span>';
      html += '</div>';
    }

    // ── Confirmation cash (cas normal, pas encore confirmé) ────
    if (!isFinal && !isAuthorized) {
      // Bloc "comment ça marche"
      html += '<div class="ev-card">';
      html += '<p class="ev-card-label">Comment ça marche</p>';
      html += '<ul class="ev-list" style="list-style:none;padding-left:0;">';
      html += '<li class="ev-list-item"><div class="ev-list-emoji">1</div><div class="ev-list-content">';
      html += '<div class="ev-list-name">Confirmez votre engagement ici</div>';
      html += '<div class="ev-list-meta">Aucun débit — juste une réservation de votre part</div></div></li>';
      html += '<li class="ev-list-item"><div class="ev-list-emoji">2</div><div class="ev-list-content">';
      html += '<div class="ev-list-name">L\'organisateur reçoit toutes les confirmations</div>';
      html += '<div class="ev-list-meta">Quand tout le monde a confirmé, la commande est lancée</div></div></li>';
      html += '<li class="ev-list-item"><div class="ev-list-emoji">3</div><div class="ev-list-content">';
      html += '<div class="ev-list-name">Vous payez en cash au relais</div>';
      html += '<div class="ev-list-meta">Au retrait du panier, vous réglez votre part directement</div></div></li>';
      html += '</ul>';
      html += '</div>';

      // Bouton de confirmation
      html += '<div class="ev-card">';
      html += '<button id="ev-pay-btn" class="ev-btn ev-btn-confirm ev-btn-block" style="font-size:16px;padding:15px 20px;">';
      html += '✅ Je confirme ma part — ' + fmt(info.amount_kmf) + ' KMF en cash';
      html += '</button>';
      html += '<div id="ev-pay-error" class="ev-help" style="color:#dc2626;margin-top:8px;display:none;"></div>';
      html += '<p class="ev-help" style="text-align:center;margin-top:10px;">';
      html += 'En confirmant, vous vous engagez à apporter <strong>' + fmt(info.amount_kmf) + ' KMF</strong> en espèces lors du retrait. ';
      html += 'Aucun débit ne sera effectué.';
      html += '</p>';
      html += '</div>';
    }

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    if (!isFinal && !isAuthorized) {
      const btn = document.getElementById('ev-pay-btn');
      if (btn) btn.addEventListener('click', () => handleConfirmCash(info));
    }
  }

  async function handleConfirmCash(info) {
    const btn = document.getElementById('ev-pay-btn');
    const errEl = document.getElementById('ev-pay-error');
    if (errEl) errEl.style.display = 'none';

    btn.disabled = true;
    btn.textContent = '⏳ Enregistrement…';

    try {
      const res = await fetch('/api/collective-payments/' +
        encodeURIComponent(getPaymentToken()) + '/pay-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      // Endpoint pas encore implémenté côté backend : on dégrade gracieusement
      if (res.status === 404 || res.status === 405) {
        if (errEl) {
          errEl.innerHTML = 'Le système de confirmation cash n\'est pas encore activé. ' +
            'Contactez directement l\'organisateur pour confirmer votre participation.';
          errEl.style.display = 'block';
        }
        btn.disabled = false;
        btn.textContent = '✅ Je confirme ma part — ' + fmt(info.amount_kmf) + ' KMF en cash';
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || ('Erreur ' + res.status));
      }

      btn.textContent = '✅ Confirmé !';
      // Petit délai pour la transition visuelle puis recharge la page
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      console.error('handleConfirmCash:', e);
      if (errEl) {
        errEl.textContent = e.message || 'Échec de la confirmation. Réessayez.';
        errEl.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = '✅ Je confirme ma part — ' + fmt(info.amount_kmf) + ' KMF en cash';
    }
  }

  async function load() {
    const token = getPaymentToken();
    if (!token) { showError('Lien de paiement invalide.'); return; }
    try {
      const res = await fetch('/api/collective-payments/' + encodeURIComponent(token));
      if (res.status === 404) { showError('Lien introuvable ou déjà utilisé.'); return; }
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
