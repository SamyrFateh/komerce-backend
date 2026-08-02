'use strict';

/**
 * tests/unit/group-state.test.js
 *
 * Module js/group/group-state.js — sélection/tri des paniers créateur
 * (isVisibleOwnerCart, sortOwnerCarts, pickOwnerCart) et synchro badges
 * DOM (refreshGroupBadge).
 *
 * applyOwnerCartToState (V4.1) retirée avec ses tests : elle projetait
 * des champs qui n'existent plus sur la réponse publique (total_kmf_snapshot,
 * contributed_kmf, remaining_kmf — migration 124, domaine minimal
 * Boutique First). La sélection d'une liste dans le switcher se résout
 * désormais par un appel à getSharedCartPublic(token) — même chemin, même
 * donnée, pour tout le monde (storyboard §3).
 *
 * state vient du vrai b-store.js (pattern déjà en place ailleurs). Aucun
 * mock de group-helpers.js (r() est une fonction pure, aucune raison de
 * l'intercepter).
 */

const { state } = require('../../js/b-store.js');
const {
  isVisibleOwnerCart,
  sortOwnerCarts,
  pickOwnerCart,
  refreshGroupBadge,
} = require('../../js/group/group-state.js');

function resetShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareUrl = null;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  resetShareState();
});

describe('isVisibleOwnerCart', () => {
  it('false si cart est null/undefined', () => {
    expect(isVisibleOwnerCart(null)).toBe(false);
    expect(isVisibleOwnerCart(undefined)).toBe(false);
  });
  it('false pour le statut "cancelled"', () => {
    expect(isVisibleOwnerCart({ status: 'cancelled' })).toBe(false);
  });
  it.each(['open', 'closed'])(
    'true pour le statut visible "%s" (une liste fermée reste consultable en lecture seule, storyboard §5)',
    (status) => {
      expect(isVisibleOwnerCart({ status })).toBe(true);
    }
  );
});

describe('sortOwnerCarts', () => {
  it('trie du plus récent au plus ancien', () => {
    const carts = [
      { id: 'a', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', created_at: '2026-06-01T00:00:00Z' },
      { id: 'c', created_at: '2026-03-01T00:00:00Z' },
    ];
    expect(sortOwnerCarts(carts).map(c => c.id)).toEqual(['b', 'c', 'a']);
  });
  it('ne mute pas le tableau original', () => {
    const carts = [
      { id: 'a', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', created_at: '2026-06-01T00:00:00Z' },
    ];
    const original = [...carts];
    sortOwnerCarts(carts);
    expect(carts).toEqual(original);
  });
  it('tolère created_at manquant (traité comme epoch 0, relégué en fin)', () => {
    const carts = [
      { id: 'a', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b' },
    ];
    expect(sortOwnerCarts(carts).map(c => c.id)).toEqual(['a', 'b']);
  });
  it('tolère created_at manquant sur le premier élément comparé (autre ordre)', () => {
    const carts = [
      { id: 'x' },
      { id: 'y', created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(sortOwnerCarts(carts).map(c => c.id)).toEqual(['y', 'x']);
  });
  it('tableau vide ou absent → tableau vide', () => {
    expect(sortOwnerCarts([])).toEqual([]);
    expect(sortOwnerCarts()).toEqual([]);
  });
});

describe('pickOwnerCart', () => {
  const carts = [
    { id: '1', status: 'open', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', status: 'open', created_at: '2026-06-01T00:00:00Z' },
    { id: '3', status: 'cancelled', created_at: '2026-09-01T00:00:00Z' },
  ];

  it('retourne le panier visible le plus récent par défaut', () => {
    expect(pickOwnerCart(carts).id).toBe('2');
  });
  it('privilégie preferredId si présent et visible', () => {
    expect(pickOwnerCart(carts, '1').id).toBe('1');
  });
  it('preferredId compare en string (id numérique OK)', () => {
    const numCarts = [{ id: 1, status: 'open', created_at: '2026-01-01T00:00:00Z' }];
    expect(pickOwnerCart(numCarts, 1).id).toBe(1);
  });
  it('ignore preferredId si ce panier n\'est pas visible (cancelled), retombe sur le plus récent visible', () => {
    expect(pickOwnerCart(carts, '3').id).toBe('2');
  });
  it('ignore preferredId si introuvable, retombe sur le plus récent visible', () => {
    expect(pickOwnerCart(carts, 'inexistant').id).toBe('2');
  });
  it('retourne null si aucun panier visible', () => {
    expect(pickOwnerCart([{ id: '1', status: 'cancelled' }])).toBeNull();
  });
  it('retourne null si liste vide ou absente', () => {
    expect(pickOwnerCart([])).toBeNull();
    expect(pickOwnerCart()).toBeNull();
  });
});

describe('refreshGroupBadge', () => {
  function makeBadge(id) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    return el;
  }

  it('ajoute la classe show + has-active si shareToken présent', () => {
    const bnavBadge = makeBadge('k-bnav-group-badge');
    const headerBadge = makeBadge('k-header-group-badge');
    const headerBtn = makeBadge('k-header-group-btn');
    state.shareToken = 'tok-1';

    refreshGroupBadge();

    expect(bnavBadge.classList.contains('show')).toBe(true);
    expect(headerBadge.classList.contains('show')).toBe(true);
    expect(headerBtn.classList.contains('has-active')).toBe(true);
  });

  it('retire les classes si shareToken absent', () => {
    const bnavBadge = makeBadge('k-bnav-group-badge');
    bnavBadge.classList.add('show');
    state.shareToken = null;

    refreshGroupBadge();

    expect(bnavBadge.classList.contains('show')).toBe(false);
  });

  it('ne throw pas si les éléments DOM sont absents', () => {
    state.shareToken = 'tok-1';
    expect(() => refreshGroupBadge()).not.toThrow();
  });
});
