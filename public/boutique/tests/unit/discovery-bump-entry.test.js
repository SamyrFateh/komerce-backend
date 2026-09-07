'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/b-modal.js', () => ({ openModal: jest.fn() }));
jest.mock('../../js/b-pager.js', () => ({ _setupInfiniteLoop: jest.fn() }));

const mockFetchDiscoveryRail = jest.fn(async () => ({
  cards: [
    {
      kind: 'product',
      title: 'Casque Tech local',
      subtitle: 'Disponible maintenant',
      cta_action_ref: 'p-tech',
      cta_label: 'Acheter',
      image_ref: 'https://example.test/tech.webp',
      category_keys: ['Tech'],
    },
    {
      kind: 'service',
      title: 'Installation clim',
      subtitle: 'Sur demande',
      cta_action_ref: 's-tech',
      cta_label: 'Demander',
      category_keys: ['Tech', 'Bricolage'],
    },
    {
      kind: 'product',
      title: 'Produit Maison local',
      subtitle: 'Disponible maintenant',
      cta_action_ref: 'p-maison',
      cta_label: 'Acheter',
      category_keys: ['Maison'],
    },
  ],
}));

jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: (...args) => mockFetchDiscoveryRail(...args),
  fetchServiceCard: jest.fn(),
  fetchPhysicalOfferCard: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { PAGER_BUMP_EVENT } = require('../../js/b-pager-end-bounce.js');
const { setupDiscoveryRail } = require('../../js/discovery-rail.js');

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

function shellFor(cat) {
  return document.querySelector(
    `.k-cat-section[data-cat="${cat}"] > .k-discovery-shell[data-discovery-category="${cat}"]`
  );
}

test('mobile: bump montre le sous-pool local, puis tap/swipe rend la catégorie pure', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  document.body.innerHTML = `
    <div id="k-cats">
      <button class="k-chip active" data-cat="all">Tout</button>
      <button class="k-chip" data-cat="Tech">Tech</button>
      <button class="k-chip" data-cat="Maison">Maison</button>
    </div>
    <div id="k-page-scroll" class="k-pager-active">
      <div id="k-desktop-catalog-wrap">
        <section id="k-catalog-section">
          <div id="k-grid" class="k-grid-cat-pager">
            <section class="k-cat-section" data-cat="all"><div class="k-sec-grid"></div></section>
            <section class="k-cat-section" data-cat="Tech"><div class="k-sec-grid"></div></section>
            <section class="k-cat-section" data-cat="Maison"><div class="k-sec-grid"></div></section>
          </div>
        </section>
      </div>
    </div>`;

  setupDiscoveryRail();
  await flush();

  expect(mockFetchDiscoveryRail).toHaveBeenCalledTimes(1);
  expect(shellFor('all')).not.toBeNull();
  expect(shellFor('Tech')).toBeNull();
  expect(shellFor('Maison')).toBeNull();

  // Descente + bump : Tech devient une vraie entrée locale de tête de page.
  window.dispatchEvent(new CustomEvent(PAGER_BUMP_EVENT, {
    detail: { from: 'all', to: 'Tech' },
  }));
  const techChip = document.querySelector('.k-chip[data-cat="Tech"]');
  bus.emit('chip:center', techChip);

  const techShell = shellFor('Tech');
  expect(techShell).not.toBeNull();
  expect(techShell.dataset.discoveryEntry).toBe('bump');
  expect(techShell.parentElement.firstElementChild).toBe(techShell);
  expect(techShell.textContent).toContain('Disponible ici');
  expect(techShell.textContent).toContain('Casque Tech local');
  expect(techShell.textContent).toContain('Installation clim');
  expect(techShell.textContent).not.toContain('Produit Maison local');

  // Un second centrage sans intention de bump représente tap/swipe/restauration :
  // le rail transitoire disparaît et l'onglet redevient catalogue pur.
  bus.emit('chip:center', techChip);
  expect(shellFor('Tech')).toBeNull();
  expect(shellFor('all')).not.toBeNull();

  // Un autre bump reconstruit le bon sous-pool sans aucun refetch backend.
  window.dispatchEvent(new CustomEvent(PAGER_BUMP_EVENT, {
    detail: { from: 'Tech', to: 'Maison' },
  }));
  const maisonChip = document.querySelector('.k-chip[data-cat="Maison"]');
  bus.emit('chip:center', maisonChip);
  expect(shellFor('Maison').textContent).toContain('Produit Maison local');
  expect(shellFor('Maison').textContent).not.toContain('Casque Tech local');
  expect(mockFetchDiscoveryRail).toHaveBeenCalledTimes(1);
});
