/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Komerce â€” Panier Ã‰vÃ©nement : Page CRÃ‰ATION (boutique)
   Sans compte. POST /api/collective-workspaces â†’ redirige vers /event/manage/:token

   P1.1 : si arrivÃ© depuis le panier (?from=cart), prÃ©-charge les items
          puis les ajoute au workspace aprÃ¨s crÃ©ation.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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

  // P1.1 : recuperer le panier en attente (si arrive depuis cart)
  function getPendingCart() {
    try {
      const raw = sessionStorage.getItem('komerce_event_pending_cart');
      if (!raw) return null;
      const items = JSON.parse(raw);
      return Array.isArray(items) && items.length ? items : null;
    } catch (_) { return null; }
  }

  // Si on arrive depuis le panier, afficher un bandeau d'info en tete de form
  const pendingCart = getPendingCart();
  if (pendingCart && pendingCart.length) {
    const banner = document.createElement('div');
    banner.className = 'ev-info';
    banner.style.cssText = 'margin-bottom:16px;';
    const itemsCount = pendingCart.length;
    const itemsTotal = pendingCart.reduce((s, i) => s + (Number(i.price_kmf) || 0) * (Number(i.qty) || 1), 0);
    const fromCart = new URLSearchParams(window.location.search).get('from') === 'cart';
    const itemsList = pendingCart.slice(0, 5).map(i => '- ' + (i.name || 'Article') + ' - ' + new Intl.NumberFormat('fr-FR').format(i.price_kmf || 0) + ' KMF' + (i.qty > 1 ? ' x' + i.qty : '')).join('<br>');
    banner.innerHTML =
      '<strong>Panier pre-charge</strong> : ' + itemsCount + ' article' + (itemsCount > 1 ? 's' : '') +
      ' (' + new Intl.NumberFormat('fr-FR').format(Math.round(itemsTotal)) + ' KMF)' +
      (fromCart ? '<br><em style="font-size:12px;color:#555;">Arrive depuis le panier boutique</em>' : '') +
      '<div style="margin-top:8px;font-size:12px;color:#555;">' + itemsList + (pendingCart.length > 5 ? '<br>... et ' + (pendingCart.length - 5) + ' autre(s)' : '') + '</div>';
    if (form && form.parentElement) {
      form.parentElement.insertBefore(banner, form);
    }
  }

  function buildEventName(payload) {
    const note = String(payload.event_note || '').trim();
    const creator = String(payload.creator_name || '').trim();
    const shortNote = note ? note.slice(0, 48) : '';
    if (shortNote) return shortNote;
    if (creator) return 'Panier collectif de ' + creator;
    return 'Panier collectif';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const fd = new FormData(form);
    const payload = {
      event_name:     null,
      event_note:     (fd.get('event_note') || '').trim() || null,
      creator_name:   (fd.get('creator_name') || '').trim(),
      creator_phone:  (fd.get('creator_phone') || '').trim() || null,
      creator_email:  (fd.get('creator_email') || '').trim() || null,
      recipient_name: null,
    };
    payload.event_name = buildEventName(payload);

    if (!payload.creator_name) { showError('Votre nom est requis.'); return; }
    if (!payload.creator_phone && !payload.creator_email) {
      showError('Indiquez au moins un telephone ou un email pour pouvoir retrouver votre lien.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creation en cours...';

    try {
      // 1. Creer le workspace
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

      // 2. Sauvegarde locale du token createur
      try {
        const stored = JSON.parse(localStorage.getItem('komerce-events') || '[]');
        stored.unshift({
          creator_token: data.creator_token,
          public_token:  data.public_token,
          public_url_path: data.public_url_path || null,
          event_name:    payload.event_name,
          created_at:    new Date().toISOString(),
        });
        localStorage.setItem('komerce-events', JSON.stringify(stored.slice(0, 10)));
      } catch (_) {}

      // 3. P1.1 : si panier en attente, ajouter les items au workspace
      const cartItems = getPendingCart();
      if (cartItems && cartItems.length) {
        submitBtn.textContent = 'Ajout des articles...';
        let patchFailed = false;
        let patchError = null;
        // Backend attend 1 item par appel PATCH
        for (const it of cartItems) {
          try {
            const patchRes = await fetch('/api/collective-workspaces/' +
              encodeURIComponent(data.creator_token) + '/items', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'add',
                product_id: it.product_id,
                quantity: Number(it.quantity) || 1,
              }),
            });
            if (!patchRes.ok) {
              const errBody = await patchRes.json().catch(() => ({}));
              if (errBody.error === 'product_not_found') continue;
              patchFailed = true;
              patchError = errBody.message || ('Erreur ' + patchRes.status);
              break;
            }
          } catch (e) {
            patchFailed = true;
            patchError = e.message || 'Erreur reseau lors de l ajout des articles';
            break;
          }
        }
        if (patchFailed) {
          showError('Liste creee, mais ajout des articles echoue : ' + patchError +
            ' - vous pouvez les ajouter manuellement depuis la page de gestion.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Creer le panier collectif';
          return;
        }
        sessionStorage.removeItem('komerce_event_pending_cart');
      }

      // 4. Redirection vers la page createur (URL canonique)
      window.location.href = '/event/manage/' + encodeURIComponent(data.creator_token);
    } catch (err) {
      console.error('Creation workspace echouee :', err);
      showError(err.message || 'Erreur reseau. Reessayez.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Creer le panier collectif';
    }
  });
})();


