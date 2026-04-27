/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page CRÉATION (boutique)
   Sans compte. POST /api/collective-workspaces → redirige vers /event/manage/:token

   P1.1 : si arrivé depuis le panier (?from=cart), pré-charge les items
          puis les ajoute au workspace après création.
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const form = document.getElementById('ev-create-form');
  const submitBtn = document.getElementById('ev-submit-btn');
  const errorBox = document.getElementById('ev-error');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideError() { errorBox.style.display = 'none'; }

  // ── P1.1 : récupérer le panier en attente (si arrivé depuis cart) ──
  function getPendingCart() {
    try {
      const raw = sessionStorage.getItem('komerce_event_pending_cart');
      if (!raw) return null;
      const items = JSON.parse(raw);
      return Array.isArray(items) && items.length ? items : null;
    } catch (_) { return null; }
  }

  // Si on arrive depuis le panier, afficher un bandeau d'info en tête de form
  const pendingCart = getPendingCart();
  if (pendingCart && pendingCart.length) {
    const banner = document.createElement('div');
    banner.className = 'ev-info';
    banner.style.cssText = 'margin-bottom:16px;';
    const itemsCount = pendingCart.length;
    const itemsTotal = pendingCart.reduce((s, i) => s + (Number(i.price_kmf) || 0) * (Number(i.qty) || 1), 0);
    const fromCart = new URLSearchParams(window.location.search).get('from') === 'cart';
    const itemsList = pendingCart.slice(0, 5).map(i => '• ' + (i.name || 'Article') + ' — ' + new Intl.NumberFormat('fr-FR').format(i.price_kmf || 0) + ' KMF' + (i.qty > 1 ? ' ×' + i.qty : '')).join('<br>');
    banner.innerHTML =
      '🛒 <strong>Panier pré-chargé ✓</strong> : ' + itemsCount + ' article' + (itemsCount > 1 ? 's' : '') +
      ' (' + new Intl.NumberFormat('fr-FR').format(Math.round(itemsTotal)) + ' KMF)' +
      (fromCart ? '<br><em style="font-size:12px;color:#555;">Arrivé depuis le panier boutique</em>' : '') +
      '<div style="margin-top:8px;font-size:12px;color:#555;">' + itemsList + (pendingCart.length > 5 ? '<br>… et ' + (pendingCart.length - 5) + ' autre(s)' : '') + '</div>';
    if (form && form.parentElement) {
      form.parentElement.insertBefore(banner, form);
    }
  }

  // Pré-remplir le nom du panier depuis l'URL ?label=...
  (function() {
    var urlLabel = new URLSearchParams(window.location.search).get('label');
    if (urlLabel) {
      var nameInput = document.getElementById('event_name');
      if (nameInput && !nameInput.value) nameInput.value = urlLabel;
    }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const fd = new FormData(form);
    const payload = {
      event_name:     (fd.get('event_name') || '').trim(),
      event_note:     (fd.get('event_note') || '').trim() || null,
      creator_name:   (fd.get('creator_name') || '').trim(),
      creator_phone:  (fd.get('creator_phone') || '').trim() || null,
      creator_email:  (fd.get('creator_email') || '').trim() || null,
      recipient_name: (fd.get('recipient_name') || '').trim() || null,
    };

    if (!payload.event_name) { showError('Le nom du panier est requis.'); return; }
    if (!payload.creator_name) { showError('Votre nom est requis.'); return; }
    if (!payload.creator_phone && !payload.creator_email) {
      showError('Indiquez au moins un téléphone ou un email pour pouvoir retrouver votre lien.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Création en cours…';

    try {
      // ── 1. Créer le workspace ──
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

      // ── 2. Sauvegarde locale du token créateur ──
      try {
        const stored = JSON.parse(localStorage.getItem('komerce-events') || '[]');
        stored.unshift({
          creator_token: data.creator_token,
          public_token:  data.public_token,
          event_name:    payload.event_name,
          created_at:    new Date().toISOString(),
        });
        localStorage.setItem('komerce-events', JSON.stringify(stored.slice(0, 10)));
      } catch (_) {}

      // ── 3. P1.1 — Si panier en attente, ajouter les items au workspace ──
      const cartItems = getPendingCart();
      if (cartItems && cartItems.length) {
        submitBtn.textContent = '⏳ Ajout des articles…';
        try {
          const itemsPayload = cartItems.map(it => ({
            product_id: it.product_id,
            quantity: Number(it.quantity) || 1,
            amount_unit_kmf: Number(it.price_kmf) || 0,
            note: it.product_name || null,
          }));
          await fetch('/api/collective-workspaces/' +
            encodeURIComponent(data.creator_token) + '/items', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', items: itemsPayload }),
          });
          sessionStorage.removeItem('komerce_event_pending_cart');
        } catch (errItems) {
          console.warn('[event-create] echec ajout items panier (workspace cree, items a ajouter manuellement) :', errItems);
        }
      }

      // ── 4. Redirection vers la page createur (URL canonique) ──
      window.location.href = '/event/manage/' + encodeURIComponent(data.creator_token);
    } catch (err) {
      console.error('Creation workspace echouee :', err);
      showError(err.message || 'Erreur reseau. Reessayez.');
      submitBtn.disabled = false;
      submitBtn.textContent = '🎉 Creer le panier evenement';
    }
  });
})();
