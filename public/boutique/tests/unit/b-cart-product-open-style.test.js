'use strict';

/**
 * tests/unit/b-cart-product-open-style.test.js
 *
 * js/b-cart-product-open-style.js — charge deux modules UX légers au boot
 * boutique, via `import()` dynamique :
 *   - b-friendly-group-redirect.js  → setupFriendlyGroupRedirect()
 *   - b-desktop-global-cart-access.js → setupDesktopGlobalCartAccess()
 *
 * Les deux chargements sont indépendants et chacun catch ses propres
 * erreurs (console.warn) sans jamais propager côté appelant : le module ne
 * doit donc jamais lever, y compris si l'un des deux imports échoue ou si
 * le module chargé n'exporte pas la fonction attendue.
 *
 * jest.mock() sur les chemins relatifs intercepte bien le `import()`
 * dynamique (vérifié : Jest résout les imports dynamiques via le même
 * registre de modules que require()).
 */

describe('b-cart-product-open-style', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('appelle setupFriendlyGroupRedirect() et setupDesktopGlobalCartAccess() au chargement', async () => {
    jest.doMock('../../js/b-friendly-group-redirect.js', () => ({
      setupFriendlyGroupRedirect: jest.fn(),
    }));
    jest.doMock('../../js/b-desktop-global-cart-access.js', () => ({
      setupDesktopGlobalCartAccess: jest.fn(),
    }));

    const { setupFriendlyGroupRedirect } = require('../../js/b-friendly-group-redirect.js');
    const { setupDesktopGlobalCartAccess } = require('../../js/b-desktop-global-cart-access.js');
    const { setupCartProductOpenStyle } = require('../../js/b-cart-product-open-style.js');

    setupCartProductOpenStyle();
    // Laisse les deux microtasks d'import() dynamique se résoudre.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setupFriendlyGroupRedirect).toHaveBeenCalledTimes(1);
    expect(setupDesktopGlobalCartAccess).toHaveBeenCalledTimes(1);
  });

  test('ne lève pas si b-friendly-group-redirect.js échoue au chargement', async () => {
    jest.doMock('../../js/b-friendly-group-redirect.js', () => {
      throw new Error('module cassé');
    });
    jest.doMock('../../js/b-desktop-global-cart-access.js', () => ({
      setupDesktopGlobalCartAccess: jest.fn(),
    }));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { setupCartProductOpenStyle } = require('../../js/b-cart-product-open-style.js');
    const { setupDesktopGlobalCartAccess } = require('../../js/b-desktop-global-cart-access.js');

    expect(() => setupCartProductOpenStyle()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // L'échec du premier import n'empêche pas le second de s'exécuter.
    expect(setupDesktopGlobalCartAccess).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[friendly-group-link]'),
      expect.any(Error)
    );
  });

  test('ne lève pas si b-desktop-global-cart-access.js n\'exporte pas la fonction attendue', async () => {
    jest.doMock('../../js/b-friendly-group-redirect.js', () => ({
      setupFriendlyGroupRedirect: jest.fn(),
    }));
    jest.doMock('../../js/b-desktop-global-cart-access.js', () => ({}));

    const { setupCartProductOpenStyle } = require('../../js/b-cart-product-open-style.js');

    expect(() => setupCartProductOpenStyle()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Rien à assert de plus : le contrat testé est "ne plante pas".
  });
});
