'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/b-modal.js', () => ({ openModal: jest.fn() }));
jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: jest.fn(),
  fetchServiceCard: jest.fn(),
  fetchPhysicalOfferCard: jest.fn(),
}));

const { fetchDiscoveryRail } = require('../../js/discovery-api.js');
const { ensureMount, setupDiscoveryRail } = require('../../js/discovery-rail.js');

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function renderShellDom({ withMobilePage = true } = {}) {
  document.body.innerHTML = `
    <div id="k-page-scroll">
      <div id="k-desktop-catalog-wrap">
        <section id="k-catalog-section">
          <div id="k-grid">
            ${withMobilePage ? '<div class="k-cat-section" data-cat="all"><div class="k-sec-header">Tout</div></div>' : ''}
          </div>
        </section>
      </div>
    </div>`;
}

beforeEach(() => {
  renderShellDom();
  setViewport(390);
});

describe('Discovery rail mount — contrat du scroll Temu', () => {
  it('monte Discovery dans la vraie page Tout sur mobile', () => {
    const shell = ensureMount();
    const allPage = document.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');

    expect(shell).not.toBeNull();
    expect(shell.parentElement).toBe(allPage);
    expect(allPage.firstElementChild).toBe(shell);
    expect(shell.dataset.pagerStatic).toBe('true');
  });

  it('ne monte rien hors du scroll owner quand la page Tout mobile manque', () => {
    renderShellDom({ withMobilePage: false });

    expect(ensureMount()).toBeNull();
    expect(document.getElementById('k-discovery-local')).toBeNull();
  });

  it('conserve le montage avant le catalogue sur desktop', () => {
    setViewport(1280);
    const catalog = document.getElementById('k-desktop-catalog-wrap');
    const shell = ensureMount();

    expect(shell.nextElementSibling).toBe(catalog);
    expect(shell.parentElement).toBe(document.getElementById('k-page-scroll'));
  });

  it('déplace le même shell du desktop vers le scroll owner mobile', () => {
    setViewport(1280);
    const desktopShell = ensureMount();
    setViewport(390);
    const mobileShell = ensureMount();

    expect(mobileShell).toBe(desktopShell);
    expect(mobileShell.parentElement).toBe(
      document.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])'),
    );
    expect(document.querySelectorAll('#k-discovery-local')).toHaveLength(1);
  });

  it('remonte le rail rendu après remplacement des pages et changement de viewport', async () => {
    fetchDiscoveryRail.mockResolvedValue({
      cards: [{
        kind: 'service',
        title: 'Plomberie maison',
        subtitle: 'Sur demande',
        cta_action_ref: 'service-1',
        cta_label: 'Demander',
      }],
    });
    window.KomerceMarket = { get: () => ({ gentile_short: 'Comores' }) };

    setupDiscoveryRail();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelectorAll('#k-discovery-local .k-discovery-card')).toHaveLength(1);

    const grid = document.getElementById('k-grid');
    grid.innerHTML = '<div class="k-cat-section" data-cat="all"><div class="k-sec-header">Tout neuf</div></div>';
    await new Promise(resolve => setTimeout(resolve, 30));

    const remounted = document.getElementById('k-discovery-local');
    expect(remounted.parentElement).toBe(grid.firstElementChild);
    expect(remounted.textContent).toContain('Plomberie maison');

    setViewport(1280);
    window.dispatchEvent(new Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(remounted.nextElementSibling).toBe(document.getElementById('k-desktop-catalog-wrap'));
    expect(document.querySelectorAll('#k-discovery-local')).toHaveLength(1);
  });
});
