'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * P1 (audit sélecteurs obsolètes) — group-library-remove.js::
 * syncActiveListSaveButton() ciblait document.getElementById('k-shared-list-save'),
 * un id qui n'existe plus dans aucun rendu depuis la migration vers le side
 * cart / drawer canonique (le bouton réel est 'k-sc-snap-save' desktop ou
 * 'k-cart-snap-save' mobile, voir js/b-cart.js::getOrCreateSnapshotButton).
 * Ce lookup retournait donc toujours null et la fonction ne faisait jamais
 * rien : ce test couvre le contrat réel (le bouton doit repasser à
 * "☆ Sauvegarder" une fois la liste retirée de "Mes listes").
 */

jest.mock('../../js/b-utils.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/group/group-api.js', () => ({
  removeSavedSharedCart: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { removeSavedSharedCart } = require('../../js/group/group-api.js');
const { installSharedLibraryRemove } = require('../../js/group/group-library-remove.js');

function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = `
    <div id="k-track-lists-panel-wrap"></div>
    <button id="k-sc-snap-save">✓ Sauvegardée</button>
  `;
  state.libraryContext = { created: [], saved: [] };
  state.sharedListContext = { token: 'tok-1', sharedCartId: 'sc-1' };
  state.savedListTokensThisSession = new Set();
});

describe('group-library-remove — syncActiveListSaveButton (P1 fix)', () => {
  it('cible bien le bouton réel #k-sc-snap-save (jamais #k-shared-list-save, qui n\'existe plus)', async () => {
    installSharedLibraryRemove();
    // "tok-1" n'est ni dans la bibliothèque rechargée ni sauvegardée cette
    // session : le bouton doit repasser à l'état "à sauvegarder".
    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();

    const button = document.getElementById('k-sc-snap-save');
    expect(button.textContent).toBe('☆ Sauvegarder');
    expect(button.disabled).toBe(false);
  });

  it('ne touche pas au bouton si la liste active reste sauvegardée cette session (pas de clignotement)', async () => {
    state.savedListTokensThisSession.add('tok-1');
    document.getElementById('k-sc-snap-save').textContent = '✓ Sauvegardée';

    installSharedLibraryRemove();
    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(document.getElementById('k-sc-snap-save').textContent).toBe('✓ Sauvegardée');
  });

  it('fonctionne aussi avec la variante mobile #k-cart-snap-save quand #k-sc-snap-save est absent', async () => {
    document.body.innerHTML = `
      <div id="k-track-lists-panel-wrap"></div>
      <button id="k-cart-snap-save">✓ Sauvegardée</button>
    `;

    installSharedLibraryRemove();
    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();

    const button = document.getElementById('k-cart-snap-save');
    expect(button.textContent).toBe('☆ Sauvegarder');
  });
});
