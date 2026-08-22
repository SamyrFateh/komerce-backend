/**
 * @komerce-arch-lite
 * @role          boutique-hero-bootstrap
 * @domain        catalog
 * @layer         ui-bootstrap
 * @owner         public/boutique/js/b-home-premium-v1.js
 * @purpose       Hero mobile repliable au scroll, sticky bar desktop (IntersectionObserver),
 *                CTA scroll, proverbe africain rotatif — exécuté après DOM ready (defer).
 * @impact-areas  boutique, hero, mobile, desktop
 * @version       2026-08
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

  const HERO_COLLAPSE_THRESHOLD = 24;
  const HERO_EXPAND_THRESHOLD = 4;
  const HERO_TRANSITION_MS = 160;
  let mobileHeroCollapsed = false;
  let mobileBasePagerTop = null;

  function readMobilePagerTop(){
    let ps = document.getElementById('k-page-scroll');
    let raw = getComputedStyle(document.documentElement).getPropertyValue('--pager-top');
    let cssTop = parseFloat(raw);
    if (Number.isFinite(cssTop) && cssTop > 0) return cssTop;
    let inlineTop = ps ? parseFloat(ps.style.top) : NaN;
    if (Number.isFinite(inlineTop) && inlineTop > 0) return inlineTop;
    if (ps) {
      let rectTop = ps.getBoundingClientRect().top;
      if (Number.isFinite(rectTop) && rectTop > 0) return rectTop;
    }
    return null;
  }

  function getMobileHeroCollapseDistance(){
    let wrap = document.getElementById('k-hero-fixed-wrap');
    let bar = document.getElementById('k-sticky-bar');
    let hero = document.getElementById('k-hero');
    if (!wrap) return 0;

    // Distance exacte entre le haut du wrapper fixe et le rail catégories.
    // En retirant cette distance, le rail vient se poser sous le header.
    if (bar) {
      let distance = bar.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      if (distance > 0) return distance;
    }
    return hero ? hero.getBoundingClientRect().height : 0;
  }

  function setMobileHeroCollapsed(collapsed, instant){
    if (!isMobile()) return;
    if (collapsed === mobileHeroCollapsed) return;

    let wrap = document.getElementById('k-hero-fixed-wrap');
    let ps = document.getElementById('k-page-scroll');
    if (!wrap || !ps || !ps.classList.contains('k-pager-active')) return;

    let collapseDistance = getMobileHeroCollapseDistance();
    if (collapseDistance <= 0) return;

    if (collapsed) {
      mobileBasePagerTop = readMobilePagerTop();
    }
    if (!Number.isFinite(mobileBasePagerTop) || mobileBasePagerTop <= 0) return;

    let header = document.querySelector('.k-header');
    let headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    let nextTop = collapsed
      ? Math.max(headerBottom, mobileBasePagerTop - collapseDistance)
      : mobileBasePagerTop;
    let bnav = document.querySelector('.k-bnav');
    let bnavH = bnav ? bnav.offsetHeight : 56;
    let nextH = Math.max(window.innerHeight - nextTop - bnavH, 300);
    let reducedMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let duration = instant || reducedMotion ? 0 : HERO_TRANSITION_MS;
    let easing = 'cubic-bezier(.2,.7,.2,1)';

    wrap.style.transition = `transform ${duration}ms ${easing}`;
    ps.style.transition = `top ${duration}ms ${easing}`;
    wrap.style.transform = collapsed
      ? `translate3d(0, -${collapseDistance}px, 0)`
      : 'translate3d(0, 0, 0)';

    document.documentElement.style.setProperty('--pager-top', nextTop + 'px');
    document.documentElement.style.setProperty('--pager-h', nextH + 'px');
    ps.style.top = nextTop + 'px';
    mobileHeroCollapsed = collapsed;
  }

  function onMobileCategoryScroll(event){
    if (!isMobile()) return;
    let ps = document.getElementById('k-page-scroll');
    if (!ps || !ps.classList.contains('k-pager-active')) return;
    if (document.body.classList.contains('modal-open')) return;

    let page = event.target;
    if (!page || !page.classList || !page.classList.contains('k-cat-section')) return;

    let st = page.scrollTop;
    let lastST = Number.isFinite(page._kHeroLastST) ? page._kHeroLastST : 0;
    let goingDown = st > lastST + 1;
    let goingUp = st < lastST - 1;
    page._kHeroLastST = st;

    if (goingDown && st >= HERO_COLLAPSE_THRESHOLD) {
      setMobileHeroCollapsed(true, false);
    } else if (goingUp && st <= HERO_EXPAND_THRESHOLD) {
      setMobileHeroCollapsed(false, false);
    }
  }

  // ── MOBILE : émotion d'abord, catalogue ensuite ──────────────
  // Les pages catégorie sont les vrais scrollers verticaux du pager mobile.
  // Le scroll ne bulle pas ; on l'écoute en capture au niveau document.
  // À la descente, le hero sort derrière le header et le rail catégories reste
  // fixé sous celui-ci. La cage produits remonte du même montant : le gain de
  // place est réel. Le hero revient uniquement quand on remonte vraiment en haut.
  function setupMobile(){
    if (!isMobile()) return;
    spacer.style.display = '';
    document.addEventListener('scroll', onMobileCategoryScroll, true);

    // Une rotation repart volontairement de l'état ouvert : b-pager re-mesure
    // ensuite sa cage avec les nouvelles dimensions, sans baseTop périmé.
    window.addEventListener('orientationchange', function(){
      if (!isMobile()) return;
      if (mobileHeroCollapsed) setMobileHeroCollapsed(false, true);
      mobileBasePagerTop = null;
    }, { passive: true });

    // Si l'on franchit le breakpoint vers desktop, ne laisser aucun transform
    // mobile en ligne qui pourrait polluer le layout desktop canonique.
    window.addEventListener('resize', function(){
      if (isMobile()) return;
      let wrap = document.getElementById('k-hero-fixed-wrap');
      let ps = document.getElementById('k-page-scroll');
      if (mobileHeroCollapsed) setMobileHeroCollapsed(false, true);
      if (wrap) {
        wrap.style.transform = '';
        wrap.style.transition = '';
      }
      if (ps) ps.style.transition = '';
      mobileHeroCollapsed = false;
      mobileBasePagerTop = null;
    }, { passive: true });
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

      /* 🌍 Afrique du Nord */
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