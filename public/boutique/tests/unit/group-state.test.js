'use strict';

/**
 * tests/unit/group-state.test.js
 *
 * Module js/group/group-state.js (116L) — sélection/tri des paniers créateur
 * (isVisibleOwnerCart, sortOwnerCarts, pickOwnerCart), synchronisation du
 * store global + sessionStorage (applyOwnerCartToState), et synchro badges
 * DOM (refreshGroupBadge). Jamais testé en direct avant cette session,
 * seulement exercé en chemin heureux via group-render-creator.test.js.
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
  applyOwnerCartToState,
  refreshGroupBadge,
} = require('../../js/group/group-state.js');

function resetShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = null;
  state.shareStatus = null;
  state.shareTotalKmf = null;
  state.shareContributedKmf = null;
  state.shareRemainingKmf = null;
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
  it.each(['cancelled', 'expired', 'finalized', 'converted_to_order'])(
    'false pour le statut exclu "%s"',
    (status) => {
      expect(isVisibleOwnerCart({ status })).toBe(false);
    }
  );
  it.each(['open', 'closed', 'awaiting_choice', 'ordered'])(
    'true pour le statut visible "%s"',
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

describe('applyOwnerCartToState', () => {
  it('ne fait rien si cart est null/undefined', () => {
    applyOwnerCartToState(null);
    expect(state.shareToken).toBeNull();
    expect(window.sessionStorage.getItem('kmrc_share')).toBeNull();
  });

  it('synchronise tous les champs share_* du state', () => {
    applyOwnerCartToState({
      token: 'tok-1',
      id: 'cart-1',
      expires_at: '2026-08-01T00:00:00Z',
      title: 'Mon panier',
      status: 'open',
      total_kmf_snapshot: 5000,
      contributed_kmf: 1500,
      remaining_kmf: 3500,
      share_url: 'https://komerce.km/share/tok-1',
    });
    expect(state.shareToken).toBe('tok-1');
    expect(state.shareId).toBe('cart-1');
    expect(state.shareExpiry).toBe('2026-08-01T00:00:00Z');
    expect(state.cartName).toBe('Mon panier');
    expect(state.shareStatus).toBe('open');
    expect(state.shareTotalKmf).toBe(5000);
    expect(state.shareContributedKmf).toBe(1500);
    expect(state.shareRemainingKmf).toBe(3500);
    expect(state.shareUrl).toBe('https://komerce.km/share/tok-1');
  });

  it('title manquant → "Panier groupe" par défaut', () => {
    applyOwnerCartToState({ token: 'tok-2' });
    expect(state.cartName).toBe('Panier groupe');
  });

  it('share_url absent mais token présent → construit une URL depuis window.location.origin', () => {
    applyOwnerCartToState({ token: 'tok-3' });
    expect(state.shareUrl).toBe(`${window.location.origin}/boutique/?p=tok-3`);
  });

  it('share_url absent et token absent → shareUrl null', () => {
    applyOwnerCartToState({ id: 'cart-x' });
    expect(state.shareUrl).toBeNull();
  });

  it('montants passés par r() — tolère string/valeurs non numériques', () => {
    applyOwnerCartToState({ token: 't', total_kmf_snapshot: '2000.6', contributed_kmf: null, remaining_kmf: 'abc' });
    expect(state.shareTotalKmf).toBe(2001);
    expect(state.shareContributedKmf).toBe(0);
    expect(state.shareRemainingKmf).toBe(0);
  });

  it('persiste un snapshot cohérent dans sessionStorage', () => {
    applyOwnerCartToState({
      token: 'tok-4', id: 'cart-4', status: 'closed',
      total_kmf_snapshot: 1000, contributed_kmf: 400, remaining_kmf: 600,
    });
    const stored = JSON.parse(window.sessionStorage.getItem('kmrc_share'));
    expect(stored).toMatchObject({
      token: 'tok-4', id: 'cart-4', status: 'closed',
      total_kmf: 1000, contributed_kmf: 400, remaining_kmf: 600,
    });
  });

  it('ne throw pas si sessionStorage indisponible/quota dépassé', () => {
    const original = window.sessionStorage.setItem;
    window.sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => applyOwnerCartToState({ token: 'tok-5' })).not.toThrow();
    // le state a quand même été mis à jour malgré l'échec de persistance
    expect(state.shareToken).toBe('tok-5');
    window.sessionStorage.setItem = original;
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
