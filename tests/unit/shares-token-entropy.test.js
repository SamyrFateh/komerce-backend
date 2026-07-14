'use strict';

/**
 * tests/unit/shares-token-entropy.test.js
 *
 * RC-SEC / TOK-02 — preuve : routes/shares.js genToken() utilise un CSPRNG
 * (crypto.randomBytes) au lieu de Math.random(), longueur >= 12, pas de
 * collision observée sur 10k générations.
 *
 * ROUGE-AVANT (mécanisme reproduit ici en commentaire — la version d'origine
 * utilisait `Math.random()`, un PRNG non cryptographique, prévisible si le
 * seed interne est reconstitué, et une longueur de 8 caractères par défaut).
 * VERT-APRÈS : voir assertions ci-dessous.
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
  forModule: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../db', () => ({ query: jest.fn() }));

const router = require('../../routes/shares');
const { genToken } = router;

describe('routes/shares — genToken (TOK-02)', () => {
  test('longueur par défaut >= 12', () => {
    expect(genToken().length).toBeGreaterThanOrEqual(12);
  });

  test('alphabet restreint (base58-like, sans 0/O/I/l ambigus)', () => {
    const t = genToken(200);
    expect(t).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
  });

  test('utilise crypto.randomBytes (CSPRNG), pas Math.random', () => {
    const crypto = require('crypto');
    const spy = jest.spyOn(crypto, 'randomBytes');
    const mathRandomSpy = jest.spyOn(Math, 'random');

    genToken(12);

    expect(spy).toHaveBeenCalledWith(12);
    expect(mathRandomSpy).not.toHaveBeenCalled();

    spy.mockRestore();
    mathRandomSpy.mockRestore();
  });

  test('10 000 générations (len=12) — aucune collision', () => {
    const seen = new Set();
    for (let i = 0; i < 10000; i++) {
      seen.add(genToken(12));
    }
    expect(seen.size).toBe(10000);
  });
});
