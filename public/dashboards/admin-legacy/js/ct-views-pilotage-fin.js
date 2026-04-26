/* ═══════════════════════════════════════════════════════════════════════════
   CT View — Pilotage Financier
   Shell: CT · Section: pilotage_fin (NEW — ADR-008)

   ROLE:
   ─────
   Wrapper autour de la mégavue pilotage.js qui ne montre QUE les tabs à
   dimension financière :
     - 📅 Projection Temporelle (loadTemporel)
     - 🗂️ Mix Catégories (renderMix)
     - ⭐ Fidélité (renderFidelite — la partie loyalty)

   Doublons retirés :
     - Dashboard Live  → existe déjà comme vue 'dashboard' (Cockpit)
     - Clients & Ventes → existe déjà comme vue 'clients' (ADR-006)

   Pour les Ventes & Marges complètes, utiliser la vue 'sales' (ADR-002).

   STRATÉGIE: Strangler Fig — façade non destructive.
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.pilotage_fin = function(main) {
  if (typeof CT.views.pilotage !== 'function') {
    main.innerHTML = '<div class="ct-error">Module pilotage non chargé. Recharge la page.</div>';
    return;
  }

  CT.views.pilotage(main);

  setTimeout(function() {
    // Adapter le titre
    var header = main.querySelector('.ct-view-header h2');
    if (header) header.textContent = '💰 Pilotage Financier';
    var desc = main.querySelector('.ct-view-desc');
    if (desc) desc.textContent = 'Projections, mix catégories, marges — tout ce qui dit si la machine est saine';

    // Masquer les tabs non financiers (ops + clients + dashboard doublon)
    var hiddenTabs = ['ops', 'dashboard', 'clients'];
    hiddenTabs.forEach(function(t) {
      var tab = main.querySelector('[data-pil-tab="' + t + '"]');
      if (tab) tab.style.display = 'none';
      var screen = main.querySelector('[data-pil-screen="' + t + '"]');
      if (screen) screen.style.display = 'none';
    });

    // Rester sur 'temporel' par défaut (déjà l'actif initial)
  }, 50);
};
