'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockOpenModal = jest.fn();
const mockRequestDiscovery = jest.fn();
const mockFetchDiscoveryRail = jest.fn();
const mockFetchServiceCard = jest.fn();
const mockFetchPhysicalOfferCard = jest.fn();
const mockRenderDiscoveryRail = jest.fn();

jest.mock('../../js/b-modal.js', () => ({ openModal: mockOpenModal }));
jest.mock('../../js/discovery-actions.js', () => ({ requestDiscovery: mockRequestDiscovery }));
jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: mockFetchDiscoveryRail,
  fetchServiceCard: mockFetchServiceCard,
  fetchPhysicalOfferCard: mockFetchPhysicalOfferCard,
}));
jest.mock('../../js/render/render-discovery-rail.js', () => ({
  renderDiscoveryRail: mockRenderDiscoveryRail,
}));

const { setupDiscoveryRail } = require('../../js/discovery-rail.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="k-desktop-catalog-wrap"></div>';
  mockOpenModal.mockClear();
  mockRequestDiscovery.mockClear();
  mockFetchDiscoveryRail.mockReset().mockResolvedValue({ cards: [] });
  mockFetchServiceCard.mockReset();
  mockFetchPhysicalOfferCard.mockReset();
  mockRenderDiscoveryRail.mockReset().mockReturnValue(0);
});

test('clic carte service ouvre le shell modal Komerce avec le detail récupéré', async () => {
  setupDiscoveryRail();
  const shell = document.getElementById('k-discovery-local');
  shell.innerHTML = '<article class="k-discovery-card" data-discovery-kind="service" data-discovery-ref="svc-1"><span>Service</span></article>';
  mockFetchServiceCard.mockResolvedValue({ title: 'Installation climatiseur', zone: 'Mutsamudu' });

  shell.querySelector('.k-discovery-card').click();
  await Promise.resolve();
  await Promise.resolve();

  expect(mockFetchServiceCard).toHaveBeenCalledWith('svc-1');
  expect(mockOpenModal).toHaveBeenCalledWith('svc-1', {
    kind: 'service',
    detail: { title: 'Installation climatiseur', zone: 'Mutsamudu' },
  });
});

test('clic CTA service agit directement sans ouvrir la fiche', () => {
  const shell = document.getElementById('k-discovery-local') || document.body.appendChild(Object.assign(document.createElement('section'), { id: 'k-discovery-local' }));
  shell.innerHTML = '<button data-discovery-action="service" data-discovery-ref="svc-2">Demander</button>';
  shell.querySelector('button').click();

  expect(mockRequestDiscovery).toHaveBeenCalledWith('service', 'svc-2', expect.any(HTMLButtonElement));
  expect(mockOpenModal).not.toHaveBeenCalled();
});
