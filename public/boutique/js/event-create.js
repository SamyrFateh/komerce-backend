/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page CRÉATION (boutique)
   Sans compte. POST /api/collective-workspaces → /event/manage/:token

   Si l'utilisateur arrive depuis le panier (sessionStorage rempli + ?from=cart),
   les items sont POSTés au workspace après création via PATCH /items.
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const NF = new Intl.NumberFormat('fr-FR');
  const fmt = (n) => NF.format(Math.round(Number(n) || 0));

  const form        = document.getElementById('ev-create-form');
  const submitBtn   = document.getElementById('ev-submit-btn');
  const errorBox    = document.getElementById('ev-error');
  const noteEl      = document.getElementById('event_note');
  const noteCountEl = document.getElementById('ev-note-count');
  const banner      = document.getElementById('ev-pending-banner');

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideError() { errorBox.style.display = 'none'; }

  /* ── Char counter ─────────────────────────────────────── */
  if (noteEl && noteCountEl) {
    noteEl.addEventListener('input', () => {
      noteCountEl.textContent = noteEl.value.length;
    });
  }

  /* ── Snapshot panier en attente (depuis la boutique) ──── */
  function getPendingCart() {
    try {
      const raw = sessionStorage.getItem('komerce_event_pending_cart');
      if (!raw) return null;
      const items = JSON.parse(raw);
      return Array.isArray(items) && items.length ? items : null;
    } catch (_) { return null; }
  }

  const pendingCart = getPendingCart();
  if (pendingCart && pendingCart.length && banner) {
    const itemsCount = pendingCart.length;
    const itemsTotal = pendingCart.reduce(
      (s, i) => s + (Number(i.price_kmf) || 0) * (Number(i.qty || i.quantity) || 1), 0
    );
    const fromCart = new URLSearchParams(window.location.search).get('from') === 'cart';
    const list = pendingCart.slice(0, 4)
      .map(i => '• ' + escHtml(i.name || 'Article') +
                (Number(i.qty || i.quantity) > 1 ? ' ×' + Number(i.qty || i.quantity) : ''))
      .join('<br>');
    const more = pendingCart.length > 4 ? '<br><em style="color:var(--text-muted);">… et ' + (pendingCart.length - 4) + ' autre(s)</em>' : '';
    banner.className = 'ev-alert ev-alert-info';
    banner.style.cssText = 'margin-bottom:12px;';
    banner.innerHTML =
      '<strong>🛒 Panier pré-chargé</strong> · ' + itemsCount + ' article' + (itemsCount > 1 ? 's' : '') +
      ' · <strong>' + fmt(itemsTotal) + ' KMF</strong>' +
      (fromCart ? '<br><span style="font-size:12px;opacity:.8;">Importé depuis votre panier boutique</span>' : '') +
      '<div style="margin-top:8px;font-size:12px;line-height:1.6;">' + list + more + '</div>';
    banner.style.display = 'block';
  }

  /* ── Soumission ────────────────────────────────────────── */
  function buildEventName(payload) {
    const note = String(payload.event_note || '').trim();
    const creator = String(payload.creator_name || '').trim();
    if (note) return note.slice(0, 48);
    if (creator) return 'Panier collectif de ' + creator;
    return 'Panier collectif';
  }

  function combinePhone() {
    const sel = document.getElementById('ev-prefix-select');
    const phone = document.getElementById('creator_phone');
    if (!phone || !phone.value.trim()) return null;
    const raw = phone.value.trim();
    if (raw.startsWith('+')) return raw;
    const prefix = sel ? sel.value : '+269';
    return prefix + raw.replace(/^0/, '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const fd = new FormData(form);
    const payload = {
      event_name:     null,
      event_note:     (fd.get('event_note') || '').trim() || null,
      creator_name:   (fd.get('creator_name') || '').trim(),
      creator_phone:  combinePhone(),
      creator_email:  (fd.get('creator_email') || '').trim() || null,
      recipient_name: null,
    };
    payload.event_name = buildEventName(payload);

    if (!payload.creator_name) { showError('Votre nom est requis.'); return; }
    if (!payload.creator_phone && !payload.creator_email) {
      showError('Indiquez au moins un téléphone ou un email pour retrouver votre lien.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Création en cours…';

    try {
      // 1. Créer le workspace
      const res = await fetch('/api/collective-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || ('Erreur ' + res.status));
      }
      const data = await res.json();

      // 2. Sauvegarde locale du token créateur (retrouver le panier)
      try {
        const stored = JSON.parse(localStorage.getItem('komerce-events') || '[]');
        stored.unshift({
          creator_token:    data.creator_token,
          public_token:     data.public_token,
          public_url_path:  data.public_url_path || null,
          event_name:       payload.event_name,
          created_at:       new Date().toISOString(),
        });
        localStorage.setItem('komerce-events', JSON.stringify(stored.slice(0, 10)));
      } catch (_) {}

      // 3. Si panier en attente, ajouter les items au workspace
      const cartItems = getPendingCart();
      if (cartItems && cartItems.length) {
        submitBtn.textContent = '⏳ Ajout des articles…';
        for (const it of cartItems) {
          if (!it.product_id) continue;
          try {
            await fetch('/api/collective-workspaces/' +
              encodeURIComponent(data.creator_token) + '/items', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'add',
                product_id: it.product_id,
                quantity: Number(it.quantity || it.qty) || 1,
              }),
            });
          } catch (_) { /* on continue, l'organisateur pourra ajouter à la main */ }
        }
        sessionStorage.removeItem('komerce_event_pending_cart');
      }

      // 4. Redirection vers la page créateur
      window.location.href = '/event/manage/' + encodeURIComponent(data.creator_token);
    } catch (err) {
      console.error('Création workspace échouée :', err);
      showError(err.message || 'Erreur réseau. Réessayez.');
      submitBtn.disabled = false;
      submitBtn.textContent = '🛒 Créer le panier collectif';
    }
  });
})();
