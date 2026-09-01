'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const listeners = {};
const mockEmit = jest.fn();
const mockCloseModal = jest.fn();
const mockRequestDiscovery = jest.fn();

jest.mock('../../js/b-bus.js', () => ({
  bus: {
    on: jest.fn((event, handler) => { listeners[event] = handler; }),
    emit: mockEmit,
  },
}));

jest.mock('../../js/b-modal.js', () => ({ closeModal: mockCloseModal }));
jest.mock('../../js/discovery-actions.js', () => ({ requestDiscovery: mockRequestDiscovery }));
jest.mock('../../js/b-utils.js', () => ({
  sanitize: (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;'),
}));

const {
  setupDiscoveryModalDetail,
  renderDiscoveryModalDetail,
  clearDiscoveryModalDetail,
} = require('../../js/b-modal-discovery-detail.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="k-modal-discovery-detail" hidden></div>';
  mockEmit.mockClear();
  mockCloseModal.mockClear();
  mockRequestDiscovery.mockClear();
});

test('rend une offre physique dans le slot du shell modal canonique', () => {
  const rendered = renderDiscoveryModalDetail({
    kind: 'physical_offer',
    ref: 'offer-1',
    detail: {
      title: 'Samboussas au bœuf',
      provider_name: 'Saveurs d Anjouan',
      zone: 'Mutsamudu',
      description: 'Préparés sur commande',
      image_ref: '/images/samboussas.webp',
    },
  });

  const slot = document.getElementById('k-modal-discovery-detail');
  expect(rendered).toBe(true);
  expect(slot.hidden).toBe(false);
  expect(slot.dataset.discoveryKind).toBe('physical_offer');
  expect(slot.textContent).toContain('Samboussas au bœuf');
  expect(slot.textContent).toContain('Saveurs d Anjouan');
  expect(slot.textContent).toContain('Commander');
  expect(slot.querySelector('[data-discovery-ref="offer-1"]')).not.toBeNull();
});

test('le CTA poursuit le parcours Komerce via Inquiry après fermeture contrôlée du même modal', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'service',
    ref: 'svc-1',
    detail: { title: 'Installation climatiseur', zone: 'Mutsamudu' },
  });

  document.querySelector('[data-discovery-modal-action="service"]').click();

  expect(mockCloseModal).toHaveBeenCalledWith({ skipHistoryBack: true });
  expect(mockRequestDiscovery).toHaveBeenCalledWith(
    'service',
    'svc-1',
    expect.any(HTMLElement),
  );
  expect(mockEmit).not.toHaveBeenCalledWith('discovery:request', expect.anything());
});

test('modal:closed purge le contenu Discovery sans toucher au shell', () => {
  renderDiscoveryModalDetail({
    kind: 'service',
    ref: 'svc-2',
    detail: { title: 'Plomberie maison' },
  });
  clearDiscoveryModalDetail();
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.hidden).toBe(true);
  expect(slot.innerHTML).toBe('');
});

test('contrat U1 : aucun second renderer/overlay Discovery ne subsiste', () => {
  const root = path.join(__dirname, '../..');
  const rail = fs.readFileSync(path.join(root, 'js/discovery-rail.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'js/b-modal-core.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  expect(rail).not.toMatch(/render-discovery-detail/);
  expect(rail).toMatch(/openModal\(ref, \{ kind, detail \}\)/);
  expect(core).toMatch(/modal:discovery-opened/);
  expect((html.match(/id="k-modal-overlay"/g) || [])).toHaveLength(1);
  expect(html).toMatch(/id="k-modal-discovery-detail"/);
});
