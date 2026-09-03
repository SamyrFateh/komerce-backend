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

test('service sérieux pièce auto garde request/callback dans le même shell', () => {
  renderDiscoveryModalDetail({
    kind: 'service', ref: 'svc-auto',
    detail: {
      title: 'Recherche et sourcing de pièces auto', provider_name: 'Atelier Mutsamudu',
      zone: 'Mutsamudu / Anjouan', description: 'Indiquez marque, modèle, année et pièce recherchée.',
      actions: ['request', 'callback'],
    },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.textContent).toContain('Service');
  expect(slot.textContent).toContain('Sur demande');
  expect(slot.textContent).toContain('Demander ce service');
  expect(slot.textContent).toContain('Être rappelé');
  expect(slot.textContent).toContain('Recherche et sourcing de pièces auto · Atelier Mutsamudu');
});

test('les anciennes capacités convergent vers request/callback sans contact direct', () => {
  expect(normalizeActions({ actions: ['quote', 'call', 'whatsapp', 'callback'] })).toEqual(['request', 'callback']);
  expect(publicActionFor('quote')).toBe('request');
  expect(publicActionFor('call')).toBe('callback');
  expect(publicActionFor('whatsapp')).toBe('callback');
  renderDiscoveryModalDetail({
    kind: 'service', ref: 'svc-legacy',
    detail: { title: 'Diagnostic', actions: ['call', 'whatsapp'], public_contact: { phone: '+2693210000', whatsapp: '+2693210001' } },
  });
  const slot = document.getElementById('k-modal-discovery-detail');
  expect(slot.textContent).toContain('Être rappelé');
  expect(slot.textContent).not.toContain('Appeler');
  expect(slot.querySelector('a[href^="tel:"]')).toBeNull();
  expect(slot.querySelector('a[href*="wa.me"]')).toBeNull();
});

test('labels et sujet métier sont déterministes', () => {
  expect(kindLabelFor('physical_offer')).toBe('Offre locale');
  expect(kindLabelFor('service')).toBe('Service');
  expect(actionLabelFor('request', 'physical_offer')).toBe('Demander cette offre');
  expect(actionLabelFor('request', 'service')).toBe('Demander ce service');
  expect(actionLabelFor('callback', 'service')).toBe('Être rappelé');
  expect(subjectFor({ title: 'Recherche pièce auto', provider_name: 'Garage Nurdine' }))
    .toBe('Recherche pièce auto · Garage Nurdine');
});

test('interaction V2 : choisir ne soumet pas, request et callback transportent leur contexte', () => {
  setupDiscoveryModalDetail();
  listeners['modal:discovery-opened']({
    kind: 'service', ref: 'svc-1',
    detail: { title: 'Recherche pièce auto', provider_name: 'Garage Nurdine', actions: ['request', 'callback'] },
  });

  const requestSelect = document.querySelector('[data-discovery-select-action="request"]');
  requestSelect.click();
  const requestForm = document.querySelector('[data-discovery-action-form="request"]');
  expect(requestForm.hidden).toBe(false);
  expect(requestForm.textContent).toContain('Votre demande concerne');
  expect(requestForm.textContent).toContain('Recherche pièce auto · Garage Nurdine');
  expect(mockCloseModal).not.toHaveBeenCalled();
  expect(mockRequestDiscovery).not.toHaveBeenCalled();

  requestForm.querySelector('[data-discovery-requester-note]').value = '  Toyota Hilux 2012, phare avant droit  ';
  requestForm.querySelector('[data-discovery-requested-window]').value = '  Cette semaine  ';
  requestForm.querySelector('[data-discovery-submit-action="request"]').click();
  expect(mockRequestDiscovery).toHaveBeenLastCalledWith(
    'service', 'svc-1', expect.any(HTMLElement), 'Cette semaine', 'request', 'Toyota Hilux 2012, phare avant droit'
  );

  const callbackSelect = document.querySelector('[data-discovery-select-action="callback"]');
  callbackSelect.click();
  const callbackForm = document.querySelector('[data-discovery-action-form="callback"]');
  expect(callbackForm.hidden).toBe(false);
  expect(requestForm.hidden).toBe(true);
  expect(callbackForm.textContent).toContain('Objet du rappel');
  expect(callbackForm.textContent).toContain('Recherche pièce auto · Garage Nurdine');
  callbackForm.querySelector('[data-discovery-requester-note]').value = 'Rappelez-moi après 17h';
  callbackForm.querySelector('[data-discovery-submit-action="callback"]').click();
  expect(mockRequestDiscovery).toHaveBeenLastCalledWith(
    'service', 'svc-1', expect.any(HTMLElement), null, 'callback', 'Rappelez-moi après 17h'
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
