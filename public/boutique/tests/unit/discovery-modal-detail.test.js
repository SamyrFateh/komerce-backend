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
  kindLabelFor,
  normalizeActions,
  actionLabelFor,
  telHref,
  whatsappHref,
} = require('../../js/b-modal-discovery-detail.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="k-modal-discovery-detail" hidden></div>';
  mockEmit.mockClear();
  mockCloseModal.mockClear();
  mockRequestDiscovery.mockClear();
});

test('rend une offre physique legacy avec le parcours Commander historique', () => {
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
  expect(slot.textContent).toContain('Produit local');
  expect(slot.textContent).toContain('Préparation sur commande');
  expect(slot.textContent).toContain('Samboussas au bœuf');
  expect(slot.textContent).toContain('Saveurs d Anjouan');
  expect(slot.textContent).toContain('Mutsamudu');
  expect(slot.textContent).toContain('Préparés sur commande');
  expect(slot.querySelector('.k-modal-discovery-img')?.getAttribute('src')).toBe('/images/samboussas.webp');
  expect(slot.textContent).toContain('Pour quand ?');
  expect(slot.textContent).toContain('facultatif');
  expect(slot.textContent).toContain('Commander');
  const input = slot.querySelector('[data-discovery-requested-window]');
  expect(input).not.toBeNull();
  expect(input.maxLength).toBe(160);
  expect(input.placeholder).toBe('Ex. vendredi soir');
  expect(slot.querySelector('[data-discovery-modal-action="request"][data-discovery-ref="offer-1"]')).not.toBeNull();
});

test('service local utilise un wording intervention sans créer de scheduler', () => {
  renderDiscoveryModalDetail({
    kind: 'service',
    ref: 'svc-label',
    detail: {
      title: 'Installation climatiseur',
      provider_name: 'Atelier Mutsamudu',
      zone: 'Mutsamudu',
      description: 'Pose et mise en service',
    },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.textContent).toContain('Service local');
  expect(slot.textContent).toContain('Sur demande');
  expect(slot.textContent).toContain('Atelier Mutsamudu');
  expect(slot.textContent).toContain('Pose et mise en service');
  expect(slot.textContent).toContain('Quand souhaitez-vous l’intervention ?');
  expect(slot.querySelector('[data-discovery-requested-window]').placeholder).toBe('Ex. samedi matin');
});

test('une fiche peut cumuler rappel, appel et WhatsApp sans exposer le téléphone privé', () => {
  renderDiscoveryModalDetail({
    kind: 'service',
    ref: 'svc-moto',
    detail: {
      title: 'Réparation moto',
      actions: ['callback', 'call', 'whatsapp'],
      public_contact: {
        phone: '+269 321 00 00',
        whatsapp: '00269 321 00 01',
      },
    },
  });

  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.textContent).toContain('Être rappelé');
  expect(slot.textContent).toContain('Appeler');
  expect(slot.textContent).toContain('WhatsApp');
  expect(slot.querySelector('[data-discovery-modal-action="callback"]')).not.toBeNull();
  expect(slot.querySelector('[data-discovery-direct-action="call"]')?.getAttribute('href')).toBe('tel:+2693210000');
  expect(slot.querySelector('[data-discovery-direct-action="whatsapp"]')?.getAttribute('href')).toBe('https://wa.me/2693210001');
  expect(slot.textContent).not.toContain('+269 321 00 00');
});

test('une action directe sans coordonnée publique explicite est supprimée, jamais remplacée par un téléphone privé', () => {
  expect(normalizeActions({ actions: ['call', 'whatsapp'], public_contact: null })).toEqual([]);
  renderDiscoveryModalDetail({
    kind: 'service',
    ref: 'svc-no-contact',
    detail: { title: 'Diagnostic', actions: ['call'] },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.textContent).toContain('Contact momentanément indisponible');
  expect(slot.querySelector('a[href^="tel:"]')).toBeNull();
  expect(slot.querySelector('[data-discovery-requested-window]')).toBeNull();
});

test('labels et liens métier restent des projections déterministes', () => {
  expect(kindLabelFor('physical_offer')).toBe('Produit local');
  expect(kindLabelFor('service')).toBe('Service local');
  expect(actionLabelFor('request', 'physical_offer')).toBe('Commander');
  expect(actionLabelFor('request', 'service')).toBe('Demander');
  expect(actionLabelFor('quote', 'service')).toBe('Demander un devis');
  expect(actionLabelFor('callback', 'service')).toBe('Être rappelé');
  expect(telHref('+269 321-00-00')).toBe('tel:+2693210000');
  expect(whatsappHref('00 269 321 00 01')).toBe('https://wa.me/2693210001');
});

test('le CTA Inquiry transporte la précision et son intention après fermeture contrôlée du même modal', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'service',
    ref: 'svc-1',
    detail: { title: 'Installation climatiseur', zone: 'Mutsamudu', actions: ['callback'] },
  });

  document.querySelector('[data-discovery-requested-window]').value = '  Samedi matin  ';
  document.querySelector('[data-discovery-modal-action="callback"]').click();

  expect(mockCloseModal).toHaveBeenCalledWith({ skipHistoryBack: true });
  expect(mockRequestDiscovery).toHaveBeenCalledWith(
    'service',
    'svc-1',
    expect.any(HTMLElement),
    'Samedi matin',
    'callback',
  );
  expect(mockEmit).not.toHaveBeenCalledWith('discovery:request', expect.anything());
});

test('un lien direct ferme le cycle modal sans créer d Inquiry', () => {
  setupDiscoveryModalDetail();
  renderDiscoveryModalDetail({
    kind: 'service',
    ref: 'svc-call',
    detail: {
      title: 'Dépannage',
      actions: ['call'],
      public_contact: { phone: '+2693210000' },
    },
  });

  document.querySelector('[data-discovery-direct-action="call"]').click();
  expect(mockCloseModal).toHaveBeenCalledWith({ skipHistoryBack: true });
  expect(mockRequestDiscovery).not.toHaveBeenCalled();
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

test('contrat Discovery : un seul shell et aucune mutation métier directe depuis le rail', () => {
  const root = path.join(__dirname, '../..');
  const rail = fs.readFileSync(path.join(root, 'js/discovery-rail.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'js/b-modal-core.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  expect(rail).not.toMatch(/render-discovery-detail/);
  expect(rail).not.toMatch(/requestDiscovery/);
  expect(rail).toMatch(/async function openDiscoveryDetail\(kind, ref\)/);
  expect(rail).toMatch(/openDiscoveryDetail\(kind, ref\)/);
  expect(rail).toMatch(/openModal\(ref, \{ kind, detail \}\)/);
  expect(core).toMatch(/modal:discovery-opened/);
  expect((html.match(/id="k-modal-overlay"/g) || [])).toHaveLength(1);
  expect(html).toMatch(/id="k-modal-discovery-detail"/);
});
