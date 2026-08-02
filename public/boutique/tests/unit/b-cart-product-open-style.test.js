'use strict';

/**
 * tests/unit/b-cart-product-open-style.test.js
 *
 * js/b-cart-product-open-style.js — charge un module UX léger au boot
 * boutique via `import()` dynamique : b-desktop-global-cart-access.js
 * → setupDesktopGlobalCartAccess().
 *
 * b-friendly-group-redirect.js (redirection /g/:token → /event/w/:token)
 * a été retiré : il pointait vers une route de l'ancien moteur collective,
 * supprimé depuis (Boutique First). setupCartProductOpenStyle() ne charge
 * donc plus qu'un seul module — ses tests dédiés disparaissent avec lui.
 *
 * Le chargement catch ses propres erreurs (console.warn) sans jamais
 * propager côté appelant : le module ne doit donc jamais lever, y compris
 * si l'import échoue ou si le module chargé n'exporte pas la fonction
 * attendue.
 */

describe('b-cart-product-open-style', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('appelle setupDesktopGlobalCartAccess() au chargement', async () => {
    jest.doMock('../../js/b-desktop-global-cart-access.js', () => ({
      setupDesktopGlobalCartAccess: jest.fn(),
    }));

    const { setupDesktopGlobalCartAccess } = require('../../js/b-desktop-global-cart-access.js');
    const { setupCartProductOpenStyle } = require('../../js/b-cart-product-open-style.js');

    setupCartProductOpenStyle();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setupDesktopGlobalCartAccess).toHaveBeenCalledTimes(1);
  });

  test('ne lève pas si b-desktop-global-cart-access.js échoue au chargement', async () => {
    jest.doMock('../../js/b-desktop-global-cart-access.js', () => {
      throw new Error('module cassé');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { setupCartProductOpenStyle } = require('../../js/b-cart-product-open-style.js');

    expect(() => setupCartProductOpenStyle()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[desktop-cart-access]'),
      expect.any(Error)
    );
  });

  test('ne lève pas si b-desktop-global-cart-access.js n\'exporte pas la fonction attendue', async () => {
    jest.doMock('../../js/b-desktop-global-cart-access.js', () => ({}));

    const { setupCartProductOpenStyle } = require('../../js/b-cart-product-open-style.js');

    expect(() => setupCartProductOpenStyle()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Rien à assert de plus : le contrat testé est "ne plante pas".
  });
});
