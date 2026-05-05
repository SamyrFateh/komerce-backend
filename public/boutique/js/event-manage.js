(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl = document.getElementById('ev-error-block');

  function getCreatorToken() {
    let m = window.location.pathname.match(/\/event\/manage\/([^\/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = window.location.pathname.match(/\/event\/([^\/?#]+)\/manage/);
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function publicUrl(publicToken) {
    return window.location.origin + '/event/w/' + encodeURIComponent(publicToken);
  }

  function getStoredEventMeta(creatorToken) {
    if (!creatorToken) return null;
    try {
      const stored = JSON.parse(localStorage.getItem('komerce-events') || '[]');
      return stored.find((entry) => entry && entry.creator_token === creatorToken) || null;
    } catch (_) {
      return null;
    }
  }

  function normalizeWorkspaceResponse(payload) {
    const root = payload || {};
    const workspace = Object.assign({}, root.workspace || root);
    workspace.items = Array.isArray(root.items) ? root.items.map((it) => ({
      id: it.id,
      quantity: Number(it.quantity) || 1,
      product_id: it.product_id || null,
      product_name: it.product_name || it.product_name_snapshot || it.name || 'Article',
      price_kmf: Number(it.price_kmf ?? it.price_snapshot_kmf) || 0,
      image_url: it.image_url || it.product_image_snapshot || null,
    })) : [];
    workspace.contributions = Array.isArray(root.contributions) ? root.contributions.map((c) => ({
      id: c.id,
      contributor_name: c.contributor_name || 'Anonyme',
      amount_kmf: Number(c.amount_kmf ?? c.intended_amount_kmf) || 0,
      suggestion: c.suggestion || null,
      message: c.message || null,
      kind: c.kind || (Number(c.intended_amount_kmf) > 0 ? 'intention' : 'suggestion'),
      product_name: c.product_name || null,
      status: c.status || null,
    })) : [];
    workspace.session = root.session || null;
    if (!workspace.public_token) {
      const stored = getStoredEventMeta(getCreatorToken());
      if (stored && stored.public_token) workspace.public_token = stored.public_token;
    }
    return workspace;
  }

  function isMobileWhatsAppContext() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function whatsappShareUrl(eventName, publicToken) {
    const text = encodeURIComponent(
      'Bonjour ! J\'organise "' + eventName + '" sur Komerce. ' +
      'Tu peux ajouter tes idees ou ta contribution ici : ' + publicUrl(publicToken)
    );
    return isMobileWhatsAppContext()
      ? 'whatsapp://send?text=' + text
      : 'https://wa.me/?text=' + text;
  }

  function whatsappDirectUrl(phone, text) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (isMobileWhatsAppContext()) {
      return cleanPhone
        ? 'whatsapp://send?phone=' + encodeURIComponent(cleanPhone) + '&text=' + text
        : 'whatsapp://send?text=' + text;
    }
    return cleanPhone
      ? 'https://wa.me/' + encodeURIComponent(cleanPhone) + '?text=' + text
      : 'https://wa.me/?text=' + text;
  }

  function getWorkspacePhase(workspace) {
    return workspace.phase || workspace.status || 'draft';
  }

  function phaseLabel(phase) {
    if (phase === 'collecting') return 'Collecte en cours';
    if (phase === 'reviewing') return 'En cours de validation';
    if (phase === 'finalized' || phase === 'payment_pending') return 'Paiements en preparation';
    if (phase === 'partially_paid') return 'Paiements en cours';
    if (phase === 'paid' || phase === 'order_created') return 'Commande confirmée';
    if (phase === 'expired') return 'Session expirée';
    if (phase === 'cancelled') return 'Achat groupé annulé';
    return 'En préparation';
  }

  function statusBadge(phase) {
    if (phase === 'paid' || phase === 'order_created') {
      return '<span class="ev-badge ev-badge-paid">' + phaseLabel(phase) + '</span>';
    }
    if (phase === 'finalized' || phase === 'payment_pending' || phase === 'partially_paid' || phase === 'reviewing') {
      return '<span class="ev-badge ev-badge-finalized">' + phaseLabel(phase) + '</span>';
    }
    return '<span class="ev-badge ev-badge-conception">' + phaseLabel(phase) + '</span>';
  }

  function render(workspace) {
    const items = Array.isArray(workspace.items) ? workspace.items : [];
    const contribs = Array.isArray(workspace.contributions) ? workspace.contributions : [];
    const total = items.reduce((sum, it) => sum + (Number(it.price_kmf) || 0) * (Number(it.quantity) || 1), 0);
    const canShare = Boolean(workspace.public_token);
    const url = canShare ? publicUrl(workspace.public_token) : '';
    const phase = getWorkspacePhase(workspace);

    let html = '';
    html += '<div class="ev-card"><div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;"><div style="flex:1;min-width:200px;">';
    html += '<h2 class="ev-card-title">' + escHtml(workspace.event_name) + '</h2>';
    if (workspace.recipient_name) html += '<div class="ev-card-sub">Organisateur : ' + escHtml(workspace.recipient_name) + '</div>';
    if (workspace.event_note) html += '<div style="font-size:13px;color:var(--ev-text-muted);margin-top:6px;font-style:italic;">&laquo; ' + escHtml(workspace.event_note) + ' &raquo;</div>';
    html += '<div class="ev-card-sub" style="margin-top:8px;">Statut : <strong>' + escHtml(phaseLabel(phase)) + '</strong></div>';
    html += '</div><div>' + statusBadge(phase) + '</div></div></div>';

    html += '<div class="ev-card"><h3 class="ev-card-title" style="font-size:15px;">Partager le panier</h3><p class="ev-card-sub">Envoyez un seul lien simple. La famille peut proposer, mais vous restez seul a modifier la vraie liste.</p><div class="ev-share"><div class="ev-share-label">Lien à partager :</div><div class="ev-share-url">';
    html += '<input type="text" readonly value="' + escHtml(url) + '" id="ev-public-url-input">';
    html += '<button class="ev-btn ev-btn-secondary" id="ev-copy-btn"' + (canShare ? '' : ' disabled') + '>Copier</button></div>';
    if (canShare) {
      html += '<div class="ev-share-actions"><a href="' + whatsappShareUrl(workspace.event_name, workspace.public_token) + '" target="_blank" rel="noopener" class="ev-btn ev-btn-whatsapp">Partager sur WhatsApp</a><a href="' + escHtml(url) + '" target="_blank" rel="noopener" class="ev-btn ev-btn-secondary">Voir le panier public</a></div>';
    } else {
      html += '<div class="ev-help" style="margin-top:8px;">Le lien public reste disponible sur l appareil qui a cree le panier.</div>';
    }
    html += '</div></div>';

    html += '<div class="ev-card"><h3 class="ev-card-title" style="font-size:15px;">Panier collectif (' + items.length + ' article' + (items.length > 1 ? 's' : '') + ')</h3><p class="ev-card-sub">Vous etes le seul a modifier cette liste. Les proches ne font que proposer.</p>';
    if (!items.length) {
      html += '<div class="ev-empty">Votre liste est vide pour l instant.<br><a href="/" style="color:var(--ev-primary);">Parcourir la boutique</a> pour ajouter vos premiers articles.</div>';
    } else {
      html += '<ul class="ev-list">';
      items.forEach((it) => {
        const qty = Number(it.quantity) || 1;
        const lineTotal = (Number(it.price_kmf) || 0) * qty;
        html += '<li class="ev-list-item"><div class="ev-list-emoji">*</div><div class="ev-list-content"><div class="ev-list-name">' + escHtml(it.product_name) + '</div><div class="ev-list-meta">' + qty + ' x ' + fmt(it.price_kmf) + ' KMF = <strong>' + fmt(lineTotal) + ' KMF</strong></div></div></li>';
      });
      html += '</ul><div class="ev-totals"><div class="ev-totals-row ev-totals-row--final"><span>Total estime de la liste</span><span>' + fmt(total) + ' KMF</span></div></div>';
    }
    html += '</div>';

    html += '<div class="ev-card"><h3 class="ev-card-title" style="font-size:15px;">Contributions (' + contribs.length + ')</h3><p class="ev-card-sub">Ces retours vous aident a preparer la liste finale. Ils ne modifient pas automatiquement vos articles.</p>';
    if (!contribs.length) {
      html += '<div class="ev-empty">Aucune proposition pour le moment. Partagez le lien famille pour commencer a recevoir des idees et des montants.</div>';
    } else {
      html += '<ul class="ev-list">';
      contribs.forEach((c) => {
        html += '<li class="ev-list-item">' + '<div class="ev-list-avatar">' + escHtml(c.contributor_name).trim().split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase() + '</div>' + '<div class="ev-list-content"><div class="ev-list-name">' + escHtml(c.contributor_name);
        if (c.amount_kmf) { html += '</div><div class="ev-list-right"><div class="ev-list-amount">' + fmt(c.amount_kmf) + ' KMF</div></div>'; } else {
        html += '</div>';
        }
        if (c.message) html += '<div class="ev-list-meta">&laquo; ' + escHtml(c.message) + ' &raquo;</div>';
        if (c.product_name || c.suggestion) html += '<div class="ev-list-meta">Produit suggéré : ' + escHtml(c.product_name || c.suggestion) + '</div>';
        html += '</li>';
      html += '</ul>';
    }
    html += '</div>';

    if (phase === 'draft' || phase === 'collecting' || phase === 'reviewing') {
      html += '<div class="ev-card"><h3 class="ev-card-title" style="font-size:15px;">Prochaine etape : finaliser la liste</h3><p class="ev-card-sub">Quand vous etes pret, vous figez la liste. Apres cela, on pourra demander les paiements sur la base de votre validation finale.</p><div class="ev-btn-row"><button class="ev-btn ev-btn-success" id="ev-finalize-btn"' + (items.length === 0 ? ' disabled' : '') + '>Finaliser le panier (' + fmt(total) + ' KMF)</button><a href="/" class="ev-btn ev-btn-secondary">Continuer la boutique</a></div></div>';
    } else if (phase === 'finalized' || phase === 'payment_pending') {
      html += '<div class="ev-info">La liste est figee. Vous pouvez maintenant envoyer les liens de paiement aux participants retenus.</div>';
    } else if (phase === 'partially_paid') {
      html += '<div class="ev-info">Certains paiements sont deja passes. Vous pouvez suivre tranquillement les confirmations restantes.</div>';
    } else if (phase === 'order_created' || phase === 'paid') {
      html += '<div class="ev-info">La commande a ete creee avec succes.</div>';
    } else if (phase === 'expired') {
      html += '<div class="ev-warning">La session précédente a expiré. Vous pouvez relancer une nouvelle finalisation quand vous etes pret.</div>';
    }

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    const copyBtn = document.getElementById('ev-copy-btn');
    if (copyBtn && canShare) {
      copyBtn.addEventListener('click', async () => {
        const inp = document.getElementById('ev-public-url-input');
        try {
          await navigator.clipboard.writeText(inp.value);
          copyBtn.textContent = 'Copie';
          setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000);
        } catch (_) {
          inp.select();
          document.execCommand('copy');
          copyBtn.textContent = 'Copie';
          setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000);
        }
      });
    }

    const finalizeBtn = document.getElementById('ev-finalize-btn');
    if (finalizeBtn) {
      finalizeBtn.addEventListener('click', async () => {
        if (!confirm('Finaliser la liste ? Cette action verrouille vos articles et prepare les liens de paiement individuels.')) return;
        finalizeBtn.disabled = true;
        finalizeBtn.textContent = 'Finalisation en cours…';
        try {
          const reviewRes = await fetch('/api/collective-workspaces/' + encodeURIComponent(getCreatorToken()) + '/finalization-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!reviewRes.ok) {
            const err = await reviewRes.json().catch(() => ({}));
            throw new Error(err.message || 'Echec de la revue de finalisation');
          }
          const finRes = await fetch('/api/collective-workspaces/' + encodeURIComponent(getCreatorToken()) + '/finalize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!finRes.ok) {
            const err = await finRes.json().catch(() => ({}));
            throw new Error(err.message || 'Echec de la finalisation');
          }
          renderFinalizeResult(await finRes.json());
        } catch (err) {
          alert('Erreur : ' + err.message);
          finalizeBtn.disabled = false;
          finalizeBtn.textContent = 'Finaliser le panier';
        }
      });
    }
  }

  function renderFinalizeResult(data) {
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    const expiresAt = data.expires_at || null;
    const totalKmf = data.total_kmf || 0;
    let html = '<div class="ev-card"><h2 class="ev-card-title">Liste finalisee</h2><p class="ev-card-sub">Votre liste est maintenant figee. Voici les <strong>' + tokens.length + ' lien(s) de paiement</strong> a envoyer aux participants retenus.</p>';
    if (totalKmf) html += '<div class="ev-totals"><div class="ev-totals-row ev-totals-row--final"><span>Total a payer</span><span>' + fmt(totalKmf) + ' KMF</span></div></div>';
    if (expiresAt) {
      const dt = new Date(expiresAt);
      html += '<div class="ev-help" style="margin-top:8px;">Liens valables jusqu au <strong>' + dt.toLocaleDateString('fr-FR') + ' ' + dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</strong>.</div>';
    }
    html += '</div><div class="ev-card"><h3 class="ev-card-title" style="font-size:15px;">Demandes de paiement par participant</h3><p class="ev-card-sub">Envoyez chaque lien a la bonne personne. La commande ne sera creee qu\'une fois tout le montant confirme.</p><ul class="ev-list">';
    tokens.forEach((t, idx) => {
      const fullUrl = window.location.origin + (t.payment_page_url || '/event/pay/' + t.payment_token);
      const waText = encodeURIComponent('Bonjour ' + t.contributor_name + ',\n\nVoici votre lien de paiement :\n' + fullUrl + '\n\nMontant : ' + fmt(t.amount_kmf) + ' KMF');
      const waUrl = whatsappDirectUrl(t.contributor_phone, waText);
      html += '<li class="ev-list-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:14px 0;"><div style="display:flex;align-items:center;gap:10px;"><div class="ev-list-emoji">*</div><div class="ev-list-content"><div class="ev-list-name">' + escHtml(t.contributor_name) + ' <span style="color:var(--ev-success);font-weight:600;">' + fmt(t.amount_kmf) + ' KMF</span></div></div></div><div style="display:flex;gap:6px;flex-wrap:wrap;"><input type="text" readonly value="' + escHtml(fullUrl) + '" id="ev-tok-url-' + idx + '" style="flex:1;min-width:0;font-size:11px;padding:6px 8px;font-family:monospace;border:1px solid var(--ev-border);border-radius:4px;"><button class="ev-btn ev-btn-secondary" data-copy-url="' + idx + '" style="padding:6px 10px;font-size:12px;">Copier</button><a href="' + waUrl + '" target="_blank" rel="noopener" class="ev-btn ev-btn-whatsapp" style="padding:6px 10px;font-size:12px;">WhatsApp</a></div></li>';
    });
    html += '</ul></div><div class="ev-card" style="text-align:center;"><button class="ev-btn ev-btn-success" id="ev-tokens-ack" style="width:100%;">J'ai envoyé tous les liens — actualiser</button></div>';
    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';
    contentEl.querySelectorAll('[data-copy-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById('ev-tok-url-' + btn.dataset.copyUrl);
        if (!inp) return;
        try {
          navigator.clipboard.writeText(inp.value);
        } catch (_) {
          inp.select();
          document.execCommand('copy');
        }
      });
    });
    const ack = document.getElementById('ev-tokens-ack');
    if (ack) ack.addEventListener('click', () => window.location.reload());
  }

  async function load() {
    const token = getCreatorToken();
    if (!token) return showError('Lien createur invalide.');
    try {
      const res = await fetch('/api/collective-workspaces/me/' + encodeURIComponent(token));
      if (res.status === 404) return showError('Panier partage introuvable.');
      if (!res.ok) return showError('Erreur ' + res.status + ' lors du chargement.');
      render(normalizeWorkspaceResponse(await res.json()));
    } catch (err) {
      console.error(err);
      showError('Erreur reseau. Reessayez plus tard.');
    }
  }

  load();
})();
