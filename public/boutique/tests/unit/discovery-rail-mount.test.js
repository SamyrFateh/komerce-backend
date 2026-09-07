'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Contrat HOME : « Disponible ici » appartient uniquement à l'accueil Tout.
 * Les onglets catégorie restent des surfaces catalogue pures, sur mobile comme
 * sur desktop. Un seul fetch backend alimente la surface quand elle est montée.
 */

jest.mock('../../js/b-modal.js', () => ({
  openModal: jest.fn(),
}));

const mockSetupInfiniteLoop = jest.fn();
jest.mock('../../js/b-pager.js', () => ({
  _setupInfiniteLoop: mockSetupInfiniteLoop,
}));

const mockFetchDiscoveryRail = jest.fn(async () => ({
  cards: [
    {
      kind: 'product',
      title: 'Climatiseur local',
      subtitle: 'Disponible maintenant',
      cta_action_ref: 'p-tech',
      cta_label: 'Acheter',
      category_keys: ['Tech'],
    },
    {
      kind: 'product',
      title: 'Ventilateur local en solde',
      subtitle: 'Disponible maintenant',
      cta_action_ref: 'p-soldes',
      cta_label: 'Acheter',
      category_keys: ['Tech', 'Soldes'],
    },
    {
      kind: 'physical_offer',
      title: 'Ciment local',
      subtitle: 'Préparation sur commande',
      cta_action_ref: 'o-maison',
      cta_label: 'Commander',
      category_keys: ['Maison', 'Bricolage'],
    },
    {
      kind: 'service',
      title: 'Installation clim',
      subtitle: 'Sur demande',
      cta_action_ref: 's-tech',
      cta_label: 'Demander',
      category_keys: ['Tech', 'Bricolage'],
    },
  ],
}));

jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: (...args) => mockFetchDiscoveryRail(...args),
  fetchServiceCard: jest.fn(),
  fetchPhysicalOfferCard: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { setupDiscoveryRail } = require('../../js/discovery-rail.js');

function mobileCatalogMarkup(label = 'initial') {
  return `
    <div class="k-cat-section" data-cat="all" data-render="${label}">
      <div class="k-sec-header" data-cat="all"><span>Tout</span></div>
      <div class="k-sec-grid"></div>
    </div>
    <div class="k-cat-section" data-cat="Soldes">
      <div class="k-sec-header" data-cat="Soldes"><span>Soldes</span></div>
      <div class="k-sec-grid"></div>
    </div>
    <div class="k-cat-section" data-cat="Tech">
      <div class="k-sec-header" data-cat="Tech"><span>Tech</span></div>
      <div class="k-sec-grid"></div>
    </div>
    <div class="k-cat-section" data-cat="Maison">
      <div class="k-sec-header" data-cat="Maison"><span>Maison</span></div>
      <div class="k-sec-grid"></div>
    </div>
    <div class="k-cat-section" data-cat="Mode">
      <div class="k-sec-header" data-cat="Mode"><span>Mode</span></div>
      <div class="k-sec-grid"></div>
    </div>`;
}

async function flushDomWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

function shellFor(cat) {
  return document.querySelector(
    `.k-cat-section[data-cat="${cat}"] > .k-discovery-shell[data-discovery-category="${cat}"]`
  );
}

test('mobile + desktop: Disponible ici reste sur Tout uniquement et garde un seul fetch', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  document.body.innerHTML = `
    <div class="k-chip active" data-cat="all"></div>
    <div class="k-chip" data-cat="Soldes"></div>
    <div class="k-chip" data-cat="Tech"></div>
    <div class="k-chip" data-cat="Maison"></div>
    <div class="k-chip" data-cat="Mode"></div>
    <div id="k-page-scroll" class="k-pager-active">
      <div id="k-desktop-catalog-wrap">
        <section id="k-catalog-section">
          <div id="k-grid" class="k-grid-cat-pager">
            ${mobileCatalogMarkup()}
          </div>
        </section>
      </div>
    </div>`;

  setupDiscoveryRail();
  await flushDomWork();

  expect(mockFetchDiscoveryRail).toHaveBeenCalledTimes(1);
  expect(mockSetupInfiniteLoop).toHaveBeenCalled();
  expect(document.querySelector('#k-page-scroll > #k-discovery-local')).toBeNull();

  const allShell = shellFor('all');
  expect(allShell).not.toBeNull();
  expect(allShell.parentElement.firstElementChild).toBe(allShell);
  expect(allShell.hidden).toBe(false);
  expect(allShell.textContent).toContain('Disponible ici');
  expect(allShell.textContent).toContain('Climatiseur local');
  expect(allShell.textContent).toContain('Ventilateur local en solde');
  expect(allShell.textContent).toContain('Ciment local');
  expect(allShell.textContent).toContain('Installation clim');

  // Aucun onglet catégorie ne possède de rail local.
  expect(shellFor('Soldes')).toBeNull();
  expect(shellFor('Tech')).toBeNull();
  expect(shellFor('Maison')).toBeNull();
  expect(shellFor('Mode')).toBeNull();

  // Un rerender du pager remonte uniquement la surface Tout, sans refetch.
  const grid = document.getElementById('k-grid');
  grid.innerHTML = mobileCatalogMarkup('rerender');
  await flushDomWork();

  const rerenderedAll = document.querySelector('#k-grid > .k-cat-section[data-cat="all"]');
  expect(rerenderedAll.dataset.render).toBe('rerender');
  expect(rerenderedAll.firstElementChild).toBe(shellFor('all'));
  expect(shellFor('Soldes')).toBeNull();
  expect(shellFor('Tech')).toBeNull();
  expect(mockFetchDiscoveryRail).toHaveBeenCalledTimes(1);

  // Desktop sur Tout : rail visible avant le catalogue.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  window.dispatchEvent(new Event('resize'));
  await flushDomWork();

  const catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  let desktopShell = document.getElementById('k-discovery-local');
  expect(desktopShell).not.toBeNull();
  expect(catalogWrap.previousElementSibling).toBe(desktopShell);
  expect(desktopShell.textContent).toContain('Climatiseur local');
  expect(desktopShell.textContent).toContain('Ciment local');
  expect(document.querySelector('.k-discovery-shell[data-discovery-category]')).toBeNull();

  // Tout autre onglet retire réellement le shell au lieu de le filtrer.
  bus.emit('catalog:cat-changed', 'Soldes');
  await flushDomWork();
  expect(document.getElementById('k-discovery-local')).toBeNull();

  bus.emit('catalog:cat-changed', 'Tech');
  await flushDomWork();
  expect(document.getElementById('k-discovery-local')).toBeNull();

  bus.emit('catalog:cat-changed', 'Maison');
  await flushDomWork();
  expect(document.getElementById('k-discovery-local')).toBeNull();

  // Retour sur Tout : le rail est recréé depuis le cache local, sans refetch.
  bus.emit('catalog:cat-changed', 'all');
  await flushDomWork();
  desktopShell = document.getElementById('k-discovery-local');
  expect(desktopShell).not.toBeNull();
  expect(catalogWrap.previousElementSibling).toBe(desktopShell);
  expect(desktopShell.textContent).toContain('Ventilateur local en solde');
  expect(mockFetchDiscoveryRail).toHaveBeenCalledTimes(1);
});
