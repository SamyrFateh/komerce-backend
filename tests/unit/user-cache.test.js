'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/user-cache.test.js
 *
 * Tests du module utils/user-cache.js — cache utilisateur partagé (TTL 5 min)
 *
 * Couverture :
 *   ✓ get() : renvoie null si la clé est absente
 *   ✓ get() : renvoie l'utilisateur en cache si valide (TTL non expiré)
 *   ✓ get() : renvoie null et supprime l'entrée si le TTL est dépassé
 *   ✓ set() : stocke une entrée récupérable via get()
 *   ✓ set() : purge la plus ancienne entrée si le cache dépasse 10 000 entrées
 *   ✓ invalidate() : supprime une entrée précise
 *   ✓ invalidateAll() : vide tout le cache
 */

const USER_CACHE_TTL = 5 * 60 * 1000;

let userCache;

beforeEach(() => {
  jest.resetModules();
  userCache = require('../../utils/user-cache');
});

describe('user-cache — get/set nominal', () => {
  it('renvoie null pour une clé absente', () => {
    expect(userCache.get('inconnu')).toBeNull();
  });

  it('renvoie la valeur mise en cache via set()', () => {
    userCache.set('u1', { id: 'u1', role: 'client' });
    expect(userCache.get('u1')).toEqual({ id: 'u1', role: 'client' });
  });

  it('écrase une entrée existante avec un nouveau set()', () => {
    userCache.set('u1', { id: 'u1', role: 'client' });
    userCache.set('u1', { id: 'u1', role: 'admin' });
    expect(userCache.get('u1')).toEqual({ id: 'u1', role: 'admin' });
  });
});

describe('user-cache — expiration TTL', () => {
  it('renvoie la valeur si le TTL (5 min) n\'est pas dépassé', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    userCache.set('u1', { id: 'u1' });

    nowSpy.mockReturnValue(1_000_000 + USER_CACHE_TTL - 1);
    expect(userCache.get('u1')).toEqual({ id: 'u1' });

    nowSpy.mockRestore();
  });

  it('renvoie null et supprime l\'entrée si le TTL est dépassé', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    userCache.set('u1', { id: 'u1' });

    nowSpy.mockReturnValue(1_000_000 + USER_CACHE_TTL + 1);
    expect(userCache.get('u1')).toBeNull();

    // Confirme la suppression effective : un second get() reste null même
    // en revenant "dans le temps" (l'entrée a été purgée, pas juste ignorée).
    nowSpy.mockReturnValue(1_000_000);
    expect(userCache.get('u1')).toBeNull();

    nowSpy.mockRestore();
  });
});

describe('user-cache — purge anti-fuite mémoire (taille > 10 000)', () => {
  it('supprime la plus ancienne entrée (première insérée) quand le cache dépasse 10 000 entrées', () => {
    for (let i = 0; i < 10_000; i++) {
      userCache.set(`u${i}`, { id: `u${i}` });
    }
    // u0 est la première insérée, donc la prochaine à être itérée par .keys().next()
    expect(userCache.get('u0')).toEqual({ id: 'u0' });

    userCache.set('u10000', { id: 'u10000' });

    // La purge doit avoir supprimé u0 (la plus ancienne clé du Map).
    expect(userCache.get('u0')).toBeNull();
    expect(userCache.get('u10000')).toEqual({ id: 'u10000' });
  });

  it("ne purge rien tant que la taille reste <= 10 000", () => {
    for (let i = 0; i < 10_000; i++) {
      userCache.set(`u${i}`, { id: `u${i}` });
    }
    expect(userCache.get('u0')).toEqual({ id: 'u0' });
  });
});

describe('user-cache — invalidate / invalidateAll', () => {
  it('invalidate() supprime uniquement la clé ciblée', () => {
    userCache.set('u1', { id: 'u1' });
    userCache.set('u2', { id: 'u2' });

    userCache.invalidate('u1');

    expect(userCache.get('u1')).toBeNull();
    expect(userCache.get('u2')).toEqual({ id: 'u2' });
  });

  it('invalidateAll() vide tout le cache', () => {
    userCache.set('u1', { id: 'u1' });
    userCache.set('u2', { id: 'u2' });

    userCache.invalidateAll();

    expect(userCache.get('u1')).toBeNull();
    expect(userCache.get('u2')).toBeNull();
  });
});
