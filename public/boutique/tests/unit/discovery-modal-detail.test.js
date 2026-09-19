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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
}));

const {
  setupDiscoveryModalDetail,
  renderDiscoveryModalDetail,
  clearDiscoveryModalDetail,
  kindLabelFor,
  normalizeActions,
  actionLabelFor,
  subjectFor,
  publicActionFor,
} = require('../../js/b-modal-discovery-detail.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="k-modal-discovery-detail" hidden></div>';
  mockEmit.mockClear();
  mockCloseModal.mockClear();
  mockRequestDiscovery.mockClear();
});

test('offre locale expose Demander + Être rappelé et garde le sujet connu', () => {
  const rendered = renderDiscoveryModalDetail({
    kind: 'physical_offer', ref: 'offer-cement',
    detail: {
      title: 'Ciment 42,5R — sac 50 kg', provider_name: 'Bâtir Anjouan', zone: 'Mutsamudu',
      description: 'Stock local indicatif.', image_ref: '/images/ciment.webp', actions: ['request', 'callback'],
    },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(rendered).toBe(true);
  expect(slot.textContent).toContain('Offre locale');
  expect(slot.textContent).toContain('Disponible ici');
  expect(slot.textContent).toContain('Demander cette offre');
  expect(slot.textContent).toContain('Être rappelé');
  expect(slot.querySelector('[data-discovery-action-form="request"]').hidden).toBe(true);
  expect(slot.querySelector('[data-discovery-action-form="callback"]').hidden).toBe(true);
  expect(slot.textContent).toContain('Ciment 42,5R — sac 50 kg · Bâtir Anjouan');
});

test('service sans WhatsApp montre un seul bouton et transmet le besoin facultatif', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'service', ref: 'svc-auto',
    detail: {
      title: 'Recherche et sourcing de pièces auto', provider_name: 'Atelier Mutsamudu',
      zone: 'Mutsamudu / Anjouan', description: 'Indiquez marque, modèle, année et pièce recherchée.',
      actions: ['request', 'callback'], whatsapp_available: false,
    },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.querySelector('.k-service-detail-shell')).not.toBeNull();
  expect(slot.textContent).toContain('Comment ça marche ?');
  expect(slot.textContent).toContain('Le prestataire vous répond');
  expect(slot.querySelectorAll('.k-service-detail-shell button')).toHaveLength(1);
  expect(slot.querySelector('[data-discovery-select-action]')).toBeNull();
  const contact = slot.querySelector('[data-discovery-service-contact]');
  expect(contact.textContent).toContain('Contacter le prestataire');
  expect(contact.hasAttribute('data-discovery-handoff')).toBe(false);
  expect(slot.textContent).not.toContain('Être rappelé');

  slot.querySelector('[data-discovery-service-note]').value = '  Phare avant droit Toyota Hilux  ';
  contact.click();
  expect(mockCloseModal).toHaveBeenCalledWith({ skipHistoryBack: true });
  expect(mockRequestDiscovery).toHaveBeenCalledWith(
    'service', 'svc-auto', expect.any(HTMLElement), null, 'request', 'Phare avant droit Toyota Hilux', null
  );
});

test('service WhatsApp conserve un seul CTA et crée une Inquiry avant le handoff', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'service', ref: 'svc-plomberie',
    detail: {
      title: 'Plomberie maison', provider_name: 'Dépannage Anjouan', zone: 'Mutsamudu',
      description: 'Diagnostic et dépannage.', actions: ['callback'], whatsapp_available: true,
    },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  const contact = slot.querySelector('[data-discovery-service-contact]');
  expect(slot.querySelectorAll('.k-service-detail-shell button')).toHaveLength(1);
  expect(contact.dataset.discoveryHandoff).toBe('whatsapp');
  expect(slot.textContent).toContain('Contacter le prestataire');
  expect(slot.textContent).toContain('Discutez avec le prestataire');
  expect(slot.textContent).not.toContain('Être rappelé');
  expect(slot.textContent).not.toContain('Ajouter au panier');
  expect(slot.textContent).not.toContain('Acheter maintenant');
  slot.querySelector('[data-discovery-service-note]').value = '  Fuite sous évier  ';
  contact.click();
  expect(mockRequestDiscovery).toHaveBeenCalledWith(
    'service', 'svc-plomberie', expect.any(HTMLElement), null, 'request', 'Fuite sous évier', 'whatsapp'
  );
});

test('service avec contact indisponible ne crée aucune demande', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'service', ref: 'svc-off',
    detail: { title: 'Plomberie maison', actions: [], whatsapp_available: false },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.textContent).toContain('Contact momentanément indisponible');
  expect(slot.querySelector('[data-discovery-service-contact]')).toBeNull();
  expect(mockRequestDiscovery).not.toHaveBeenCalled();
});

test('la surface service décore le shell canonique puis nettoie ses classes à la fermeture', () => {
  document.body.innerHTML = `
    <div class="k-modal-overlay">
      <div class="k-modal">
        <div id="k-modal-discovery-detail" hidden></div>
      </div>
    </div>`;

  renderDiscoveryModalDetail({
    kind: 'service', ref: 'svc-plomberie',
    detail: { title: 'Plomberie maison', actions: ['request'] },
  });

  const modal = document.querySelector('.k-modal');
  const overlay = document.querySelector('.k-modal-overlay');
  expect(modal.classList.contains('k-modal--service')).toBe(true);
  expect(overlay.classList.contains('k-modal-overlay--service')).toBe(true);

  clearDiscoveryModalDetail();
  expect(modal.classList.contains('k-modal--service')).toBe(false);
  expect(overlay.classList.contains('k-modal-overlay--service')).toBe(false);
});

test('les anciennes capacités ne multiplient pas les boutons Service', () => {
  expect(normalizeActions({ actions: ['quote', 'call', 'whatsapp', 'callback'] })).toEqual(['request', 'callback']);
  expect(publicActionFor('quote')).toBe('request');
  expect(publicActionFor('call')).toBe('callback');
  expect(publicActionFor('whatsapp')).toBe('callback');
  renderDiscoveryModalDetail({
    kind: 'service', ref: 'svc-legacy',
    detail: { title: 'Diagnostic', actions: ['call', 'whatsapp'], public_contact: { phone: '+2693210000', whatsapp: '+2693210001' } },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.querySelectorAll('.k-service-detail-shell button')).toHaveLength(1);
  expect(slot.querySelector('a[href^="tel:"]')).toBeNull();
  expect(slot.querySelector('a[href*="wa.me"]')).toBeNull();
});

test('labels et sujet métier sont déterministes', () => {
  expect(kindLabelFor('physical_offer')).toBe('Offre locale');
  expect(kindLabelFor('service')).toBe('Service local');
  expect(actionLabelFor('request', 'physical_offer')).toBe('Demander cette offre');
  expect(actionLabelFor('request', 'service')).toBe('Demander ce service');
  expect(actionLabelFor('callback', 'service')).toBe('Être rappelé');
  expect(subjectFor({ title: 'Recherche pièce auto', provider_name: 'Garage Nurdine' }))
    .toBe('Recherche pièce auto · Garage Nurdine');
});

test('une offre locale garde ses actions request/callback et leur contexte', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'physical_offer', ref: 'offer-1',
    detail: { title: 'Sac de ciment', provider_name: 'Garage Nurdine', actions: ['request', 'callback'] },
  });

  const requestSelect = document.querySelector('[data-discovery-select-action="request"]');
  requestSelect.click();
  const requestForm = document.querySelector('[data-discovery-action-form="request"]');
  expect(requestForm.hidden).toBe(false);
  expect(requestForm.textContent).toContain('Votre demande concerne');
  expect(mockRequestDiscovery).not.toHaveBeenCalled();

  requestForm.querySelector('[data-discovery-requester-note]').value = '  Trois sacs  ';
  requestForm.querySelector('[data-discovery-requested-window]').value = '  Cette semaine  ';
  requestForm.querySelector('[data-discovery-submit-action="request"]').click();
  expect(mockRequestDiscovery).toHaveBeenLastCalledWith(
    'physical_offer', 'offer-1', expect.any(HTMLElement), 'Cette semaine', 'request', 'Trois sacs'
  );

  const callbackSelect = document.querySelector('[data-discovery-select-action="callback"]');
  callbackSelect.click();
  const callbackForm = document.querySelector('[data-discovery-action-form="callback"]');
  expect(callbackForm.hidden).toBe(false);
  expect(requestForm.hidden).toBe(true);
  callbackForm.querySelector('[data-discovery-requester-note]').value = 'Rappelez-moi après 17h';
  callbackForm.querySelector('[data-discovery-submit-action="callback"]').click();
  expect(mockRequestDiscovery).toHaveBeenLastCalledWith(
    'physical_offer', 'offer-1', expect.any(HTMLElement), null, 'callback', 'Rappelez-moi après 17h'
  );
});

test('modal:closed purge le contenu Discovery sans toucher au shell', () => {
  renderDiscoveryModalDetail({ kind: 'service', ref: 'svc-2', detail: { title: 'Plomberie maison' } });
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
  expect(rail).not.toMatch(/requestDiscovery/);
  expect(rail).toMatch(/async function openDiscoveryDetail\(kind, ref\)/);
  expect(core).toMatch(/modal:discovery-opened/);
  expect((html.match(/id="k-modal-overlay"/g) || [])).toHaveLength(1);
  expect(html).toMatch(/id="k-modal-discovery-detail"/);
});
