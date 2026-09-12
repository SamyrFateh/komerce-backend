'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

/**
 * Verrou fondationnel du chantier currency debt : sans ce parseur, convertir
 * une seule colonne `*_kmf` de `integer` vers `numeric` casserait
 * silencieusement toute arithmétique bare sur cette colonne dans les
 * dizaines de fichiers qui la lisent — `total_kmf + fee` devient une
 * concaténation de chaînes, pas une addition, sans erreur immédiate.
 *
 * Ce test n'exécute aucune requête réelle : il vérifie directement
 * l'enregistrement du hook sur le module `pg`, qui est la même instance
 * partagée par toute l'application (db.js ne crée pas son propre `pg`).
 */

describe('db.js — parseur NUMERIC (OID 1700) enregistré sur pg', () => {
  let types;

  beforeAll(() => {
    // Charger db.js exécute l'enregistrement du parseur en effet de bord au
    // require — c'est le même mécanisme que l'application réelle au boot.
    require('../../db');
    ({ types } = require('pg'));
  });

  test('une valeur numeric est décodée en number, pas en string', () => {
    const parser = types.getTypeParser(1700);
    expect(typeof parser('42.50')).toBe('number');
    expect(parser('42.50')).toBe(42.5);
  });

  test('l’arithmétique bare fonctionne après décodage — plus de concaténation de chaînes', () => {
    const parser = types.getTypeParser(1700);
    const decoded = parser('1500.00');
    expect(decoded + 200).toBe(1700);
    expect(typeof (decoded + 200)).toBe('number');
  });

  test('une colonne integer (OID 23) continue de décoder en number — comportement par défaut inchangé', () => {
    const parser = types.getTypeParser(23);
    expect(typeof parser('1500')).toBe('number');
  });

  test('mutation : sans ce parseur, la valeur reviendrait en string et casserait l’arithmétique', () => {
    // Ce test ne désinstalle jamais le vrai parseur (effet de bord global sur
    // un module partagé par toute la suite) : il compare au comportement par
    // défaut de node-postgres pour prouver que le correctif change bien
    // quelque chose, plutôt que de re-tester une conversion qui aurait de
    // toute façon eu lieu nativement.
    const identity = (value) => value; // décodage par défaut de node-postgres pour NUMERIC : aucune conversion
    const withoutFix = identity('1500.00');
    expect(typeof withoutFix).toBe('string');
    expect(withoutFix + 200).toBe('1500.00200'); // concaténation, pas 1700 — la régression que ce fix évite

    const parser = types.getTypeParser(1700);
    const withFix = parser('1500.00');
    expect(typeof withFix).toBe('number');
    expect(withFix + 200).toBe(1700);
  });
});
