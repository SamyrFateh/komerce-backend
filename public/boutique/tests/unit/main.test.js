'use strict';

/**
 * Smoke test du point d'entrée main.js : branchement du runtime immédiat puis
 * activation desktop différée après resize. Les modules appelés ont leurs
 * propres tests ; ici on protège uniquement l'ordre d'orchestration.
 */

const mockBus = {};
const mockSetupSharePhoneGuard = jest.fn();
const mockSetupDesktopUpgrade = jest.fn();
const mockSetupProductOpenContract = jest.fn();
const mockSetupCartProductOpenStyle = jest.fn();
const mockSetupApprocheCHybridPdp = jest.fn();
const mockSetupPdpCurationSuggestions = jest.fn();
const mockSetupHomePremiumV1 = jest.fn();
const mockSetupProductDetailModal = jest.fn();
const mockGreetIfKnown = jest.fn();
const mockIsDesktop = jest.fn();

jest.mock('../../js/b-utils.js', () => ({}));
jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-store.js', () => ({}));
jest.mock('../../js/boutique.js', () => ({}));
jest.mock('../../js/b-share-phone-guard.js', () => ({
  setupSharePhoneGuard: mockSetupSharePhoneGuard,
}));
jest.mock('../../js/b-desktop-upgrade.js', () => ({
  setupDesktopUpgrade: mockSetupDesktopUpgrade,
}));
jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: mockIsDesktop }));
jest.mock('../../js/b-product-open-contract.js', () => ({
  setupProductOpenContract: mockSetupProductOpenContract,
}));
jest.mock('../../js/b-cart-product-open-style.js', () => ({
  setupCartProductOpenStyle: mockSetupCartProductOpenStyle,
}));
jest.mock('../../js/b-modal-approche-c-hybrid.js', () => ({
  setupApprocheCHybridPdp: mockSetupApprocheCHybridPdp,
}));
jest.mock('../../js/b-pdp-curation-suggestions.js', () => ({
  setupPdpCurationSuggestions: mockSetupPdpCurationSuggestions,
}));
jest.mock('../../js/b-home-premium-v1.js', () => ({
  setupHomePremiumV1: mockSetupHomePremiumV1,
}));
jest.mock('../../js/b-modal-product-detail-bootstrap.js', () => ({
  setupProductDetailModal: mockSetupProductDetailModal,
}));
jest.mock('../../js/b-greeting.js', () => ({ greetIfKnown: mockGreetIfKnown }));

test('main initialise le runtime et applique les enrichissements desktop au premier resize', () => {
  jest.useFakeTimers();
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  mockIsDesktop.mockReturnValueOnce(false).mockReturnValue(true);

  jest.isolateModules(() => {
    require('../../js/main.js');
  });

  expect(window._kbus).toBe(mockBus);
  expect(mockSetupSharePhoneGuard).toHaveBeenCalledTimes(1);
  expect(mockSetupDesktopUpgrade).toHaveBeenCalledTimes(1);
  expect(mockSetupProductDetailModal).toHaveBeenCalledTimes(1);
  expect(mockSetupProductOpenContract).toHaveBeenCalledTimes(1);
  expect(mockSetupCartProductOpenStyle).toHaveBeenCalledTimes(1);
  expect(mockGreetIfKnown).toHaveBeenCalledTimes(1);

  window.dispatchEvent(new Event('resize'));
  jest.advanceTimersByTime(150);

  expect(mockSetupDesktopUpgrade).toHaveBeenCalledTimes(2);
  expect(mockSetupApprocheCHybridPdp).toHaveBeenCalledTimes(2);
  expect(mockSetupPdpCurationSuggestions).toHaveBeenCalledTimes(2);
  expect(mockSetupHomePremiumV1).toHaveBeenCalledTimes(2);

  window.dispatchEvent(new Event('resize'));
  jest.advanceTimersByTime(150);
  expect(mockSetupDesktopUpgrade).toHaveBeenCalledTimes(2);
  expect(mockSetupProductDetailModal).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
