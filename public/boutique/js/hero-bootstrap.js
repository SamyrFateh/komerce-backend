/**
 * @komerce-arch-lite
 * @role          boutique-hero-bootstrap
 * @domain        catalog
 * @layer         ui-bootstrap
 * @owner         public/boutique/js/b-home-premium-v1.js
 * @purpose       Hero sticky mobile (scroll.style.top), sticky bar desktop (IntersectionObserver),
 *                CTA scroll, proverbe africain rotatif — exécuté après DOM ready (defer).
 * @impact-areas  boutique, hero, mobile, desktop
 * @version       2026-07
 *
 * Externalisé depuis index.html (inline script #3) suite au durcissement
 * CSP FRESH-030/AUD-04 (script-src 'self', sans unsafe-inline).
 * Peut porter defer : n'a pas besoin de s'exécuter avant le CSS.
 */
'use strict';

// Hero sticky logic: fixed wrap on mobile, IntersectionObserver on desktop
(function(){
  let spacer = document.getElementById('k-bar-spacer');
  if (!spacer) return;

  function isMobile(){ return window.innerWidth <= 899; }

  // ── MOBILE : le wrap n'est plus fixé (H0), plus de calcul de top ──
  function setupMobile(){
    if (!isMobile()) return;
    // H0 : #k-hero-fixed-wrap est en position:static, plus besoin de
    // mesurer sa hauteur ni de poser style.top sur #k-page-scroll.
    // Le spacer reprend son rôle normal de réserve.
    spacer.style.display = '';
  }

  // ── DESKTOP : IntersectionObserver sticky bar ──
  function setupDesktop(){
    let sentinel = document.getElementById('k-bar-sentinel');
    let bar = document.getElementById('k-sticky-bar');
    if(!sentinel || !bar) return;
    spacer.style.height = bar.offsetHeight + 'px';
    let observer = new IntersectionObserver(function(entries){
      if(entries[0].isIntersecting){
        bar.classList.remove('is-stuck');
        spacer.style.display = 'none';
      } else {
        bar.classList.add('is-stuck');
        spacer.style.display = 'block';
      }
    }, { rootMargin: '-44px 0px 0px 0px' });
    observer.observe(sentinel);
    window.addEventListener('resize', function(){
      spacer.style.height = bar.offsetHeight + 'px';
    });
  }

  // Bouton "Découvrir le catalogue" : scroll vers le catalogue (mobile ET desktop).
  // Note : le listener desktop ci-dessous (dans le bloc else) cible #k-catalog-section
  // en priorité. Ce listener universel assure le fonctionnement mobile.
  (function() {
    let ctaP = document.querySelector('.k-hero-cta-primary');
    if (ctaP) {
      ctaP.addEventListener('click', function() {
        let target = document.getElementById('k-catalog-section') || document.getElementById('k-grid');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  })();

  if (isMobile()) {
    setupMobile();
  } else {
    setupDesktop();
    // Desktop : brancher les boutons hero CTA
    let ctaPrimary = document.querySelector('.k-hero-cta-primary');
    if (ctaPrimary) {
      ctaPrimary.addEventListener('click', function() {
        let catalog = document.getElementById('k-catalog-section') || document.getElementById('k-grid');
        if (catalog) catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    // .k-hero-cta-ghost a aussi class k-header-nav-btn → déjà géré par setupBnav().
    // Pas de listener supplémentaire ici pour éviter le doublon (switchView 2×).
  }

  // ── Proxy window.scrollY/scrollTo supprimé (Sprint 3) ─────────────────
  // Remplacé par getScrollY() / scrollToPosition() / scrollPageToTop()
  // dans b-scroll-owner.js — importé par chaque module JS concerné.
  // Stripe.js, analytics et libs tierces retrouvent window.scrollY natif.
})();

  /* ══ Proverbe africain rotatif ══ */
  (function() {
    let proverbes = [
      /* 🌍 Afrique de l'Est / Swahili */
      "« Haba na haba hujaza kibaba. » — Grain à grain, on remplit la mesure. (Swahili)",
      "« Haraka haraka haina baraka. » — La précipitation n'apporte pas de bénédiction. (Swahili)",
      "« Akili ni nywele, kila mtu ana zake. » — L'intelligence est comme les cheveux, chacun a les siennes. (Swahili)",
      "« Umoja ni nguvu, utengano ni udhaifu. » — L'union est force, la division est faiblesse. (Swahili)",
      "« Asiyekuwepo na lake halipo. » — Celui qui n'est pas là, ses affaires n'avancent pas. (Swahili)",
      "« Mchagua jembe si mkulima. » — Celui qui choisit sa houe n'est pas cultivateur. (Swahili)",

      /* 🌍 Afrique de l'Ouest */
      "« Si tu veux aller vite, marche seul. Si tu veux aller loin, marche ensemble. » — Proverbe africain",
      "« La forêt serait silencieuse si aucun oiseau ne chantait que le mieux. » — Proverbe africain",
      "« L'enfant qui n'est pas élevé par son village brûlera ce village pour se réchauffer. » — Proverbe africain",
      "« Jusqu'à ce que le lion apprenne à écrire, les histoires de chasse glorifieront toujours le chasseur. » — Proverbe africain",
      "« Une seule main ne peut pas applaudir. » — Proverbe peul",
      "« La pluie ne tombe pas sur un seul toit. » — Proverbe camerounais",
      "« Celui qui pose des questions ne se perd jamais. » — Proverbe haoussa",

      /* 🌍 Afrique du Nord / Comores */
      "« Saba'u 'ilm — walau ilâ s-sîn. » — Cherche le savoir, même jusqu'en Chine. (Arabe / Islam)",
      "« Man sabara zafira. » — Celui qui patiente réussit. (Arabe)",
      "« Al-waqt ka-s-sayf, in lam taqta'hu qata'ak. » — Le temps est comme une épée : si tu ne le coupes pas, il te coupe. (Arabe)",

      /* 🌏 Asie */
      "« Une crise est une occasion qui se présente à cheval. » — Proverbe chinois",
      "« La meilleure heure pour planter un arbre, c'était il y a 20 ans. La deuxième meilleure, c'est maintenant. » — Proverbe chinois",
      "« Tombe sept fois, relève-toi huit. » — Proverbe japonais (Nana korobi ya oki)",
      "« Même un voyage de mille lieues commence par un premier pas. » — Lao Tseu",
      "« Mieux vaut allumer une bougie que maudire l'obscurité. » — Proverbe chinois",
      "« L'eau qui coule doucement creuse la roche. » — Proverbe japonais",

      /* 🌎 Amériques / Europe */
      "« Vouloir, c'est pouvoir. » — Proverbe latin",
      "« Chaque saint a son passé, chaque pécheur a son avenir. » — Oscar Wilde",
      "« La vie, c'est ce qui arrive pendant qu'on fait d'autres projets. » — John Lennon",
      "« Le bonheur n'est pas quelque chose de tout fait. Il vient de vos propres actions. » — Dalai Lama",

      /* ✨ Citations inspirantes */
      "« Le succès c'est d'aller d'échec en échec sans perdre son enthousiasme. » — Churchill",
      "« Commence là où tu es. Utilise ce que tu as. Fais ce que tu peux. » — Arthur Ashe",
      "« La seule façon de faire du bon travail, c'est d'aimer ce que vous faites. » — Steve Jobs",
    ];
    let el = document.getElementById('k-proverb-text');
    if (!el) return;
    let idx = Math.floor(Math.random() * proverbes.length);
    el.textContent = proverbes[idx];
  })();
