'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * P2 (LOT 13) — group-library-remove.js::syncActiveListSaveButton() ciblait
 * document.getElementById('k-sc-snap-save' | 'k-cart-snap-save'), des ids
 * qui n'existent plus depuis la refonte du footer snapshot (LOT 13,
 * b-cart.js::snapCreateEl()) : les boutons Sauvegarder/Partager/Fermer sont
 * désormais jetables — reconstruits à chaque rendu, marqués uniquement
 * data-snapshot-button="1", sans id stable. Ce lookup par id retournait
 * donc de nouveau toujours null (même symptôme que le P1 d'origine, cause
 * différente) et la fonction ne faisait jamais rien. Ce test couvre le
 * contrat réel : le bouton (identifié par son marqueur + son texte, comme
 * b-cart.js le pose réellement — 'Sauvegarder' / '✓ Sauvegardée', jamais
 * '☆ Sauvegarder') doit repasser à "Sauvegarder" une fois la liste retirée
 * de "Mes listes".
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

function snapshotSaveButtonHtml(text) {
  // Reproduit exactement ce que pose b-cart.js::snapCreateEl() pour le
  // bouton Sauvegarder du footer snapshot (desktop ET mobile posent le
  // même marqueur, aucun id) : data-snapshot-button="1" + classe
  // k-snap-btn-secondary (drawer) ou k-snap-link (side cart).
  return `<button type="button" class="k-snap-btn-secondary" data-snapshot-button="1">${text}</button>`;
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = `
    <div id="k-track-lists-panel-wrap"></div>
    <div id="k-side-cart">${snapshotSaveButtonHtml('✓ Sauvegardée')}</div>
  `;
  state.libraryContext = { created: [], saved: [] };
  state.sharedListContext = { token: 'tok-1', sharedCartId: 'sc-1' };
  state.savedListTokensThisSession = new Set();
});

function findSaveButton() {
  return Array.from(document.querySelectorAll('[data-snapshot-button="1"]'))
    .find((el) => /^(Sauvegarder|✓ Sauvegardée)$/.test((el.textContent || '').trim()));
}

describe('group-library-remove — syncActiveListSaveButton (P2 fix, LOT 13)', () => {
  it('cible bien le bouton réel data-snapshot-button="1" (jamais un id, qui n\'existe plus depuis la refonte du footer)', async () => {
    installSharedLibraryRemove();
    // "tok-1" n'est ni dans la bibliothèque rechargée ni sauvegardée cette
    // session : le bouton doit repasser à l'état "à sauvegarder".
    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();

    const button = findSaveButton();
    expect(button.textContent).toBe('Sauvegarder');
    expect(button.disabled).toBe(false);
  });

  it('ne touche pas au bouton si la liste active reste sauvegardée cette session (pas de clignotement)', async () => {
    installSharedLibraryRemove();
    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();
    // État de départ (fixture "tok-1 pas encore sauvegardée") : le bouton
    // est corrigé à "Sauvegarder".
    expect(findSaveButton().textContent).toBe('Sauvegarder');

    // Simule l'état juste après un clic Sauvegarder réussi : le flag de
    // session est posé AVANT tout rechargement de la bibliothèque (V2-F),
    // et le bouton affiche déjà "✓ Sauvegardée" (posé par le handler de
    // clic lui-même, hors de ce module).
    state.savedListTokensThisSession.add('tok-1');
    findSaveButton().textContent = '✓ Sauvegardée';

    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(findSaveButton().textContent).toBe('✓ Sauvegardée');
  });

  it('fonctionne aussi dans le drawer mobile (même marqueur, aucun id distinct entre les deux surfaces)', async () => {
    document.body.innerHTML = `
      <div id="k-track-lists-panel-wrap"></div>
      <div id="k-cart-drawer">${snapshotSaveButtonHtml('✓ Sauvegardée')}</div>
    `;

    installSharedLibraryRemove();
    bus.emit('side-cart:render');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(findSaveButton().textContent).toBe('Sauvegarder');
  });
});
