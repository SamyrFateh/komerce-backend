/* ═══════════════════════════════════════════════════════════════════════════
   CT View — Pilotage Opérationnel
   Shell: CT · Section: pilotage_op (NEW — ADR-008)

   ROLE:
   ─────
   Cette vue est un WRAPPER autour de la mégavue ct-views-pilotage.js qui
   contient 6 tabs mélangeant op et financier. Elle ne montre QUE les tabs
   à dimension opérationnelle :
     - 🚦 SLA & Pipeline (renderOps)
     - 📦 Invendus & Stock (renderInvendus, partie invendus de fidelite)

   La séparation Op vs Fin est une demande d'architecture (audit). À terme,
   la mégavue pilotage.js sera splittée physiquement, mais en attendant ce
   wrapper donne déjà la perception d'une vraie séparation.

   STRATÉGIE: Strangler Fig Pattern — on n'ajoute pas, on ne casse pas, on
   façade par-dessus.
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.pilotage_op = function(main) {
  // Charger d'abord la vue pilotage normale
  if (typeof CT.views.pilotage !== 'function') {
    main.innerHTML = '<div class="ct-error">Module pilotage non chargé. Recharge la page.</div>';
    return;
  }

  CT.views.pilotage(main);

  // Une fois rendue, masquer les tabs financiers/clients/dashboard (doublons)
  // et ne garder que ceux opérationnels.
  // On le fait après un tick pour laisser le rendu se compléter.
  setTimeout(function() {
    // Adapter le titre
    var header = main.querySelector('.ct-view-header h2');
    if (header) header.textContent = '🚦 Pilotage Opérationnel';
    var desc = main.querySelector('.ct-view-desc');
    if (desc) desc.textContent = 'SLA, pipeline, blocages, capacité, invendus — tout ce qui dit si la machine peut tenir';

    // Masquer les tabs non opérationnels
    var hiddenTabs = ['temporel', 'mix', 'dashboard', 'clients'];
    hiddenTabs.forEach(function(t) {
      var tab = main.querySelector('[data-pil-tab="' + t + '"]');
      if (tab) tab.style.display = 'none';
      var screen = main.querySelector('[data-pil-screen="' + t + '"]');
      if (screen) screen.style.display = 'none';
    });

    // Rester sur 'ops' par défaut au lieu de 'temporel'
    var opsTab = main.querySelector('[data-pil-tab="ops"]');
    var temporalTab = main.querySelector('[data-pil-tab="temporel"]');
    if (opsTab && temporalTab) {
      // Désactiver temporel
      var allTabs = main.querySelectorAll('.pil-tab');
      allTabs.forEach(function(t) { t.classList.remove('active'); });
      var allScreens = main.querySelectorAll('.pil-screen');
      allScreens.forEach(function(s) { s.classList.remove('active'); });

      // Activer ops
      opsTab.classList.add('active');
      var opsScreen = main.querySelector('[data-pil-screen="ops"]');
      if (opsScreen) opsScreen.classList.add('active');

      // Déclencher le chargement des données ops
      opsTab.click();
    }
  }, 50);
};
