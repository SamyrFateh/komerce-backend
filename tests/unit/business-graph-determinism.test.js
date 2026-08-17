'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

// Lot O-determinism : fs.readdirSync() n'a pas d'ordre portable garanti entre
// filesystems/OS (ext4, APFS, NTFS peuvent retourner des entrées dans des
// ordres différents pour un même contenu). Preuve permanente que
// stableReadDir() neutralise cette dépendance : quel que soit l'ordre brut
// renvoyé par le disque, la sortie sérialisée est byte-for-byte identique.
//
// On ne dépend jamais de l'ordre réel de l'OS qui exécute ce test : on mocke
// fs.readdirSync avec 3 permutations différentes du même contenu de
// répertoire et on vérifie que stableReadDir() les normalise toutes vers la
// même liste triée.

jest.mock('fs', () => ({
  readdirSync: jest.fn(),
  existsSync: jest.fn(() => false),
  statSync: jest.fn(() => ({ isDirectory: () => false, isFile: () => false })),
  readFileSync: jest.fn(() => ''),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const fs = require('fs');
const { stableReadDir } = require('../../scripts/business-graph-gen.js');

describe('business-graph-gen — stableReadDir (déterminisme de la découverte de répertoire)', () => {
  const ORDERS = [
    ['orders.feature.js', 'catalog.feature.js', 'shared-cart.feature.js'],
    ['shared-cart.feature.js', 'orders.feature.js', 'catalog.feature.js'],
    ['catalog.feature.js', 'shared-cart.feature.js', 'orders.feature.js'],
  ];
  const EXPECTED = ['catalog.feature.js', 'orders.feature.js', 'shared-cart.feature.js'];

  test('3 ordres de découverte différents (simulant ext4/APFS/NTFS) produisent la même sortie triée', () => {
    const outputs = ORDERS.map((rawOrder) => {
      fs.readdirSync.mockReturnValueOnce(rawOrder);
      return stableReadDir('/whatever/dir');
    });

    for (const out of outputs) {
      expect(out).toEqual(EXPECTED);
    }

    // Byte-for-byte : les 3 sérialisations JSON sont strictement identiques,
    // pas seulement égales en valeur.
    const serialized = outputs.map((o) => JSON.stringify(o));
    expect(new Set(serialized).size).toBe(1);
  });

  test("ne mute jamais le tableau renvoyé par fs.readdirSync (slice() avant sort())", () => {
    const raw = ['c.js', 'a.js', 'b.js'];
    fs.readdirSync.mockReturnValueOnce(raw);
    const out = stableReadDir('/whatever/dir');
    expect(out).toEqual(['a.js', 'b.js', 'c.js']);
    // Le tableau original renvoyé par le mock ne doit pas avoir été trié en place.
    expect(raw).toEqual(['c.js', 'a.js', 'b.js']);
  });
});
