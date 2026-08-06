'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-scroll-owner.test.js
 *
 * js/b-scroll-owner.js — source de vérité du scroll boutique (criticality: high,
 * utilisé par b-catalog.js, b-subcat.js, b-nav.js, b-cart.js, modal-modules,
 * desktop-enhancers). Avant ce lot : 3% stmt, aucun test dédié.
 *
 * Choix de test :
 *   - window.scrollTo et Element.prototype.scrollTo sont mockés en jest.fn()
 *     dans chaque test : jsdom n'implémente PAS Element.prototype.scrollTo
 *     (undefined) et loggue "not implemented" bruyamment sur window.scrollTo.
 *     Mocker permet des assertions exactes sur (top, behavior) sans bruit console.
 *   - requestAnimationFrame est mocké en jest.fn() qui STOCKE le callback sans
 *     l'exécuter automatiquement (contrairement à jsdom natif qui l'exécute de
 *     façon asynchrone après ~16ms). On déclenche le frame manuellement via
 *     flushRAF() — ceci permet de tester le guard double-nettoyage de
 *     ensureDesktopScrollOwner() y compris la race condition (resize vers
 *     mobile entre l'appel synchrone et le frame suivant).
 *   - installScrollOwner() a un flag module-level `installed` (idempotence,
 *     même pattern que b-pager.js) : un seul describe l'exerce, avec
 *     jest.resetModules() + re-require pour repartir d'un module frais.
 */

function setDesktop(px) {
  window.innerWidth = px;
}

function flushRAF(rafMock) {
  const cbs = rafMock.mock.calls.map((c) => c[0]);
  rafMock.mockClear();
  cbs.forEach((cb) => cb());
}

describe('b-scroll-owner — fonctions pures', () => {
  let scrollOwner;

  beforeEach(() => {
    jest.resetModules();
    scrollOwner = require('../../js/b-scroll-owner.js');
    document.body.innerHTML = '';
    document.documentElement.style.cssText = '';
    setDesktop(1200);
    window.scrollTo = jest.fn();
    global.requestAnimationFrame = jest.fn();
  });

  // ── isDesktop ──────────────────────────────────────────────────────────

  describe('isDesktop', () => {
    test('>= 900px → desktop', () => {
      setDesktop(900);
      expect(scrollOwner.isDesktop()).toBe(true);
      setDesktop(1440);
      expect(scrollOwner.isDesktop()).toBe(true);
    });

    test('< 900px → mobile', () => {
      setDesktop(899);
      expect(scrollOwner.isDesktop()).toBe(false);
      setDesktop(375);
      expect(scrollOwner.isDesktop()).toBe(false);
    });
  });

  // ── clearInlinePagerStyles ─────────────────────────────────────────────

  describe('clearInlinePagerStyles', () => {
    test('el null → ne lève pas', () => {
      expect(() => scrollOwner.clearInlinePagerStyles(null)).not.toThrow();
    });

    test('efface toutes les propriétés inline posées par le pager', () => {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:10px;left:0;right:0;bottom:0;width:100%;height:50vh;max-width:600px;overflow:hidden;transform:translateY(-10px);transition:transform .2s;';
      scrollOwner.clearInlinePagerStyles(el);
      ['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'maxWidth', 'overflow', 'overflowX', 'overflowY', 'transform', 'transition']
        .forEach((prop) => expect(el.style[prop]).toBe(''));
    });

    test('ne touche pas aux propriétés hors liste', () => {
      const el = document.createElement('div');
      el.style.color = 'red';
      scrollOwner.clearInlinePagerStyles(el);
      expect(el.style.color).toBe('red');
    });
  });

  // ── ensureDesktopScrollOwner ───────────────────────────────────────────

  describe('ensureDesktopScrollOwner', () => {
    test('mobile → early return, aucune modification', () => {
      setDesktop(375);
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.className = 'k-pager-active';
      ps.style.position = 'fixed';
      document.body.appendChild(ps);

      scrollOwner.ensureDesktopScrollOwner();

      expect(ps.classList.contains('k-pager-active')).toBe(true);
      expect(ps.style.position).toBe('fixed');
      expect(global.requestAnimationFrame).not.toHaveBeenCalled();
    });

    test('#k-page-scroll et #k-grid absents → ne lève pas', () => {
      expect(() => scrollOwner.ensureDesktopScrollOwner()).not.toThrow();
    });

    test('desktop → retire k-pager-active, nettoie styles inline ps + grid', () => {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.className = 'k-pager-active';
      ps.style.cssText = 'position:fixed;top:0;overflow:hidden;';
      document.body.appendChild(ps);

      const grid = document.createElement('div');
      grid.id = 'k-grid';
      grid.className = 'k-grid-cat-pager k-grid-flat-subcat';
      grid.style.cssText = 'width:100%;transform:translateY(0);';
      document.body.appendChild(grid);

      document.documentElement.style.setProperty('--pager-top', '10px');
      document.documentElement.style.setProperty('--pager-h', '50vh');
      document.documentElement.style.setProperty('--pager-w', '100%');
      document.documentElement.style.setProperty('--bnav-h', '60px');

      scrollOwner.ensureDesktopScrollOwner();

      expect(ps.classList.contains('k-pager-active')).toBe(false);
      expect(ps.style.position).toBe('');
      expect(grid.classList.contains('k-grid-cat-pager')).toBe(false);
      expect(grid.classList.contains('k-grid-flat-subcat')).toBe(false);
      expect(grid.style.width).toBe('');
      expect(document.documentElement.style.getPropertyValue('--pager-top')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--pager-h')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--bnav-h')).toBe('');
    });

    test('guard rAF : reclean au frame suivant si toujours desktop (ps + grid)', () => {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      document.body.appendChild(ps);
      const grid = document.createElement('div');
      grid.id = 'k-grid';
      document.body.appendChild(grid);
      scrollOwner.ensureDesktopScrollOwner();

      // Le pager réécrit des styles inline de façon async, juste avant le frame
      ps.style.position = 'fixed';
      grid.style.width = '100%';
      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);
      flushRAF(global.requestAnimationFrame);

      expect(ps.style.position).toBe('');
      expect(grid.style.width).toBe('');
    });

    test('guard rAF : ne fait rien si on est repassé mobile avant le frame (race condition)', () => {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      document.body.appendChild(ps);
      scrollOwner.ensureDesktopScrollOwner();

      setDesktop(375); // resize vers mobile entre le call sync et le frame
      ps.style.position = 'fixed';
      flushRAF(global.requestAnimationFrame);

      // Le guard a vu isDesktop() === false au moment du frame → ne touche rien
      expect(ps.style.position).toBe('fixed');
    });

    test('guard rAF : #k-page-scroll/#k-grid absents au moment du frame → ne lève pas', () => {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      document.body.appendChild(ps);
      scrollOwner.ensureDesktopScrollOwner();

      ps.remove();
      expect(() => flushRAF(global.requestAnimationFrame)).not.toThrow();
    });
  });

  // ── getMobileScrollContainer ───────────────────────────────────────────

  describe('getMobileScrollContainer', () => {
    test('#k-page-scroll absent → null', () => {
      expect(scrollOwner.getMobileScrollContainer()).toBeNull();
    });

    test('#k-page-scroll présent sans k-pager-active → null', () => {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      document.body.appendChild(ps);
      expect(scrollOwner.getMobileScrollContainer()).toBeNull();
    });

    test('#k-page-scroll.k-pager-active → retourne l\'élément', () => {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.classList.add('k-pager-active');
      document.body.appendChild(ps);
      expect(scrollOwner.getMobileScrollContainer()).toBe(ps);
    });
  });

  // ── getScrollY ─────────────────────────────────────────────────────────

  describe('getScrollY', () => {
    test('desktop → window.scrollY natif', () => {
      setDesktop(1200);
      Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
      expect(scrollOwner.getScrollY()).toBe(340);
    });

    test('mobile avec pager actif → container.scrollTop', () => {
      setDesktop(375);
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.classList.add('k-pager-active');
      Object.defineProperty(ps, 'scrollTop', { value: 120, configurable: true });
      document.body.appendChild(ps);
      expect(scrollOwner.getScrollY()).toBe(120);
    });

    test('mobile sans pager actif → window.scrollY (fallback)', () => {
      setDesktop(375);
      Object.defineProperty(window, 'scrollY', { value: 77, configurable: true });
      expect(scrollOwner.getScrollY()).toBe(77);
    });
  });

  // ── scrollToPosition ───────────────────────────────────────────────────

  describe('scrollToPosition', () => {
    test('desktop → window.scrollTo, behavior par défaut "auto"', () => {
      setDesktop(1200);
      scrollOwner.scrollToPosition(500);
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'auto' });
    });

    test('desktop → behavior explicite propagé', () => {
      setDesktop(1200);
      scrollOwner.scrollToPosition(500, 'smooth');
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });
    });

    test('mobile avec container → container.scrollTo, pas window', () => {
      setDesktop(375);
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.classList.add('k-pager-active');
      ps.scrollTo = jest.fn();
      document.body.appendChild(ps);

      scrollOwner.scrollToPosition(200, 'smooth');

      expect(ps.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'smooth' });
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

    test('mobile sans container → fallback window.scrollTo', () => {
      setDesktop(375);
      scrollOwner.scrollToPosition(200);
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'auto' });
    });
  });

  // ── scrollPageToTop ────────────────────────────────────────────────────

  describe('scrollPageToTop', () => {
    test('desktop → window.scrollTo top:0, behavior par défaut "smooth"', () => {
      setDesktop(1200);
      scrollOwner.scrollPageToTop();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(window.scrollTo).toHaveBeenCalledTimes(1);
    });

    test('mobile avec container → scrolle le container ET remet window à zéro', () => {
      setDesktop(375);
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.classList.add('k-pager-active');
      ps.scrollTo = jest.fn();
      document.body.appendChild(ps);

      scrollOwner.scrollPageToTop('auto');

      expect(ps.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      // Résidu de scroll window possible en sortie de pager (clavier, focus...)
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });

    test('mobile sans container → seul window.scrollTo est appelé', () => {
      setDesktop(375);
      scrollOwner.scrollPageToTop();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(window.scrollTo).toHaveBeenCalledTimes(1);
    });
  });

  // ── scrollPageToElement ────────────────────────────────────────────────

  describe('scrollPageToElement', () => {
    test('el null → no-op', () => {
      scrollOwner.scrollPageToElement(null);
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

    test('desktop → getBoundingClientRect + window.scrollY + offset', () => {
      setDesktop(1200);
      Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
      const el = document.createElement('div');
      el.getBoundingClientRect = jest.fn(() => ({ top: 250 }));
      document.body.appendChild(el);

      scrollOwner.scrollPageToElement(el, 20, 'auto');

      expect(window.scrollTo).toHaveBeenCalledWith({ top: 370, behavior: 'auto' });
    });

    test('desktop → résultat négatif clampé à 0', () => {
      setDesktop(1200);
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      const el = document.createElement('div');
      el.getBoundingClientRect = jest.fn(() => ({ top: -500 }));
      document.body.appendChild(el);

      scrollOwner.scrollPageToElement(el, 0, 'auto');

      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });

    test('mobile, container contient el → maths locales au container', () => {
      setDesktop(375);
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.classList.add('k-pager-active');
      ps.scrollTo = jest.fn();
      ps.getBoundingClientRect = jest.fn(() => ({ top: 50 }));
      Object.defineProperty(ps, 'scrollTop', { value: 30, configurable: true });

      const el = document.createElement('div');
      el.getBoundingClientRect = jest.fn(() => ({ top: 200 }));
      ps.appendChild(el);
      document.body.appendChild(ps);
      // jsdom : contains() fonctionne nativement sur la vraie hiérarchie DOM

      scrollOwner.scrollPageToElement(el, 10, 'smooth');

      // localTop = elRect.top(200) - cRect.top(50) + scrollTop(30) + offset(10) = 190
      expect(ps.scrollTo).toHaveBeenCalledWith({ top: 190, behavior: 'smooth' });
      expect(window.scrollTo).not.toHaveBeenCalled();
    });

    test('mobile, container présent mais ne contient pas el → fallback maths desktop', () => {
      setDesktop(375);
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      ps.classList.add('k-pager-active');
      ps.scrollTo = jest.fn();
      document.body.appendChild(ps);

      Object.defineProperty(window, 'scrollY', { value: 15, configurable: true });
      const el = document.createElement('div');
      el.getBoundingClientRect = jest.fn(() => ({ top: 100 }));
      document.body.appendChild(el); // hors ps

      scrollOwner.scrollPageToElement(el, 5, 'auto');

      expect(ps.scrollTo).not.toHaveBeenCalled();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'auto' });
    });

    test('mobile sans container du tout → fallback maths desktop', () => {
      setDesktop(375);
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      const el = document.createElement('div');
      el.getBoundingClientRect = jest.fn(() => ({ top: 80 }));
      document.body.appendChild(el);

      scrollOwner.scrollPageToElement(el, 0, 'auto');

      expect(window.scrollTo).toHaveBeenCalledWith({ top: 80, behavior: 'auto' });
    });
  });
});

// ═══ installScrollOwner — idempotence, listeners resize + wheel ═════════════

describe('b-scroll-owner — installScrollOwner', () => {
  let scrollOwner;

  beforeEach(() => {
    jest.resetModules();
    scrollOwner = require('../../js/b-scroll-owner.js');
    document.body.innerHTML = '';
    document.body.className = '';
    window.scrollTo = jest.fn();
    window.scrollBy = jest.fn();
    global.requestAnimationFrame = jest.fn();
  });

  test('appelle ensureDesktopScrollOwner() au montage', () => {
    setDesktop(1200);
    const ps = document.createElement('div');
    ps.id = 'k-page-scroll';
    ps.classList.add('k-pager-active');
    document.body.appendChild(ps);

    scrollOwner.installScrollOwner();

    expect(ps.classList.contains('k-pager-active')).toBe(false);
  });

  test('idempotent : un second appel ne réinstalle pas les listeners', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    scrollOwner.installScrollOwner();
    const callsAfterFirst = addSpy.mock.calls.length;
    scrollOwner.installScrollOwner();
    expect(addSpy.mock.calls.length).toBe(callsAfterFirst);
    addSpy.mockRestore();
  });

  test('resize → relance ensureDesktopScrollOwner', () => {
    scrollOwner.installScrollOwner();
    setDesktop(1200);
    const ps = document.createElement('div');
    ps.id = 'k-page-scroll';
    ps.classList.add('k-pager-active');
    document.body.appendChild(ps);

    window.dispatchEvent(new Event('resize'));

    expect(ps.classList.contains('k-pager-active')).toBe(false);
  });

  describe('wheel owner (desktop uniquement)', () => {
    function makePageScroll(withTarget) {
      const ps = document.createElement('div');
      ps.id = 'k-page-scroll';
      const target = withTarget || document.createElement('div');
      ps.appendChild(target);
      document.body.appendChild(ps);
      return { ps, target };
    }

    function fireWheel(target, opts = {}) {
      const evt = new Event('wheel', { bubbles: true });
      Object.assign(evt, { deltaY: 100, deltaMode: 0, ...opts });
      Object.defineProperty(evt, 'target', { value: target, configurable: true });
      window.dispatchEvent(evt);
      return evt;
    }

    beforeEach(() => {
      setDesktop(1200);
      Object.defineProperty(document.documentElement, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
      scrollOwner.installScrollOwner();
    });

    test('mobile → ne redirige rien', () => {
      setDesktop(375);
      const { target } = makePageScroll();
      fireWheel(target);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('modal-open → ne redirige rien', () => {
      document.body.classList.add('modal-open');
      const { target } = makePageScroll();
      fireWheel(target);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('cart-open → ne redirige rien', () => {
      document.body.classList.add('cart-open');
      const { target } = makePageScroll();
      fireWheel(target);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('target sans closest() → ne lève pas, ne redirige rien', () => {
      const evt = new Event('wheel', { bubbles: true });
      Object.assign(evt, { deltaY: 100, deltaMode: 0 });
      Object.defineProperty(evt, 'target', { value: {}, configurable: true });
      expect(() => window.dispatchEvent(evt)).not.toThrow();
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('target dans .k-modal → ne redirige rien', () => {
      const modal = document.createElement('div');
      modal.className = 'k-modal';
      const inner = document.createElement('div');
      modal.appendChild(inner);
      document.body.appendChild(modal);
      fireWheel(inner);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('target dans #k-side-cart → ne redirige rien (scroll interne propre)', () => {
      const sideCart = document.createElement('div');
      sideCart.id = 'k-side-cart';
      const inner = document.createElement('div');
      sideCart.appendChild(inner);
      document.body.appendChild(sideCart);
      fireWheel(inner);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('target dans .k-cats-shell (rail de chips) → ne redirige rien', () => {
      const rail = document.createElement('div');
      rail.className = 'k-cats-shell';
      const inner = document.createElement('div');
      rail.appendChild(inner);
      document.body.appendChild(rail);
      fireWheel(inner);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('target hors #k-page-scroll → ne redirige rien', () => {
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireWheel(outside);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('maxScroll <= 0 (page pas scrollable) → ne redirige rien', () => {
      Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true });
      Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
      const { target } = makePageScroll();
      fireWheel(target);
      expect(window.scrollBy).not.toHaveBeenCalled();
    });

    test('cas nominal : redirige la molette vers window.scrollBy (deltaMode 0 → unit 1)', () => {
      const { target } = makePageScroll();
      fireWheel(target, { deltaY: 120, deltaMode: 0 });
      expect(window.scrollBy).toHaveBeenCalledWith({ top: 120, left: 0, behavior: 'auto' });
    });

    test('deltaMode 1 (ligne) → unit ×16', () => {
      const { target } = makePageScroll();
      fireWheel(target, { deltaY: 3, deltaMode: 1 });
      expect(window.scrollBy).toHaveBeenCalledWith({ top: 48, left: 0, behavior: 'auto' });
    });

    test('deltaMode 2 (page) → unit ×window.innerHeight', () => {
      const { target } = makePageScroll();
      fireWheel(target, { deltaY: 2, deltaMode: 2 });
      expect(window.scrollBy).toHaveBeenCalledWith({ top: 2 * window.innerHeight, left: 0, behavior: 'auto' });
    });
  });
});
