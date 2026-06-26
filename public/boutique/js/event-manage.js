/**
 * @komerce-arch
 * @role          collective-workspace-manager
 * @domain        collective-workspace
 * @layer         ui-page
 * @criticality   medium
 * @inputs        workspace_id, auth_context, workspace_mutations
 * @outputs       workspace_admin_view, participant_links, management_actions
 * @depends       routes/collective-workspaces.js
 * @used-by       event-management-pages
 * @doctrine      workspace_partage_lisible, lien_public_controle, action_createur_tracee
 * @impact-areas  collective-workspaces, event-flow, creator-management
 * @version       2026-06
 */
'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page ORGANISATEUR (boutique)
   Route : /event/manage/:creator_token
   Lit   : GET  /api/collective-workspaces/me/:token
   Fin.  : POST /api/collective-workspaces/:token/finalization-review
           POST /api/collective-workspaces/:token/finalize
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl   = document.getElementById('ev-error-block');

  function getCreatorToken() {
    let m = window.location.pathname.match(/\/event\/manage\/([^\/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = window.location.pathname.match(/\/event\/([^\/?#]+)\/manage/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showError(msg) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = msg;
  }

  function publicUrl(publicToken) {
    return window.location.origin + '/event/w/' + encodeURIComponent(publicToken);
  }

  function isMobileWA() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function whatsappShareUrl(eventName, publicToken) {
    const text = encodeURIComponent(
      'Bonjour ! J\'organise "' + (eventName || 'Panier collectif') + '" sur Komerce.\n' +
      'Tu peux ajouter tes idées ou ta participation ici : ' + publicUrl(publicToken)
    );
    return isMobileWA() ? 'whatsapp://send?text=' + text : 'https://wa.me/?text=' + text;
  }

  function whatsappDirect(phone, text) {
    const clean = String(phone || '').replace(/\D/g, '');
    if (isMobileWA()) {
      return clean ? 'whatsapp://send?phone=' + clean + '&text=' + text : 'whatsapp://send?text=' + text;
    }
    return clean ? 'https://wa.me/' + clean + '?text=' + text : 'https://wa.me/?text=' + text;
  }

  function getPhase(ws) { return ws.phase || ws.status || 'draft'; }
  function phaseLabel(phase) {
    if (phase === 'collecting')                                return 'Collecte en cours';
    if (phase === 'reviewing')                                 return 'Validation en cours';
    if (phase === 'finalized' || phase === 'payment_pending')  return 'Confirmations en attente';
    if (phase === 'partially_paid')                            return 'Confirmations en cours';
    if (phase === 'paid' || phase === 'order_created')         return 'Commande confirmée';
    if (phase === 'expired')                                   return 'Session expirée';
    if (phase === 'cancelled')                                 return 'Annulé';
    return 'En préparation';
  }

  function getStoredEventMeta(creatorToken) {
    if (!creatorToken) return null;
    try {
      const stored = JSON.parse(localStorage.getItem('komerce-events') || '[]');
      return stored.find((e) => e && e.creator_token === creatorToken) || null;
    } catch (_) { return null; }
  }

  function normalizeWorkspaceResponse(payload) {
    const root = payload || {};
    const ws = Object.assign({}, root.workspace || root);
    ws.items = Array.isArray(root.items) ? root.items.map((it) => ({
      id: it.id,
      quantity: Number(it.quantity) || 1,
      product_id: it.product_id || null,
      product_name: it.product_name || it.product_name_snapshot || it.name || 'Article',
      price_kmf: Number(it.price_kmf ?? it.price_snapshot_kmf) || 0,
      image_url: it.image_url || it.product_image_snapshot || null,
    })) : [];
    ws.contributions = Array.isArray(root.contributions) ? root.contributions.map((c) => ({
      id: c.id,
      contributor_name: c.contributor_name || 'Anonyme',
      contributor_phone: c.contributor_phone || null,
      amount_kmf: Number(c.amount_kmf ?? c.intended_amount_kmf) || 0,
      message: c.message || null,
      status: c.status || null,
    })) : [];
    if (!ws.public_token) {
      const stored = getStoredEventMeta(getCreatorToken());
      if (stored && stored.public_token) ws.public_token = stored.public_token;
    }
    return ws;
  }

  function avatar(name) {
    return String(name || '').trim().split(/\s+/)
      .map((w) => (w[0] || '').toUpperCase()).slice(0, 2).join('');
  }

  function render(ws) {
    const items     = ws.items || [];
    const contribs  = ws.contributions || [];
    const total     = items.reduce((s, it) => s + (it.price_kmf || 0) * (it.quantity || 1), 0);
    const collected = contribs
      .filter((c) => c.status === 'paid' || c.status === 'authorized')
      .reduce((s, c) => s + (c.amount_kmf || 0), 0);
    const remaining = Math.max(0, total - collected);
    const phase     = getPhase(ws);
    const canShare  = Boolean(ws.public_token);
    const url       = canShare ? publicUrl(ws.public_token) : '';
    const isOpen    = phase === 'draft' || phase === 'collecting' || phase === 'reviewing';

    let html = '';

    // ── Hero violet ──────────────────────────────────────────
    html += '<div class="ev-hero">';
    html += '<div class="ev-hero-badge">' + escHtml(phaseLabel(phase)) + '</div>';
    if (ws.creator_name) {
      html += '<div class="ev-hero-eyebrow">' + escHtml(ws.creator_name) + ' · Organisateur</div>';
    }
    html += '<h1 class="ev-hero-title">' + escHtml(ws.event_name || 'Mon panier collectif') + '</h1>';
    if (ws.event_note) {
      html += '<p class="ev-hero-sub">« ' + escHtml(ws.event_note) + ' »</p>';
    }
    html += '</div>';

    // ── Avancement ──────────────────────────────────────────
    if (total > 0) {
      const pct = Math.min(100, Math.round((collected / total) * 100));
      html += '<div class="ev-card">';
      html += '<p class="ev-card-label">Avancement</p>';
      html += '<div class="ev-amounts">';
      html += '<div class="ev-amount-cell"><div class="ev-amount-label">Total</div>';
      html += '<div class="ev-amount-value">' + fmt(total) + '<span class="ev-amount-unit"> KMF</span></div></div>';
      html += '<div class="ev-amount-cell"><div class="ev-amount-label">Confirmé</div>';
      html += '<div class="ev-amount-value green">' + fmt(collected) + '<span class="ev-amount-unit"> KMF</span></div></div>';
      html += '<div class="ev-amount-cell"><div class="ev-amount-label">Restant</div>';
      html += '<div class="ev-amount-value coral">' + fmt(remaining) + '<span class="ev-amount-unit"> KMF</span></div></div>';
      html += '</div>';
      html += '<div class="ev-progress-wrap">';
      html += '<div class="ev-progress-bar"><div class="ev-progress-fill" style="width:' + pct + '%;"></div></div>';
      html += '<div class="ev-progress-label"><span>' + pct + '% confirmé</span><span><strong>' + contribs.length + '</strong> participant' + (contribs.length > 1 ? 's' : '') + '</span></div>';
      html += '</div>';
      html += '</div>';
    }

    // ── Lien à partager ─────────────────────────────────────
    if (canShare) {
      html += '<div class="ev-card">';
      html += '<p class="ev-card-label">Partager le lien</p>';
      html += '<div class="ev-share-actions">';
      html += '<input type="text" readonly value="' + escHtml(url) + '" id="ev-public-url" class="ev-share-url">';
      html += '<button class="ev-btn ev-btn-ghost ev-btn-sm" id="ev-copy-btn">Copier</button>';
      html += '</div>';
      html += '<a href="' + whatsappShareUrl(ws.event_name, ws.public_token) + '" target="_blank" rel="noopener" class="ev-btn ev-btn-wa ev-btn-block" style="margin-top:10px;">📱 Partager sur WhatsApp</a>';
      html += '</div>';
    }

    // ── Articles ────────────────────────────────────────────
    html += '<details class="ev-card ev-collapsible">';
    html += '<summary class="ev-card-summary">';
    html += '<span class="ev-card-label" style="margin:0;">Articles du panier (' + items.length + ')</span>';
    html += '<span class="ev-card-summary-icon" aria-hidden="true">▾</span>';
    html += '</summary>';
    if (!items.length) {
      html += '<div class="ev-empty">Votre liste est vide. <a href="/" style="color:var(--violet);">Ajoutez des articles depuis la boutique</a>.</div>';
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
      html += '<a href="/" class="ev-btn ev-btn-ghost ev-btn-block" style="margin-top:10px;">+ Ajouter des articles</a>';
    }
    html += '</details>';

    // ── Contributions ───────────────────────────────────────
    html += '<details class="ev-card ev-collapsible">';
    html += '<summary class="ev-card-summary">';
    html += '<span class="ev-card-label" style="margin:0;">Participants (' + contribs.length + ')</span>';
    html += '<span class="ev-card-summary-icon" aria-hidden="true">▾</span>';
    html += '</summary>';
    if (!contribs.length) {
      html += '<div class="ev-empty">Aucune proposition pour le moment. Partagez le lien pour commencer à recevoir des participations.</div>';
    } else {
      html += '<ul class="ev-list">';
      contribs.forEach((c) => {
        html += '<li class="ev-list-item">';
        html += '<div class="ev-list-avatar">' + escHtml(avatar(c.contributor_name) || '?') + '</div>';
        html += '<div class="ev-list-content">';
        html += '<div class="ev-list-name">' + escHtml(c.contributor_name) + '</div>';
        if (c.message) {
          html += '<div class="ev-list-meta">« ' + escHtml(c.message) + ' »</div>';
        }
        html += '</div>';
        if (c.amount_kmf) {
          html += '<div class="ev-list-right"><div class="ev-list-amount">' + fmt(c.amount_kmf) + ' KMF</div></div>';
        }
        html += '</li>';
      });
      html += '</ul>';
    }
    html += '</details>';

    // ── Action : finaliser ──────────────────────────────────
    if (isOpen) {
      html += '<div class="ev-card">';
      html += '<p class="ev-card-label">Prochaine étape</p>';
      html += '<p class="ev-card-sub">Quand votre liste est prête, finalisez. Les participants recevront un lien personnalisé pour confirmer leur part en cash.</p>';
      html += '<button class="ev-btn ev-btn-confirm ev-btn-block" id="ev-finalize-btn"' + (items.length === 0 ? ' disabled' : '') + ' style="margin-top:12px;font-size:15px;padding:13px 16px;">';
      html += 'Finaliser le panier (' + fmt(total) + ' KMF) →';
      html += '</button>';
      html += '</div>';
    } else if (phase === 'finalized' || phase === 'payment_pending' || phase === 'partially_paid') {
      html += '<div class="ev-alert ev-alert-violet">⏳ La liste est figée. Les participants ont reçu leur lien — chacun confirme sa part en cash de son côté.</div>';
    } else if (phase === 'order_created' || phase === 'paid') {
      html += '<div class="ev-alert ev-alert-success">✅ La commande a été créée. Préparez-vous à récupérer le panier au relais.</div>';
    } else if (phase === 'expired') {
      html += '<div class="ev-alert ev-alert-warn">⏰ La session a expiré. Vous pouvez relancer la finalisation.</div>';
    }

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    // ── Wires ────────────────────────────────────────────────
    const copyBtn = document.getElementById('ev-copy-btn');
    if (copyBtn && canShare) {
      copyBtn.addEventListener('click', async () => {
        const inp = document.getElementById('ev-public-url');
        try { await navigator.clipboard.writeText(inp.value); }
        catch (_) { inp.select(); document.execCommand('copy'); }
        copyBtn.textContent = '✓ Copié';
        setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1800);
      });
    }

    const finBtn = document.getElementById('ev-finalize-btn');
    if (finBtn) finBtn.addEventListener('click', () => handleFinalize(items));
  }

  async function handleFinalize(items) {
    const btn = document.getElementById('ev-finalize-btn');
    if (!confirm('Finaliser le panier ?\n\nCela va figer la liste et générer les liens de confirmation cash pour chaque participant.')) return;

    btn.disabled = true;
    btn.textContent = '⏳ Finalisation…';

    try {
      const reviewRes = await fetch(
        '/api/collective-workspaces/' + encodeURIComponent(getCreatorToken()) + '/finalization-review',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      if (!reviewRes.ok) {
        const err = await reviewRes.json().catch(() => ({}));
        throw new Error(err.message || 'Échec de la revue de finalisation');
      }

      const finRes = await fetch(
        '/api/collective-workspaces/' + encodeURIComponent(getCreatorToken()) + '/finalize',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      if (!finRes.ok) {
        const err = await finRes.json().catch(() => ({}));
        throw new Error(err.message || 'Échec de la finalisation');
      }

      renderFinalizeResult(await finRes.json());
    } catch (err) {
      alert('Erreur : ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Finaliser le panier →';
    }
  }

  function renderFinalizeResult(data) {
    const tokens     = Array.isArray(data.tokens) ? data.tokens : [];
    const expiresAt  = data.expires_at || null;
    const totalKmf   = data.total_kmf || 0;

    let html = '';

    html += '<div class="ev-hero">';
    html += '<div class="ev-hero-badge">Panier figé</div>';
    html += '<h1 class="ev-hero-title">✅ Liste finalisée</h1>';
    html += '<p class="ev-hero-sub">Envoyez chaque lien à la bonne personne. <strong>La commande sera créée quand tous auront confirmé.</strong></p>';
    if (totalKmf) {
      html += '<div class="ev-hero-amount">';
      html += '<span class="ev-hero-amount-num">' + fmt(totalKmf) + '</span>';
      html += '<span class="ev-hero-amount-cur">KMF total</span>';
      html += '</div>';
    }
    html += '</div>';

    if (expiresAt) {
      const dt = new Date(expiresAt);
      html += '<div class="ev-alert ev-alert-info" style="margin-bottom:12px;">';
      html += '⏰ Liens valables jusqu\'au <strong>' + dt.toLocaleDateString('fr-FR') + ' ' +
              dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</strong>.';
      html += '</div>';
    }

    html += '<div class="ev-card">';
    html += '<p class="ev-card-label">Liens de confirmation à envoyer</p>';
    html += '<p class="ev-card-sub">Chaque participant ouvre son lien, confirme son engagement à payer en cash, c\'est tout.</p>';
    html += '<ul class="ev-list" style="margin-top:12px;">';
    tokens.forEach((t, idx) => {
      const fullUrl = window.location.origin + (t.payment_page_url || '/event/pay/' + t.payment_token);
      const waText = encodeURIComponent(
        'Bonjour ' + (t.contributor_name || '') + ',\n\n' +
        'Voici votre lien pour confirmer votre part :\n' + fullUrl + '\n\n' +
        'Montant : ' + fmt(t.amount_kmf) + ' KMF en cash au retrait.'
      );
      const waUrl = whatsappDirect(t.contributor_phone, waText);
      html += '<li class="ev-list-item" style="flex-direction:column;align-items:stretch;gap:8px;">';
      html += '<div style="display:flex;align-items:center;gap:10px;">';
      html += '<div class="ev-list-avatar">' + escHtml(avatar(t.contributor_name) || '?') + '</div>';
      html += '<div class="ev-list-content">';
      html += '<div class="ev-list-name">' + escHtml(t.contributor_name) + '</div>';
      html += '<div class="ev-list-meta"><strong style="color:var(--violet);">' + fmt(t.amount_kmf) + ' KMF</strong> à confirmer</div>';
      html += '</div></div>';
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
      html += '<input type="text" readonly value="' + escHtml(fullUrl) + '" id="ev-tok-url-' + idx + '" class="ev-share-url" style="flex:1;min-width:0;">';
      html += '<button class="ev-btn ev-btn-ghost ev-btn-sm" data-copy-url="' + idx + '">Copier</button>';
      html += '<a href="' + waUrl + '" target="_blank" rel="noopener" class="ev-btn ev-btn-wa ev-btn-sm">WhatsApp</a>';
      html += '</div>';
      html += '</li>';
    });
    html += '</ul>';
    html += '</div>';

    html += '<div class="ev-card" style="text-align:center;">';
    html += '<button class="ev-btn ev-btn-confirm ev-btn-block" id="ev-tokens-ack">';
    html += 'J\'ai envoyé tous les liens — actualiser';
    html += '</button>';
    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    contentEl.querySelectorAll('[data-copy-url]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const inp = document.getElementById('ev-tok-url-' + btn.dataset.copyUrl);
        if (!inp) return;
        try { await navigator.clipboard.writeText(inp.value); }
        catch (_) { inp.select(); document.execCommand('copy'); }
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });

    const ack = document.getElementById('ev-tokens-ack');
    if (ack) ack.addEventListener('click', () => window.location.reload());
  }

  async function load() {
    const token = getCreatorToken();
    if (!token) return showError('Lien organisateur invalide.');
    try {
      const res = await fetch('/api/collective-workspaces/me/' + encodeURIComponent(token));
      if (res.status === 404) return showError('Panier introuvable.');
      if (!res.ok) return showError('Erreur ' + res.status + ' lors du chargement.');
      render(normalizeWorkspaceResponse(await res.json()));
    } catch (err) {
      console.error(err);
      showError('Erreur réseau. Réessayez plus tard.');
    }
  }

  load();
})();
