'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Régression 2026-09-02 : le bloc « Près de vous » était monté comme sibling
 * du catalogue dans #k-page-scroll. En mode pager mobile, ce parent est une
 * cage fixed + overflow:hidden : le bloc vertical consommait la hauteur de la
 * cage sans posséder de scroll, jusqu'à étouffer le pager Temu.
 *
 * V2.8 : la page Tout porte désormais, dans cet ordre, le launcher de
 * recherche puis Discovery puis le catalogue. Les deux mounts doivent survivre
 * aux remplacements de pages effectués par renderGrid().
 */

jest.mock('../../js/b-modal.js', () => ({
  openModal: jest.fn(),
}));

jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: jest.fn(async () => ({
    cards: [
      {
        kind: 'product',
        title: 'Climatiseur local',
        subtitle: 'Disponible maintenant',
        cta_action_ref: 'p-1',
        cta_label: 'Acheter',
      },
    ],
  })),
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

test('mobile: recherche puis Discovery vivent dans Tout, survivent au re-render, puis Discovery revient avant le catalogue desktop', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  document.body.innerHTML = `
    <header><div class="k-search"><input id="k-search-input" type="search"></div></header>
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

  let shell = document.getElementById('k-discovery-local');
  let launcher = document.getElementById('k-home-search-launcher');
  let allPage = document.querySelector('#k-grid > .k-cat-section[data-cat="all"]');

  expect(launcher).not.toBeNull();
  expect(shell).not.toBeNull();
  expect(launcher.parentElement).toBe(allPage);
  expect(shell.parentElement).toBe(allPage);
  expect(allPage.firstElementChild).toBe(launcher);
  expect(launcher.nextElementSibling).toBe(shell);
  expect(document.querySelector('#k-page-scroll > #k-discovery-local')).toBeNull();
  expect(shell.hidden).toBe(false);
  expect(shell.textContent).toContain('Près de vous');
  expect(shell.textContent).toContain('Climatiseur local');

  launcher.click();
  expect(document.activeElement).toBe(document.getElementById('k-search-input'));

  // renderGrid() remplace les pages : le MutationObserver doit remonter
  // recherche + Discovery dans la nouvelle page Tout sans refaire de fetch.
  const grid = document.getElementById('k-grid');
  grid.innerHTML = mobileCatalogMarkup('rerender');
  await flushDomWork();

  shell = document.getElementById('k-discovery-local');
  launcher = document.getElementById('k-home-search-launcher');
  allPage = document.querySelector('#k-grid > .k-cat-section[data-cat="all"]');
  expect(allPage.dataset.render).toBe('rerender');
  expect(allPage.firstElementChild).toBe(launcher);
  expect(launcher.nextElementSibling).toBe(shell);
  expect(shell.textContent).toContain('Climatiseur local');

  // Desktop conserve la composition validée : Discovery redevient sibling
  // immédiatement avant #k-desktop-catalog-wrap. Le launcher mobile disparaît
  // avec la prochaine reconstruction de la home et n'est jamais monté desktop.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  window.dispatchEvent(new Event('resize'));
  await flushDomWork();

  const catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  shell = document.getElementById('k-discovery-local');
  expect(catalogWrap.previousElementSibling).toBe(shell);
  expect(shell.parentElement).toBe(document.getElementById('k-page-scroll'));
});
