'use strict';

/** Couverture du formulaire et du POST actif de b-share-cart.js. */

const mockShowToast = jest.fn();
const mockClearCart = jest.fn();
const mockRefreshGroupBadge = jest.fn();
const mockRenderGroupView = jest.fn();
const mockSwitchView = jest.fn();
const mockShowBanner = jest.fn();
const mockHideBanner = jest.fn();
const mockRefreshBanner = jest.fn();
const mockRequireIdentity = jest.fn();

jest.mock('../../js/b-cart-core.js', () => ({ showToast: mockShowToast }));
jest.mock('../../js/b-cart.js', () => ({ clearCart: mockClearCart }));
jest.mock('../../js/b-group-view.js', () => ({
  refreshGroupBadge: mockRefreshGroupBadge,
  renderGroupView: mockRenderGroupView,
}));
jest.mock('../../js/b-nav.js', () => ({ switchView: mockSwitchView }));
jest.mock('../../js/b-group-banner.js', () => ({
  showBanner: mockShowBanner,
  hideBanner: mockHideBanner,
  refreshBanner: mockRefreshBanner,
}));
jest.mock('../../js/b-identity.js', () => ({ requireIdentity: mockRequireIdentity }));
jest.mock('../../js/b-phone.js', () => ({
  PHONE_COUNTRIES: [],
  buildPhoneSelect: jest.fn(),
  isValidLocalLength: jest.fn(() => true),
  buildE164: jest.fn((value) => value),
  digitsOnly: jest.fn((value) => String(value || '').replace(/\D/g, '')),
  prettifyLocal: jest.fn((value) => value),
  // O7.3 (provider payments) : makeIntlPhoneInput mocké ici désormais —
  // b-share-cart.js l'importe directement depuis b-phone.js (son vrai
  // propriétaire, auth-identity), plus via b-checkout.js. Voir
  // docs/O7_3_BOUNDARY_ANALYSIS.md.
  makeIntlPhoneInput: jest.fn(() => {
    const group = global.document.createElement('div');
    group.className = 'k-ck-group';
    group.innerHTML = '<label class="k-ck-label"></label><div class="k-ck-phone-wrap"><select class="k-ck-phone-select"></select><input id="k-sm-ph" class="k-ck-phone-input"></div>';
    return group;
  }),
}));

jest.mock('../../js/b-checkout.js', () => ({
  makeInput: jest.fn((id, label, type, placeholder, data, key) => {
    const group = global.document.createElement('div');
    group.className = 'k-ck-group';
    const labelEl = global.document.createElement('label');
    labelEl.className = 'k-ck-label';
    labelEl.textContent = label;
    const input = global.document.createElement('input');
    input.id = id;
    input.type = type;
    input.placeholder = placeholder || '';
    input.addEventListener('input', () => { data[key] = input.value; });
    group.append(labelEl, input);
    return group;
  }),
}));

const { state } = require('../../js/b-store.js');
const {
  startShareFlow,
  clearShareState,
} = require('../../js/b-share-cart.js');

function cartItem(id, qty = 1) {
  return { product: { id, name: `Produit ${id}` }, qty };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function fillForm({
  title = 'Cadeau Aïcha',
  date = '2026-08-15',
  mode = 'needs_validation',
} = {}) {
  const titleInput = document.getElementById('k-sm-title-f');
  titleInput.value = title;
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  const dateInput = document.getElementById('k-sm-date-f');
  dateInput.value = date;
  dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector(`.k-sm-nature-opt[data-mode="${mode}"]`).click();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  document.body.innerHTML = `
    <button id="k-cart-share">📤 Partager</button>
    <button class="k-bnav-item" data-tab="group"></button>
    <button class="k-header-nav-btn" data-tab="group"></button>
  `;
  sessionStorage.clear();
  state.cart = [cartItem('p-1', 2), cartItem('p-2', 1)];
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareTotalKmf = 0;
  state.shareContributedKmf = 0;
  state.shareRemainingKmf = 0;
  state.shareUrl = null;
  mockRequireIdentity.mockResolvedValue({ id: 'user-1' });
  global.fetch = jest.fn();
  window.open = jest.fn();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('crée un panier à valider, persiste son état, vide le panier puis ouvre Groupe', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      shared_cart_id: 'sc-101',
      token: 'tok-101',
      share_url: 'https://komerce.test/boutique/?p=tok-101',
      status: 'open',
      total_kmf: 15000,
      target_date: '2026-08-15',
    }),
  });

  const flow = startShareFlow();
  fillForm();
  document.getElementById('k-sm-submit').click();
  await flow;
  await settle();

  expect(mockRequireIdentity).toHaveBeenCalledWith(expect.objectContaining({
    reason: 'créer un panier groupe',
  }));
  expect(global.fetch).toHaveBeenCalledWith('/api/shared-carts/from-cart-items', expect.objectContaining({
    method: 'POST',
    credentials: 'include',
  }));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
    cart_items: [
      { product_id: 'p-1', quantity: 2 },
      { product_id: 'p-2', quantity: 1 },
    ],
    title: 'Cadeau Aïcha',
    share_mode: 'needs_validation',
    target_date: '2026-08-15',
  });
  expect(state).toMatchObject({
    shareToken: 'tok-101',
    shareId: 'sc-101',
    cartName: 'Cadeau Aïcha',
    shareStatus: 'open',
    shareTotalKmf: 15000,
    shareRemainingKmf: 15000,
  });
  expect(JSON.parse(sessionStorage.getItem('kmrc_share')).token).toBe('tok-101');
  expect(mockShowBanner).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Cadeau Aïcha', total_kmf_snapshot: 15000,
  }));
  expect(mockClearCart).toHaveBeenCalledTimes(1);
  expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Panier groupe créé'), 'success');
  expect(mockSwitchView).toHaveBeenCalledWith('group');
  expect(mockRenderGroupView).toHaveBeenCalled();
  expect(document.getElementById('k-cart-share').disabled).toBe(false);
  expect(document.getElementById('k-cart-share').textContent).toBe('📤 Partager');
});

test('le mode prêt à payer et le titre vide construisent le payload minimal', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ shared_cart_id: 'sc-2', token: 'tok-2', status: 'closed', total_kmf: 9000 }),
  });

  const flow = startShareFlow();
  fillForm({ title: '', date: '', mode: 'ready_to_pay' });
  document.getElementById('k-sm-submit').click();
  await flow;
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);

  expect(body).toEqual({
    cart_items: [
      { product_id: 'p-1', quantity: 2 },
      { product_id: 'p-2', quantity: 1 },
    ],
    share_mode: 'ready_to_pay',
  });
  expect(state.cartName).toBe('Panier groupe');
});

test('une identité annulée restaure le bouton et laisse le formulaire ouvert', async () => {
  mockRequireIdentity.mockResolvedValue(null);
  const flow = startShareFlow();
  fillForm();
  const submit = document.getElementById('k-sm-submit');
  submit.click();
  await settle();

  expect(global.fetch).not.toHaveBeenCalled();
  expect(submit.disabled).toBe(false);
  expect(submit.textContent).toBe('Créer le panier →');
  document.querySelector('.k-sm-close').click();
  await flow;
});

test('une erreur de vérification s’affiche puis permet de fermer proprement', async () => {
  mockRequireIdentity.mockRejectedValue(new Error('OTP expiré'));
  const flow = startShareFlow();
  fillForm();
  document.getElementById('k-sm-submit').click();
  await settle();

  expect(document.getElementById('k-sm-err').textContent).toBe('OTP expiré');
  expect(document.getElementById('k-sm-submit').disabled).toBe(false);
  document.querySelector('.k-sm-close').click();
  await flow;
});

test('une erreur API remonte le message et réactive le bouton Partager', async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Limite de paniers actifs atteinte' }),
  });
  const flow = startShareFlow();
  fillForm();
  document.getElementById('k-sm-submit').click();
  await flow;

  expect(mockShowToast).toHaveBeenCalledWith('Erreur : Limite de paniers actifs atteinte', 'error');
  expect(mockClearCart).not.toHaveBeenCalled();
  expect(document.getElementById('k-cart-share').disabled).toBe(false);
});

test('Enter dans le titre déclenche la création', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ shared_cart_id: 'sc-enter', token: 'tok-enter', total_kmf: 3000 }),
  });
  const flow = startShareFlow();
  fillForm({ title: 'Panier Enter' });
  document.getElementById('k-sm-title-f').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
  await flow;
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('depuis un groupe actif, le choix Nouveau poursuit vers une nouvelle création', async () => {
  state.shareToken = 'tok-old';
  state.cartName = 'Ancien groupe';
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ shared_cart_id: 'sc-new', token: 'tok-new', total_kmf: 4000 }),
  });

  const flow = startShareFlow();
  expect(document.querySelector('.k-sm-hint').textContent).toContain('Ancien groupe');
  document.getElementById('k-sm-new-group').click();
  await settle();
  fillForm({ title: 'Nouveau groupe' });
  document.getElementById('k-sm-submit').click();
  await flow;

  expect(state.shareToken).toBe('tok-new');
  expect(state.cartName).toBe('Nouveau groupe');
});

test('la fermeture par clic sur l’overlay annule le formulaire', async () => {
  const flow = startShareFlow();
  const overlay = document.querySelector('.k-share-modal-overlay');
  overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flow;
  expect(global.fetch).not.toHaveBeenCalled();
});

test('clearShareState après création supprime le cache et les indicateurs', () => {
  state.shareToken = 'tok-clear';
  state.shareId = 'sc-clear';
  sessionStorage.setItem('kmrc_share', '{"token":"tok-clear"}');
  clearShareState();
  expect(state.shareToken).toBeNull();
  expect(state.shareId).toBeNull();
  expect(sessionStorage.getItem('kmrc_share')).toBeNull();
  expect(mockHideBanner).toHaveBeenCalled();
});
