(function() {
  'use strict';
  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));
  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl = document.getElementById('ev-error-block');
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
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function whatsappShareUrl(eventName) {
    const text = encodeURIComponent('Hey ! "' + eventName + '" - un panier evenement Komerce.\nTu peux ajouter ton idee ici : ' + window.location.href);
    return 'https://wa.me/?text=' + text;
  }
  function normalizeWorkspaceResponse(payload) {
    const root = payload || {};
    const workspace = Object.assign({}, root.workspace || root);
    workspace.items = Array.isArray(root.items) ? root.items.map((it) => ({
      id: it.id,
      quantity: Number(it.quantity) || 1,
      product_name: it.product_name || it.product_name_snapshot || it.name || 'Article',
      price_kmf: Number(it.price_kmf ?? it.price_snapshot_kmf) || 0,
    })) : [];
    return workspace;
  }
  function render(workspace) {
    const items = Array.isArray(workspace.items) ? workspace.items : [];
    const isOpen = workspace.status === 'conception' || workspace.status === 'open';
    let html = '<div class="ev-hero" style="margin-top:0;"><div class="ev-hero-emoji">*</div><h1 class="ev-hero-title">' + escHtml(workspace.event_name) + '</h1>';
    if (workspace.event_note) html += '<p class="ev-hero-sub">&laquo; ' + escHtml(workspace.event_note) + ' &raquo;</p>';
    if (workspace.creator_name) html += '<p style="font-size:12px;color:var(--ev-text-muted);margin-top:8px;">Organise par ' + escHtml(workspace.creator_name) + '</p>';
    html += '</div><div class="ev-card"><h2 class="ev-card-title">Articles deja dans le panier</h2><p class="ev-card-sub">Voici ce que le createur a deja ajoute. Vous pouvez proposer d autres idees plus bas.</p>';
    if (!items.length) {
      html += '<div class="ev-empty">Le panier est vide pour l instant.</div>';
    } else {
      html += '<ul class="ev-list">';
      items.forEach((it) => {
        const qty = Number(it.quantity) || 1;
        html += '<li class="ev-list-item"><div class="ev-list-emoji">*</div><div class="ev-list-content"><div class="ev-list-name">' + escHtml(it.product_name) + '</div><div class="ev-list-meta">' + qty + ' x ' + fmt(it.price_kmf) + ' KMF</div></div></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    if (isOpen) {
      html += '<div class="ev-card"><h2 class="ev-card-title">Proposer une idee ou participer</h2><p class="ev-card-sub">Vos suggestions arrivent au createur. Aucun paiement maintenant.</p><form id="ev-contrib-form"><div class="ev-field"><label class="ev-label" for="contributor_name">Votre nom</label><input type="text" id="contributor_name" name="contributor_name" class="ev-input" required maxlength="80"></div><div class="ev-field"><label class="ev-label" for="contributor_phone">Telephone WhatsApp (ou email - au moins un des deux)</label><input type="tel" id="contributor_phone" name="contributor_phone" class="ev-input" maxlength="30"></div><div class="ev-field"><label class="ev-label" for="contributor_email">Email (optionnel)</label><input type="email" id="contributor_email" name="contributor_email" class="ev-input" maxlength="120"></div><div class="ev-field"><label class="ev-label" for="suggestion">Idee de cadeau / produit suggere</label><input type="text" id="suggestion" name="suggestion" class="ev-input" maxlength="120"></div><div class="ev-field"><label class="ev-label" for="amount_kmf">Montant que vous comptez offrir (KMF, optionnel)</label><input type="number" id="amount_kmf" name="amount_kmf" class="ev-input" min="0" step="500"><div class="ev-help">Aucun paiement maintenant - ce n est qu une intention.</div></div><div class="ev-field"><label class="ev-label" for="message">Message (optionnel)</label><textarea id="message" name="message" class="ev-textarea" rows="2" maxlength="300"></textarea></div><button type="submit" class="ev-btn ev-btn-primary ev-btn-block" id="ev-contrib-submit">Envoyer mon idee</button><div id="ev-contrib-error" class="ev-warning" style="display:none;margin-top:10px;"></div><div id="ev-contrib-success" class="ev-info" style="display:none;margin-top:10px;"></div></form></div>';
    } else {
      html += '<div class="ev-warning">Ce panier n accepte plus de nouvelles propositions.</div>';
    }
    html += '<div class="ev-card" style="text-align:center;"><h3 class="ev-card-title" style="font-size:14px;">Inviter d autres personnes</h3><p class="ev-card-sub">Partagez ce lien a d autres membres de la famille pour qu ils participent aussi.</p><a href="' + whatsappShareUrl(workspace.event_name) + '" target="_blank" rel="noopener" class="ev-btn ev-btn-whatsapp">Partager sur WhatsApp</a></div>';
    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';
    const form = document.getElementById('ev-contrib-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('ev-contrib-error');
        const okEl = document.getElementById('ev-contrib-success');
        const submitBtn = document.getElementById('ev-contrib-submit');
        errEl.style.display = 'none'; okEl.style.display = 'none';
        const fd = new FormData(form);
        const payload = {
          contributor_name: (fd.get('contributor_name') || '').trim(),
          contributor_phone: (fd.get('contributor_phone') || '').trim() || null,
          contributor_email: (fd.get('contributor_email') || '').trim() || null,
          suggestion: (fd.get('suggestion') || '').trim() || null,
          intended_amount_kmf: Number(fd.get('amount_kmf')) || null,
          message: (fd.get('message') || '').trim() || null,
          kind: Number(fd.get('amount_kmf')) > 0 ? 'intention' : 'suggestion',
        };
        if (!payload.contributor_name) { errEl.textContent = 'Votre nom est requis.'; errEl.style.display = 'block'; return; }
        if (!payload.contributor_phone && !payload.contributor_email) { errEl.textContent = 'Indiquez au moins un telephone ou un email.'; errEl.style.display = 'block'; return; }
        if (!payload.suggestion && !payload.intended_amount_kmf && !payload.message) { errEl.textContent = 'Indiquez au moins une idee, un montant ou un message.'; errEl.style.display = 'block'; return; }
        submitBtn.disabled = true; submitBtn.textContent = 'Envoi...';
        try {
          const res = await fetch('/api/collective-workspaces/public/' + encodeURIComponent(getPublicToken()) + '/contributions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || ('Erreur ' + res.status)); }
          okEl.innerHTML = 'Merci <strong>' + escHtml(payload.contributor_name) + '</strong> ! Votre idee a ete envoyee au createur du panier.';
          okEl.style.display = 'block'; form.reset(); submitBtn.disabled = false; submitBtn.textContent = 'Envoyer mon idee';
        } catch (err) {
          errEl.textContent = err.message || 'Erreur lors de l envoi.'; errEl.style.display = 'block'; submitBtn.disabled = false; submitBtn.textContent = 'Envoyer mon idee';
        }
      });
    }
  }
  async function load() {
    const token = getPublicToken();
    if (!token) return showError('Lien invalide.');
    try {
      const res = await fetch('/api/collective-workspaces/public/' + encodeURIComponent(token));
      if (res.status === 404) return showError('Ce panier evenement n existe pas ou n est plus accessible.');
      if (!res.ok) return showError('Erreur ' + res.status + ' lors du chargement.');
      render(normalizeWorkspaceResponse(await res.json()));
    } catch (err) {
      console.error(err);
      showError('Erreur reseau. Reessayez plus tard.');
    }
  }
  load();
})();
