/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page PUBLIQUE (boutique)
   Lit /api/collective-workspaces/public/:publicToken
   Affiche : nom événement, panier (lecture seule), formulaire contribution
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const loadingEl = document.getElementById('ev-loading');
  const contentEl = document.getElementById('ev-content');
  const errorEl   = document.getElementById('ev-error-block');

  function getPublicToken() {
    // P0.2 : URL canonique /event/w/:publicToken — legacy /workspace/:t (redirige 301)
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

  function whatsappShareUrl(eventName) {
    const text = encodeURIComponent(
      'Hey ! "' + eventName + '" — un panier événement Komerce.\n' +
      'Tu peux ajouter ton idée ici : ' + window.location.href
    );
    return 'https://wa.me/?text=' + text;
  }

  function render(ws) {
    const items = Array.isArray(ws.items) ? ws.items : [];
    const isOpen = (ws.status === 'conception' || ws.status === 'open');

    let html = '';

    // ── Bloc identité ───────────────────────────────────────────────
    html += '<div class="ev-hero" style="margin-top:0;">';
    html += '<div class="ev-hero-emoji">🎉</div>';
    html += '<h1 class="ev-hero-title">' + escHtml(ws.event_name) + '</h1>';
    if (ws.event_note) {
      html += '<p class="ev-hero-sub">« ' + escHtml(ws.event_note) + ' »</p>';
    }
    if (ws.creator_name) {
      html += '<p style="font-size:12px;color:var(--ev-text-muted);margin-top:8px;">' +
              'Organisé par ' + escHtml(ws.creator_name) + '</p>';
    }
    html += '</div>';

    // ── Bloc Panier (lecture seule) ─────────────────────────────────
    html += '<div class="ev-card">';
    html += '<h2 class="ev-card-title">🛒 Articles déjà dans le panier</h2>';
    html += '<p class="ev-card-sub">Voici ce que le créateur a déjà ajouté. Vous pouvez proposer d\'autres idées plus bas.</p>';
    if (!items.length) {
      html += '<div class="ev-empty">Le panier est vide pour l\'instant. Le créateur ajoutera des articles ou attendra vos suggestions.</div>';
    } else {
      html += '<ul class="ev-list">';
      items.forEach(function(it) {
        const qty = Number(it.quantity) || 1;
        html += '<li class="ev-list-item">';
        html += '<div class="ev-list-emoji">🎁</div>';
        html += '<div class="ev-list-content">';
        html += '<div class="ev-list-name">' + escHtml(it.product_name || it.name || 'Article') + '</div>';
        html += '<div class="ev-list-meta">' + qty + ' × ' + fmt(it.price_kmf) + ' KMF</div>';
        html += '</div></li>';
      });
      html += '</ul>';
    }
    html += '</div>';

    // ── Bloc formulaire contribution ────────────────────────────────
    if (isOpen) {
      html += '<div class="ev-card">';
      html += '<h2 class="ev-card-title">💡 Proposer une idée ou participer</h2>';
      html += '<p class="ev-card-sub">Vos suggestions arrivent au créateur. C\'est lui qui décide ce qui entre dans le panier final. Aucun paiement maintenant.</p>';

      html += '<form id="ev-contrib-form">';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="contributor_name">Votre nom</label>';
      html += '<input type="text" id="contributor_name" name="contributor_name" class="ev-input" required maxlength="80" placeholder="Ex : Aïsha">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="contributor_phone">';
      html += 'Téléphone WhatsApp <span class="ev-label-optional">(ou email — au moins un des deux)</span>';
      html += '</label>';
      html += '<input type="tel" id="contributor_phone" name="contributor_phone" class="ev-input" maxlength="30" placeholder="+269 ...">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="contributor_email">Email <span class="ev-label-optional">(optionnel)</span></label>';
      html += '<input type="email" id="contributor_email" name="contributor_email" class="ev-input" maxlength="120">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="suggestion">Idée de cadeau / produit suggéré</label>';
      html += '<input type="text" id="suggestion" name="suggestion" class="ev-input" maxlength="120" placeholder="Ex : un pagne, un téléphone, du riz…">';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="amount_kmf">';
      html += 'Montant que vous comptez offrir <span class="ev-label-optional">(en KMF, optionnel)</span>';
      html += '</label>';
      html += '<input type="number" id="amount_kmf" name="amount_kmf" class="ev-input" min="0" step="500" placeholder="Ex : 5000">';
      html += '<div class="ev-help">Aucun paiement maintenant — ce n\'est qu\'une intention de contribution.</div>';
      html += '</div>';

      html += '<div class="ev-field">';
      html += '<label class="ev-label" for="message">Message <span class="ev-label-optional">(optionnel)</span></label>';
      html += '<textarea id="message" name="message" class="ev-textarea" rows="2" maxlength="300" placeholder="Ex : Je peux apporter un cadeau supplémentaire si besoin"></textarea>';
      html += '</div>';

      html += '<button type="submit" class="ev-btn ev-btn-primary ev-btn-block" id="ev-contrib-submit">';
      html += '✨ Envoyer mon idée';
      html += '</button>';

      html += '<div id="ev-contrib-error" class="ev-warning" style="display:none;margin-top:10px;"></div>';
      html += '<div id="ev-contrib-success" class="ev-info" style="display:none;margin-top:10px;"></div>';

      html += '</form>';
      html += '</div>';
    } else {
      html += '<div class="ev-warning">⏳ Ce panier n\'accepte plus de nouvelles propositions. Il est en cours de finalisation par le créateur.</div>';
    }

    // ── Bouton partager ─────────────────────────────────────────────
    html += '<div class="ev-card" style="text-align:center;">';
    html += '<h3 class="ev-card-title" style="font-size:14px;">📨 Inviter d\'autres personnes</h3>';
    html += '<p class="ev-card-sub">Partagez ce lien à d\'autres membres de la famille pour qu\'ils participent aussi.</p>';
    html += '<a href="' + whatsappShareUrl(ws.event_name) +
            '" target="_blank" rel="noopener" class="ev-btn ev-btn-whatsapp">' +
            '💬 Partager sur WhatsApp</a>';
    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    // ── Handler form contribution ───────────────────────────────────
    const form = document.getElementById('ev-contrib-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('ev-contrib-error');
        const okEl  = document.getElementById('ev-contrib-success');
        const submitBtn = document.getElementById('ev-contrib-submit');
        errEl.style.display = 'none'; okEl.style.display = 'none';

        const fd = new FormData(form);
        const payload = {
          contributor_name:  (fd.get('contributor_name') || '').trim(),
          contributor_phone: (fd.get('contributor_phone') || '').trim() || null,
          contributor_email: (fd.get('contributor_email') || '').trim() || null,
          suggestion:        (fd.get('suggestion') || '').trim() || null,
          amount_kmf:        Number(fd.get('amount_kmf')) || null,
          message:           (fd.get('message') || '').trim() || null,
          kind:              Number(fd.get('amount_kmf')) > 0 ? 'intention' : 'suggestion',
        };

        if (!payload.contributor_name) {
          errEl.textContent = 'Votre nom est requis.'; errEl.style.display = 'block'; return;
        }
        if (!payload.contributor_phone && !payload.contributor_email) {
          errEl.textContent = 'Indiquez au moins un téléphone ou un email pour que le créateur puisse vous recontacter.';
          errEl.style.display = 'block'; return;
        }
        if (!payload.suggestion && !payload.amount_kmf && !payload.message) {
          errEl.textContent = 'Indiquez au moins une idée, un montant ou un message.';
          errEl.style.display = 'block'; return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Envoi…';

        try {
          const res = await fetch('/api/collective-workspaces/public/' +
            encodeURIComponent(getPublicToken()) + '/contributions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || ('Erreur ' + res.status));
          }
          okEl.innerHTML = '✅ Merci <strong>' + escHtml(payload.contributor_name) + '</strong> ! Votre idée a été envoyée au créateur du panier.';
          okEl.style.display = 'block';
          form.reset();
          submitBtn.disabled = false;
          submitBtn.textContent = '✨ Envoyer mon idée';
        } catch (err) {
          errEl.textContent = err.message || 'Erreur lors de l\'envoi.';
          errEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = '✨ Envoyer mon idée';
        }
      });
    }
  }

  async function load() {
    const token = getPublicToken();
    if (!token) { showError('Lien invalide.'); return; }
    try {
      const res = await fetch('/api/collective-workspaces/public/' + encodeURIComponent(token));
      if (res.status === 404) { showError('Ce panier événement n\'existe pas ou n\'est plus accessible.'); return; }
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
