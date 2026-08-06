'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-modal-nav.test.js
 *
 * Module js/b-modal-nav.js (132L) — navigation prev/next produit dans la
 * modal (extrait de b-modal.js, ARCH-2 PR3). Découplage par bus.emit
 * ('modal:open', ...) plutôt qu'appel direct — le module n'importe rien de
 * b-modal.js. Jamais testé en direct avant cette session.
 *
 * Import réel de b-bus.js (bus réel, pas de mock — même pattern que
 * b-nav.test.js) et b-store.js (state/dom réels). setTimeout/
 * requestAnimationFrame réels avec fake timers Jest pour la transition
 * animée dans navigateModal.
 */

jest.useFakeTimers();

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { updateModalNavArrows, navigateModal } = require('../../js/b-modal-nav.js');

function resetState() {
  state.modalProduct = null;
  state.filtered = [];
  state.products = [];
}

beforeEach(() => {
  jest.clearAllTimers();
  document.body.innerHTML = '';
  resetState();
  window.innerWidth = 1200; // desktop par défaut
  dom.modal = document.createElement('div');
  document.body.appendChild(dom.modal); // le code source lit via document.getElementById(), pas dom.modal.querySelector()
});

describe('updateModalNavArrows', () => {
  function makeTopbar() {
    const topbar = document.createElement('div');
    topbar.className = 'k-modal-topbar';
    const right = document.createElement('div');
    right.className = 'k-modal-topbar-right';
    topbar.appendChild(right);
    dom.modal.appendChild(topbar);
    return { topbar, right };
  }

  it('crée la nav aussi sur mobile (viewport < 900px) — Point 5 : plus réservé au desktop', () => {
    window.innerWidth = 500;
    makeTopbar();
    updateModalNavArrows([{ id: 1 }, { id: 2 }], 0);
    expect(document.getElementById('k-modal-nav')).not.toBeNull();
  });

  it('crée la nav (prev/counter/next) et l\'insère dans la topbar à droite', () => {
    const { topbar, right } = makeTopbar();
    updateModalNavArrows([{ id: 1 }, { id: 2 }, { id: 3 }], 1);

    const navEl = document.getElementById('k-modal-nav');
    expect(navEl).not.toBeNull();
    expect(document.getElementById('k-modal-prev')).not.toBeNull();
    expect(document.getElementById('k-modal-next')).not.toBeNull();
    expect(document.getElementById('k-modal-nav-pos').textContent).toBe('2/3');
    // insérée avant .k-modal-topbar-right
    expect(navEl.nextElementSibling).toBe(right);
    expect(navEl.parentElement).toBe(topbar);
  });

  it('ne recrée pas la nav si elle existe déjà (juste mise à jour)', () => {
    makeTopbar();
    updateModalNavArrows([{ id: 1 }, { id: 2 }], 0);
    updateModalNavArrows([{ id: 1 }, { id: 2 }], 1);
    expect(document.querySelectorAll('#k-modal-nav').length).toBe(1);
    expect(document.getElementById('k-modal-nav-pos').textContent).toBe('2/2');
  });

  it('désactive prev sur le premier élément', () => {
    makeTopbar();
    updateModalNavArrows([{ id: 1 }, { id: 2 }], 0);
    expect(document.getElementById('k-modal-prev').classList.contains('is-disabled')).toBe(true);
    expect(document.getElementById('k-modal-next').classList.contains('is-disabled')).toBe(false);
  });

  it('désactive next sur le dernier élément', () => {
    makeTopbar();
    updateModalNavArrows([{ id: 1 }, { id: 2 }], 1);
    expect(document.getElementById('k-modal-next').classList.contains('is-disabled')).toBe(true);
    expect(document.getElementById('k-modal-prev').classList.contains('is-disabled')).toBe(false);
  });

  it('P2 pager 1/1 (2026-07) : masque entièrement le conteneur nav quand total <= 1', () => {
    makeTopbar();
    updateModalNavArrows([{ id: 1 }], 0);
    const navEl = document.getElementById('k-modal-nav');
    expect(navEl).not.toBeNull();
    expect(navEl.hidden).toBe(true);
    expect(navEl.style.display).toBe('none');
    // Le compteur n'est pas mis à jour à "1/1" — la navigation est
    // simplement masquée, aucun texte n'a besoin d'être exact ici.
  });

  it('P2 pager 1/1 (2026-07) : réaffiche le conteneur nav dès que total > 1', () => {
    makeTopbar();
    updateModalNavArrows([{ id: 1 }], 0); // total=1 → masqué
    updateModalNavArrows([{ id: 1 }, { id: 2 }], 0); // total=2 → réaffiché
    const navEl = document.getElementById('k-modal-nav');
    expect(navEl.hidden).toBe(false);
    expect(navEl.style.display).toBe('');
    expect(document.getElementById('k-modal-nav-pos').textContent).toBe('1/2');
  });

  it('ne throw pas si dom.modal n\'a pas de .k-modal-topbar', () => {
    expect(() => updateModalNavArrows([{ id: 1 }], 0)).not.toThrow();
    // nav créée mais pas insérée nulle part (topbar introuvable)
    expect(document.getElementById('k-modal-nav')).toBeNull();
  });

  it('clic sur prevBtn appelle navigateModal(-1) via bus', () => {
    makeTopbar();
    state.modalProduct = { id: 2 };
    state.products = [{ id: 1 }, { id: 2 }, { id: 3 }];
    updateModalNavArrows(state.products, 1);

    const spy = jest.fn();
    bus.on('modal:open', spy);
    document.getElementById('k-modal-prev').click();
    jest.advanceTimersByTime(130);

    expect(spy).toHaveBeenCalledWith({ id: 1, pushHistory: false });
    bus.off('modal:open', spy);
  });

  it('clic sur nextBtn appelle navigateModal(+1) via bus', () => {
    makeTopbar();
    state.modalProduct = { id: 2 };
    state.products = [{ id: 1 }, { id: 2 }, { id: 3 }];
    updateModalNavArrows(state.products, 1);

    const spy = jest.fn();
    bus.on('modal:open', spy);
    document.getElementById('k-modal-next').click();
    jest.advanceTimersByTime(130);

    expect(spy).toHaveBeenCalledWith({ id: 3, pushHistory: false });
    bus.off('modal:open', spy);
  });
});

describe('navigateModal', () => {
  it('ne fait rien si aucun modalProduct actif', () => {
    state.modalProduct = null;
    const spy = jest.fn();
    bus.on('modal:open', spy);
    navigateModal(1);
    jest.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
    bus.off('modal:open', spy);
  });

  it('ne fait rien si le produit courant est introuvable dans la liste', () => {
    state.modalProduct = { id: 'inconnu' };
    state.products = [{ id: 1 }, { id: 2 }];
    const spy = jest.fn();
    bus.on('modal:open', spy);
    navigateModal(1);
    jest.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
    bus.off('modal:open', spy);
  });

  it('ne fait rien en dépassement de borne (direction +1 sur le dernier élément)', () => {
    state.modalProduct = { id: 3 };
    state.products = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const spy = jest.fn();
    bus.on('modal:open', spy);
    navigateModal(1);
    jest.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
    bus.off('modal:open', spy);
  });

  it('ne fait rien en dépassement de borne (direction -1 sur le premier élément)', () => {
    state.modalProduct = { id: 1 };
    state.products = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const spy = jest.fn();
    bus.on('modal:open', spy);
    navigateModal(-1);
    jest.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
    bus.off('modal:open', spy);
  });

  it('utilise state.filtered en priorité sur state.products si non vide', () => {
    state.modalProduct = { id: 2 };
    state.products = [{ id: 1 }, { id: 2 }, { id: 3 }];
    state.filtered = [{ id: 2 }, { id: 9 }];
    const spy = jest.fn();
    bus.on('modal:open', spy);
    navigateModal(1);
    jest.runAllTimers();
    expect(spy).toHaveBeenCalledWith({ id: 9, pushHistory: false });
    bus.off('modal:open', spy);
  });

  it('émet modal:open avec pushHistory:false après le délai de transition (scrollEl présent)', () => {
    dom.modal.innerHTML = '<div class="k-modal-scroll"></div>';
    state.modalProduct = { id: 1 };
    state.products = [{ id: 1 }, { id: 2 }];
    const spy = jest.fn();
    bus.on('modal:open', spy);

    navigateModal(1);
    expect(spy).not.toHaveBeenCalled(); // pas encore, avant le setTimeout(130)
    jest.advanceTimersByTime(130);
    expect(spy).toHaveBeenCalledWith({ id: 2, pushHistory: false });
    bus.off('modal:open', spy);
  });

  it('émet modal:open immédiatement si .k-modal-scroll absent (pas de transition)', () => {
    // dom.modal reste vide, sans .k-modal-scroll
    state.modalProduct = { id: 1 };
    state.products = [{ id: 1 }, { id: 2 }];
    const spy = jest.fn();
    bus.on('modal:open', spy);

    navigateModal(1);

    expect(spy).toHaveBeenCalledWith({ id: 2, pushHistory: false });
    bus.off('modal:open', spy);
  });

  it('applique les styles de transition sur scrollEl avant l\'émission différée', () => {
    dom.modal.innerHTML = '<div class="k-modal-scroll"></div>';
    const scrollEl = dom.modal.querySelector('.k-modal-scroll');
    state.modalProduct = { id: 1 };
    state.products = [{ id: 1 }, { id: 2 }];

    navigateModal(1);

    expect(scrollEl.style.opacity).toBe('0');
    expect(scrollEl.style.transform).toContain('translateX');
  });

  it('restaure la transition finale (opacité 1) après le double requestAnimationFrame post-transition', () => {
    dom.modal.innerHTML = '<div class="k-modal-scroll"></div>';
    const scrollEl = dom.modal.querySelector('.k-modal-scroll');
    state.modalProduct = { id: 1 };
    state.products = [{ id: 1 }, { id: 2 }];

    navigateModal(1);
    jest.advanceTimersByTime(130); // déclenche le setTimeout → nouvel opacity 0 + les 2 rAF imbriqués
    jest.advanceTimersByTime(50);  // laisse les rAF (fake timers modernes) s'exécuter

    expect(scrollEl.style.opacity).toBe('1');
    expect(scrollEl.style.transform).toBe('translateX(0)');
  });

  it('direction -1 (précédent) applique le sens de translation inverse', () => {
    dom.modal.innerHTML = '<div class="k-modal-scroll"></div>';
    const scrollEl = dom.modal.querySelector('.k-modal-scroll');
    state.modalProduct = { id: 2 };
    state.products = [{ id: 1 }, { id: 2 }];

    navigateModal(-1);

    expect(scrollEl.style.transform).toBe('translateX(24px)');
  });
});
