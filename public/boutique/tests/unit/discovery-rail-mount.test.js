'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Contrat V2.9 : chaque page catégorie mobile est un contexte complet.
 * « Disponible ici » est son premier contenu quand un sous-pool local existe,
 * puis vient le catalogue. Une catégorie sans local conserve un shell caché
 * sans slot visuel. Un seul fetch backend alimente toutes les pages.
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

test('mobile: Disponible ici suit chaque page, inclut Soldes, reste silencieux si vide et survit au re-render', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  document.body.innerHTML = `
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
  expect(document.getElementById('k-home-search-launcher')).toBeNull();
  expect(document.querySelector('#k-page-scroll > #k-discovery-local')).toBeNull();

  const allShell = shellFor('all');
  const soldesShell = shellFor('Soldes');
  const techShell = shellFor('Tech');
  const maisonShell = shellFor('Maison');
  const modeShell = shellFor('Mode');

  expect(allShell).not.toBeNull();
  expect(allShell.parentElement.firstElementChild).toBe(allShell);
  expect(allShell.hidden).toBe(false);
  expect(allShell.textContent).toContain('Disponible ici');
  expect(allShell.textContent).toContain('Climatiseur local');
  expect(allShell.textContent).toContain('Ventilateur local en solde');
  expect(allShell.textContent).toContain('Ciment local');
  expect(allShell.textContent).toContain('Installation clim');

  expect(soldesShell.parentElement.firstElementChild).toBe(soldesShell);
  expect(soldesShell.hidden).toBe(false);
  expect(soldesShell.textContent).toContain('Disponible ici');
  expect(soldesShell.textContent).toContain('Ventilateur local en solde');
  expect(soldesShell.textContent).not.toContain('Climatiseur local');
  expect(soldesShell.textContent).not.toContain('Ciment local');

  expect(techShell.parentElement.firstElementChild).toBe(techShell);
  expect(techShell.hidden).toBe(false);
  expect(techShell.textContent).toContain('Climatiseur local');
  expect(techShell.textContent).toContain('Ventilateur local en solde');
  expect(techShell.textContent).toContain('Installation clim');
  expect(techShell.textContent).not.toContain('Ciment local');

  expect(maisonShell.parentElement.firstElementChild).toBe(maisonShell);
  expect(maisonShell.hidden).toBe(false);
  expect(maisonShell.textContent).toContain('Ciment local');
  expect(maisonShell.textContent).not.toContain('Climatiseur local');

  expect(modeShell.parentElement.firstElementChild).toBe(modeShell);
  expect(modeShell.hidden).toBe(true);
  expect(modeShell.innerHTML).toBe('');

  const titleIds = Array.from(document.querySelectorAll('.k-discovery-title[id]')).map(el => el.id);
  expect(new Set(titleIds).size).toBe(titleIds.length);

  // renderGrid() remplace toutes les pages. Les shells sont recréés depuis le
  // cache Discovery, sans refaire de fetch.
  const grid = document.getElementById('k-grid');
  grid.innerHTML = mobileCatalogMarkup('rerender');
  await flushDomWork();

  const rerenderedAll = document.querySelector('#k-grid > .k-cat-section[data-cat="all"]');
  expect(rerenderedAll.dataset.render).toBe('rerender');
  expect(rerenderedAll.firstElementChild).toBe(shellFor('all'));
  expect(shellFor('Soldes').textContent).toContain('Ventilateur local en solde');
  expect(shellFor('Tech').textContent).toContain('Installation clim');
  expect(shellFor('Mode').hidden).toBe(true);
  expect(mockFetchDiscoveryRail).toHaveBeenCalledTimes(1);

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  window.dispatchEvent(new Event('resize'));
  await flushDomWork();

  const catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  const desktopShell = document.getElementById('k-discovery-local');
  expect(desktopShell).not.toBeNull();
  expect(catalogWrap.previousElementSibling).toBe(desktopShell);
  expect(desktopShell.parentElement).toBe(document.getElementById('k-page-scroll'));
  expect(desktopShell.textContent).toContain('Disponible ici');
  expect(document.querySelector('.k-discovery-shell[data-discovery-category]')).toBeNull();
});
