/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page CRÉATEUR (boutique)
   Lit /api/collective-workspaces/me/:creatorToken
   Affiche : nom, lien public, items, contributions, totaux + bouton Finaliser
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl   = document.getElementById('ev-error-block');

  function getCreatorToken() {
    const m = window.location.pathname.match(/\/event\/([^\/]+)\/manage/);
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

  function publicUrl(publicToken) {
    return window.location.origin + '/workspace/' + encodeURIComponent(publicToken);
  }
  function whatsappShareUrl(eventName, publicToken) {
    const text = encodeURIComponent(
      'Bonjour ! J\'organise "' + eventName + '" sur Komerce. ' +
      'Tu peux ajouter tes idées ou ta contribution ici : ' + publicUrl(publicToken)
    );
    return 'https://wa.me/?text=' + text;
  }

  function statusBadge(status) {
    if (status === 'finalized' || status === 'finalisation_review') {
      return '<span class="ev-badge ev-badge-finalized">En finalisation</span>';
    }
    if (status === 'paid' || status === 'order_created') {
      return '<span class="ev-badge ev-badge-paid">Commande créée</span>';
    }
    return '<span class="ev-badge ev-badge-conception">En conception</span>';
  }

  function render(ws) {
    const items = Array.isArray(ws.items) ? ws.items : [];
    const contribs = Array.isArray(ws.contributions) ? ws.contributions : [];
    const total = items.reduce(
      (sum, it) => sum + (Number(it.price_kmf) || 0) * (Number(it.quantity) || 1), 0
    );

    let html = '';

    // ── Bloc 1 : Identité workspace ───────────────────────────────
    html += '<div class="ev-card">';
    html += '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
    html += '<div style="flex:1;min-width:200px;">';
    html += '<h2 class="ev-card-title">' + escHtml(ws.event_name) + '</h2>';
    if (ws.recipient_name) {
      html += '<div class="ev-card-sub">📍 Destinataire : ' + escHtml(ws.recipient_name) + '</div>';
    }
    if (ws.event_note) {
      html += '<div style="font-size:13px;color:var(--ev-text-muted);margin-top:6px;font-style:italic;">' +
              '« ' + escHtml(ws.event_note) + ' »</div>';
    }
    html += '</div>';
    html += '<div>' + statusBadge(ws.status) + '</div>';
    html += '</div>';
    html += '</div>';

    // ── Bloc 2 : Lien public à partager ────────────────────────────
    const url = publicUrl(ws.public_token);
    html += '<div class="ev-card">';
    html += '<h3 class="ev-card-title" style="font-size:15px;">📨 Partager avec la famille</h3>';
    html += '<p class="ev-card-sub">Toute personne avec ce lien peut voir le panier et ajouter des idées.</p>';

    html += '<div class="ev-share">';
    html += '<div class="ev-share-label">Lien public à copier :</div>';
    html += '<div class="ev-share-url">';
    html += '<input type="text" readonly value="' + escHtml(url) + '" id="ev-public-url-input">';
    html += '<button class="ev-btn ev-btn-secondary" id="ev-copy-btn">Copier</button>';
    html += '</div>';
    html += '<div class="ev-share-actions">';
    html += '<a href="' + whatsappShareUrl(ws.event_name, ws.public_token) +
            '" target="_blank" rel="noopener" class="ev-btn ev-btn-whatsapp">' +
            '💬 Partager sur WhatsApp</a>';
    html += '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" class="ev-btn ev-btn-secondary">' +
            '👁️ Voir comme un visiteur</a>';
    html += '</div></div></div>';

    // ── Bloc 3 : Items (panier) ────────────────────────────────────
    html += '<div class="ev-card">';
    html += '<h3 class="ev-card-title" style="font-size:15px;">🛒 Panier (' + items.length + ' article' + (items.length > 1 ? 's' : '') + ')</h3>';
    if (!items.length) {
      html += '<div class="ev-empty">';
      html += 'Aucun article dans le panier pour l\'instant.<br>';
      html += '<a href="/" style="color:var(--ev-primary);">Parcourir la boutique</a> pour ajouter, ' +
              'ou laissez la famille proposer via le lien public.';
      html += '</div>';
    } else {
      html += '<ul class="ev-list">';
      items.forEach(function(it) {
        const qty = Number(it.quantity) || 1;
        const lineTotal = (Number(it.price_kmf) || 0) * qty;
        html += '<li class="ev-list-item">';
        html += '<div class="ev-list-emoji">🎁</div>';
        html += '<div class="ev-list-content">';
        html += '<div class="ev-list-name">' + escHtml(it.product_name || it.name || 'Article') + '</div>';
        html += '<div class="ev-list-meta">' + qty + ' × ' + fmt(it.price_kmf) + ' KMF = ' +
                '<strong>' + fmt(lineTotal) + ' KMF</strong></div>';
        html += '</div></li>';
      });
      html += '</ul>';

      html += '<div class="ev-totals">';
      html += '<div class="ev-totals-row ev-totals-row--final">';
      html += '<span>Total estimé du panier</span>';
      html += '<span>' + fmt(total) + ' KMF</span>';
      html += '</div></div>';
    }
    html += '</div>';

    // ── Bloc 4 : Suggestions / contributions reçues ─────────────────
    html += '<div class="ev-card">';
    html += '<h3 class="ev-card-title" style="font-size:15px;">💡 Idées proposées par la famille (' + contribs.length + ')</h3>';
    html += '<p class="ev-card-sub">Suggestions reçues via le lien public. Vous décidez ce qui entre dans le panier final.</p>';
    if (!contribs.length) {
      html += '<div class="ev-empty">Aucune suggestion pour le moment. Partagez le lien public à votre famille pour qu\'ils ajoutent leurs idées.</div>';
    } else {
      html += '<ul class="ev-list">';
      contribs.forEach(function(c) {
        html += '<li class="ev-list-item">';
        html += '<div class="ev-list-emoji">' + (c.kind === 'intention' ? '💰' : '🎁') + '</div>';
        html += '<div class="ev-list-content">';
        html += '<div class="ev-list-name">' + escHtml(c.contributor_name || 'Anonyme');
        if (c.amount_kmf) {
          html += ' <span style="color:var(--ev-success);font-weight:600;">+' + fmt(c.amount_kmf) + ' KMF</span>';
        }
        html += '</div>';
        if (c.message) {
          html += '<div class="ev-list-meta">« ' + escHtml(c.message) + ' »</div>';
        }
        if (c.product_name || c.suggestion) {
          html += '<div class="ev-list-meta">Suggère : ' + escHtml(c.product_name || c.suggestion) + '</div>';
        }
        html += '</div></li>';
      });
      html += '</ul>';
    }
    html += '</div>';

    // ── Bloc 5 : Actions finalisation ───────────────────────────────
    if (ws.status === 'conception' || ws.status === 'open') {
      html += '<div class="ev-card">';
      html += '<h3 class="ev-card-title" style="font-size:15px;">✅ Finaliser le panier</h3>';
      html += '<p class="ev-card-sub">Quand vous êtes prêt, vous figez le panier et passez à la commande sécurisée. ' +
              'Aucune contribution ne sera plus modifiable.</p>';
      html += '<div class="ev-btn-row">';
      html += '<button class="ev-btn ev-btn-success" id="ev-finalize-btn"' +
              (items.length === 0 ? ' disabled' : '') + '>' +
              '🔒 Finaliser le panier (' + fmt(total) + ' KMF)</button>';
      html += '<a href="/" class="ev-btn ev-btn-secondary">Continuer à parcourir la boutique</a>';
      html += '</div>';
      if (items.length === 0) {
        html += '<div class="ev-help" style="margin-top:8px;">Ajoutez au moins un article au panier avant de finaliser.</div>';
      }
      html += '</div>';
    } else if (ws.status === 'finalisation_review' || ws.status === 'finalized') {
      html += '<div class="ev-info">' +
              '⏳ Le panier est en cours de finalisation. La commande sera créée après paiement sécurisé.' +
              '</div>';
    } else if (ws.status === 'order_created') {
      html += '<div class="ev-info">' +
              '✅ La commande a été créée avec succès. Vous serez tenu informé du suivi.' +
              '</div>';
    }

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    // ── Handlers ────────────────────────────────────────────────────
    const copyBtn = document.getElementById('ev-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const inp = document.getElementById('ev-public-url-input');
        try {
          await navigator.clipboard.writeText(inp.value);
          copyBtn.textContent = '✓ Copié !';
          setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000);
        } catch (_) {
          inp.select(); document.execCommand('copy');
          copyBtn.textContent = '✓ Copié !';
          setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000);
        }
      });
    }

    const finalizeBtn = document.getElementById('ev-finalize-btn');
    if (finalizeBtn) {
      finalizeBtn.addEventListener('click', async () => {
        if (!confirm('Finaliser le panier ? Cette action verrouille le panier pour passer à la commande sécurisée.')) return;
        finalizeBtn.disabled = true;
        finalizeBtn.textContent = '⏳ Finalisation…';
        try {
          // Étape 1 : finalization-review (calcul prix réel + dispo)
          const reviewRes = await fetch('/api/collective-workspaces/' +
            encodeURIComponent(getCreatorToken()) + '/finalization-review', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
          });
          if (!reviewRes.ok) throw new Error('Échec de la revue de finalisation');
          // Étape 2 : finalize (verrou + lance paiement)
          const finRes = await fetch('/api/collective-workspaces/' +
            encodeURIComponent(getCreatorToken()) + '/finalize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
          });
          if (!finRes.ok) throw new Error('Échec de la finalisation');
          // On reload pour afficher le nouveau status
          window.location.reload();
        } catch (err) {
          alert('Erreur : ' + err.message);
          finalizeBtn.disabled = false;
          finalizeBtn.textContent = '🔒 Finaliser le panier';
        }
      });
    }
  }

  async function load() {
    const token = getCreatorToken();
    if (!token) { showError('Lien créateur invalide. Vérifiez l\'URL.'); return; }
    try {
      const res = await fetch('/api/collective-workspaces/me/' + encodeURIComponent(token));
      if (res.status === 404) { showError('Panier événement introuvable. Le lien a peut-être expiré ou est incorrect.'); return; }
      if (!res.ok) { showError('Erreur ' + res.status + ' lors du chargement.'); return; }
      const data = await res.json();
      render(data.workspace || data);
    } catch (err) {
      console.error(err);
      showError('Erreur réseau. Réessayez plus tard.');
    }
  }

  load();
})();
