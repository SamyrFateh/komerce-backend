/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page PUBLIQUE / PARTICIPER (boutique)
   Route : /event/w/:public_token
   Lit   : GET  /api/collective-workspaces/public/:token
   Pose  : POST /api/collective-workspaces/public/:token/contributions
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl   = document.getElementById('ev-error-block');

  function getPublicToken() {
    let m = window.location.pathname.match(/\/event\/w\/([^\/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = window.location.pathname.match(/\/workspace\/([^\/?#]+)/);
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

  function isMobileWA() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }
  function whatsappShareUrl(eventName) {
    const text = encodeURIComponent(
      'Hey ! "' + (eventName || 'Panier collectif') + '" sur Komerce.\n' +
      'Rejoins le panier ici : ' + window.location.href
    );
    return isMobileWA() ? 'whatsapp://send?text=' + text : 'https://wa.me/?text=' + text;
  }

  function normalizeWorkspaceResponse(payload) {
    const root = payload || {};
    const ws = Object.assign({}, root.workspace || root);
    ws.items = Array.isArray(root.items) ? root.items.map((it) => ({
      id: it.id,
      quantity: Number(it.quantity) || 1,
      product_name: it.product_name || it.product_name_snapshot || it.name || 'Article',
      price_kmf: Number(it.price_kmf ?? it.price_snapshot_kmf) || 0,
    })) : [];
    return ws;
  }

  function getPhase(ws) { return ws.phase || ws.status || 'draft'; }
  function acceptsContribs(phase) {
    return phase === 'draft' || phase === 'collecting' || phase === 'reviewing';
  }
  function phaseLabel(phase) {
    if (phase === 'collecting') return 'Collecte en cours';
    if (phase === 'reviewing') return 'Validation en cours';
    if (phase === 'finalized' || phase === 'payment_pending') return 'En attente des paiements';
    if (phase === 'partially_paid') return 'Paiements en cours';
    if (phase === 'paid' || phase === 'order_created') return 'Commande confirmée';
    if (phase === 'expired') return 'Session expirée';
    if (phase === 'cancelled') return 'Annulé';
    return 'En préparation';
  }

  function render(ws) {
    const items   = ws.items || [];
    const phase   = getPhase(ws);
    const isOpen  = acceptsContribs(phase);
    const total   = items.reduce((s, it) => s + (it.price_kmf || 0) * (it.quantity || 1), 0);

    let html = '';

    // ── Hero violet ───────────────────────────────────────────
    html += '<div class="ev-hero">';
    html += '<div class="ev-hero-badge">' + escHtml(phaseLabel(phase)) + '</div>';
    if (ws.creator_name) {
      html += '<div class="ev-hero-eyebrow">' + escHtml(ws.creator_name) + ' · Organisateur</div>';
    }
    html += '<h1 class="ev-hero-title">' + escHtml(ws.event_name || 'Panier collectif') + '</h1>';
    if (ws.event_note) {
      html += '<p class="ev-hero-sub">« ' + escHtml(ws.event_note) + ' »</p>';
    }
    if (total) {
      html += '<div class="ev-hero-amount">';
      html += '<span class="ev-hero-amount-num">' + fmt(total) + '</span>';
      html += '<span class="ev-hero-amount-cur">KMF total</span>';
      html += '</div>';
    }
    html += '</div>';

    // ── Liste articles (collapsible) ──────────────────────────
    html += '<details class="ev-card ev-collapsible">';
    html += '<summary class="ev-card-summary">';
    html += '<span class="ev-card-label" style="margin:0;">Le panier (' + items.length + ' article' + (items.length > 1 ? 's' : '') + ')</span>';
    html += '<span class="ev-card-summary-icon" aria-hidden="true">▾</span>';
    html += '</summary>';
    if (!items.length) {
      html += '<div class="ev-empty">L\'organisateur prépare encore le panier.</div>';
    } else {
      html += '<ul class="ev-list">';
      items.forEach((it) => {
        const qty = it.quantity || 1;
        const lt = (it.price_kmf || 0) * qty;
        html += '<li class="ev-list-item">';
        html += '<div class="ev-list-emoji">📦</div>';
        html += '<div class="ev-list-content">';
        html += '<div class="ev-list-name">' + escHtml(it.product_name) + '</div>';
        html += '<div class="ev-list-meta">' + qty + ' × ' + fmt(it.price_kmf) + ' KMF</div>';
        html += '</div>';
        html += '<div class="ev-list-right"><div class="ev-list-amount">' + fmt(lt) + '</div></div>';
        html += '</li>';
      });
      html += '</ul>';
    }
    html += '</details>';

    // ── Formulaire de contribution ────────────────────────────
    if (isOpen) {
      html += '<div class="ev-card">';
      html += '<p class="ev-card-label">Votre proposition</p>';
      html += '<p class="ev-card-sub ev-compact-hide">Proposez un montant ou un message. Aucun paiement maintenant — vous paierez en cash au retrait.</p>';

      html += '<form id="ev-contrib-form" style="margin-top:8px;">';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="contributor_name">Votre nom</label>';
      html += '<input type="text" id="contributor_name" name="contributor_name" class="ev-input" required maxlength="80" placeholder="Ex : Fatouma Saïd">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="contributor_phone">Téléphone <span class="ev-label-opt">(WhatsApp)</span></label>';
      html += '<div class="ev-phone-row">';
      html += '<select class="ev-phone-prefix" id="ev-prefix-select" aria-label="Indicatif">';
      html += '<option value="+269">🇰🇲 +269</option>';
      html += '<option value="+33">🇫🇷 +33</option>';
      html += '<option value="+262">🇷🇪 +262</option>';
      html += '<option value="+255">🇹🇿 +255</option>';
      html += '<option value="+254">🇰🇪 +254</option>';
      html += '</select>';
      html += '<input type="tel" id="contributor_phone" name="contributor_phone" class="ev-input" maxlength="25" placeholder="Votre numéro">';
      html += '</div>';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="contributor_email">Email <span class="ev-label-opt">(optionnel)</span></label>';
      html += '<input type="email" id="contributor_email" name="contributor_email" class="ev-input" maxlength="120" placeholder="exemple@email.com">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="amount_kmf">Montant proposé</label>';
      html += '<div class="ev-amount-row">';
      html += '<input type="number" id="amount_kmf" name="amount_kmf" class="ev-input" placeholder="Ex : 5 000" min="0" step="500">';
      html += '<span class="ev-amount-suffix">KMF</span>';
      html += '</div>';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="message">Message <span class="ev-label-opt">(optionnel)</span></label>';
      html += '<textarea id="message" name="message" class="ev-textarea" rows="2" maxlength="300" placeholder="Un mot pour le groupe…"></textarea>';
      html += '</div>';

      html += '<button type="submit" class="ev-btn ev-btn-violet ev-btn-block" id="ev-contrib-submit" style="font-size:15px;padding:14px;">Envoyer ma proposition →</button>';
      html += '<div id="ev-contrib-error" class="ev-alert ev-alert-warn" style="display:none;margin-top:10px;"></div>';
      html += '<div id="ev-contrib-success" class="ev-alert ev-alert-success" style="display:none;margin-top:10px;"></div>';
      html += '</form>';

      html += '<p class="ev-help ev-compact-hide" style="text-align:center;margin-top:12px;">🔒 Vos infos restent privées. Aucun débit automatique.</p>';
      html += '</div>';
    } else {
      html += '<div class="ev-alert ev-alert-warn">Ce panier n\'accepte plus de nouvelles propositions. L\'organisateur est passé à l\'étape suivante.</div>';
    }

    // ── Inviter d'autres (caché en mode compact, déplacé dans le footer help) ─
    html += '<div class="ev-card ev-compact-hide" style="text-align:center;">';
    html += '<p class="ev-card-label">Inviter d\'autres participants</p>';
    html += '<a href="' + whatsappShareUrl(ws.event_name) + '" target="_blank" rel="noopener" class="ev-btn ev-btn-wa ev-btn-block" style="margin-top:8px;">📱 Partager sur WhatsApp</a>';
    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    // ── Wire form ────────────────────────────────────────────
    const form = document.getElementById('ev-contrib-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('ev-contrib-error');
      const okEl  = document.getElementById('ev-contrib-success');
      const btn   = document.getElementById('ev-contrib-submit');
      errEl.style.display = 'none';
      okEl.style.display  = 'none';

      const fd = new FormData(form);
      const sel = document.getElementById('ev-prefix-select');
      const rawPhone = (fd.get('contributor_phone') || '').trim();
      let phone = null;
      if (rawPhone) {
        phone = rawPhone.startsWith('+')
          ? rawPhone
          : (sel ? sel.value : '+269') + rawPhone.replace(/^0/, '');
      }
      const amount = Number(fd.get('amount_kmf')) || null;

      const payload = {
        contributor_name:    (fd.get('contributor_name') || '').trim(),
        contributor_phone:   phone,
        contributor_email:   (fd.get('contributor_email') || '').trim() || null,
        suggestion:          null,
        intended_amount_kmf: amount,
        message:             (fd.get('message') || '').trim() || null,
        kind:                amount > 0 ? 'intention' : 'suggestion',
      };

      if (!payload.contributor_name) {
        errEl.textContent = 'Votre nom est requis.';
        errEl.style.display = 'block'; return;
      }
      if (!payload.contributor_phone && !payload.contributor_email) {
        errEl.textContent = 'Indiquez au moins un téléphone ou un email.';
        errEl.style.display = 'block'; return;
      }
      if (!payload.intended_amount_kmf && !payload.message) {
        errEl.textContent = 'Proposez au moins un montant ou un message.';
        errEl.style.display = 'block'; return;
      }

      btn.disabled = true;
      btn.textContent = '⏳ Envoi…';
      try {
        const res = await fetch(
          '/api/collective-workspaces/public/' + encodeURIComponent(getPublicToken()) + '/contributions',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || ('Erreur ' + res.status));
        }
        okEl.innerHTML = 'Merci <strong>' + escHtml(payload.contributor_name) +
          '</strong> ! Votre proposition a bien été envoyée à l\'organisateur.';
        okEl.style.display = 'block';
        form.reset();
        btn.disabled = false;
        btn.textContent = 'Envoyer ma proposition →';
      } catch (err) {
        errEl.textContent = err.message || 'Erreur lors de l\'envoi.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Envoyer ma proposition →';
      }
    });
  }

  async function load() {
    const token = getPublicToken();
    if (!token) return showError('Lien invalide.');
    try {
      const res = await fetch('/api/collective-workspaces/public/' + encodeURIComponent(token));
      if (res.status === 404) return showError('Ce panier n\'existe pas ou n\'est plus accessible.');
      if (!res.ok) return showError('Erreur ' + res.status + ' lors du chargement.');
      render(normalizeWorkspaceResponse(await res.json()));
    } catch (err) {
      console.error(err);
      showError('Erreur réseau. Réessayez plus tard.');
    }
  }

  load();
})();
