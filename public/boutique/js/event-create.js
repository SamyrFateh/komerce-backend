/* ═══════════════════════════════════════════════════════════════════════
   Komerce — Panier Événement : Page CRÉATION (boutique)
   Sans compte. POST /api/collective-workspaces → redirige vers /event/{token}/manage
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

    if (!payload.event_name) { showError('Le nom de l\'événement est requis.'); return; }
    if (!payload.creator_name) { showError('Votre nom est requis.'); return; }
    if (!payload.creator_phone && !payload.creator_email) {
      showError('Indiquez au moins un téléphone ou un email pour pouvoir retrouver votre lien.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Création en cours…';

    try {
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
      // Sauvegarde locale du token créateur (au cas où l'utilisateur perd l'URL)
      try {
        const stored = JSON.parse(localStorage.getItem('komerce-events') || '[]');
        stored.unshift({
          creator_token: data.creator_token,
          public_token:  data.public_token,
          event_name:    payload.event_name,
          created_at:    new Date().toISOString(),
        });
        localStorage.setItem('komerce-events', JSON.stringify(stored.slice(0, 10)));
      } catch (_) { /* localStorage indisponible : on ignore */ }

      // Redirection page créateur
      window.location.href = '/event/' + encodeURIComponent(data.creator_token) + '/manage';
    } catch (err) {
      console.error('Création workspace échouée :', err);
      showError(err.message || 'Erreur réseau. Réessayez.');
      submitBtn.disabled = false;
      submitBtn.textContent = '🎉 Créer le panier événement';
    }
  });
})();
