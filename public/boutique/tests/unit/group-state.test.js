'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/group-state.test.js
 *
 * Module js/group/group-state.js — synchro badges DOM (refreshGroupBadge).
 *
 * V2-F nettoyage final : isVisibleOwnerCart, sortOwnerCarts, pickOwnerCart
 * et leurs tests ont été retirés — zéro consommateur réel après le retrait
 * de l'ancien switcher "Mes listes" de l'onglet Groupe autonome, disparu
 * avec data-tab="group" (mandat §2/§4). Voir group-state.js pour le détail.
 *
 * applyOwnerCartToState (V4.1) retirée avec ses tests avant ce lot : elle
 * projetait des champs qui n'existent plus sur la réponse publique
 * (total_kmf_snapshot, contributed_kmf, remaining_kmf — migration 124,
 * domaine minimal Boutique First).
 */

const { state } = require('../../js/b-store.js');
const { refreshGroupBadge } = require('../../js/group/group-state.js');

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
    const headerBtn = makeBadge('k-header-komerce-btn');
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
