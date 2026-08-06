'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/journal.test.js
 * Couvre services/simulator/journal.js
 *
 * Journal en mémoire (pas de DB). log() s'auto-référence via log.info(...)
 * (pattern logger non standard) — on stub journal.log.info avant chaque test
 * pour éviter un TypeError, comme dans simulator-platform-ops.test.js.
 */

let journal;

beforeEach(() => {
  jest.resetModules();
  journal = require('../../services/simulator/journal');
  journal.log.info = jest.fn();
  journal.clear();
});

describe('log', () => {
  it('ajoute une entrée avec time, timestamp, ref, scenario, message, success', () => {
    journal.log('o1', 'REF-1', 'nominal', 'Action effectuée', true);
    const all = journal.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      orderId: 'o1', ref: 'REF-1', scenario: 'nominal', message: 'Action effectuée', success: true,
    });
    expect(all[0].time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(typeof all[0].timestamp).toBe('number');
  });

  it('orderId absent → orderId:null', () => {
    journal.log(null, 'REF-1', 'nominal', 'msg');
    expect(journal.getAll()[0].orderId).toBeNull();
  });

  it('ref absent → fallback "—"', () => {
    journal.log('o1', null, 'nominal', 'msg');
    expect(journal.getAll()[0].ref).toBe('—');
  });

  it('scenario absent → scenario:null', () => {
    journal.log('o1', 'REF-1', null, 'msg');
    expect(journal.getAll()[0].scenario).toBeNull();
  });

  it('success non fourni → true par defaut', () => {
    journal.log('o1', 'REF-1', 'nominal', 'msg');
    expect(journal.getAll()[0].success).toBe(true);
  });

  it('success explicitement false → conserve false', () => {
    journal.log('o1', 'REF-1', 'nominal', 'echec', false);
    expect(journal.getAll()[0].success).toBe(false);
  });

  it('success non-booleen (ex: undefined autre que false) → true (seule false est rejetee)', () => {
    journal.log('o1', 'REF-1', 'nominal', 'msg', 0);
    expect(journal.getAll()[0].success).toBe(true);
  });

  it('plusieurs appels → s\'accumulent dans l\'ordre', () => {
    journal.log('o1', 'R1', 'a', 'm1');
    journal.log('o2', 'R2', 'b', 'm2');
    const all = journal.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].message).toBe('m1');
    expect(all[1].message).toBe('m2');
  });
});

describe('getRecent', () => {
  it('retourne les n dernieres entrees, dans l\'ordre chronologique', () => {
    for (let i = 1; i <= 5; i++) journal.log('o1', `R${i}`, 'x', `m${i}`);
    const recent = journal.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent.map(e => e.message)).toEqual(['m4', 'm5']);
  });

  it('n superieur au nombre d\'entrees → retourne tout', () => {
    journal.log('o1', 'R1', 'x', 'm1');
    expect(journal.getRecent(10)).toHaveLength(1);
  });

  it('journal vide → tableau vide', () => {
    expect(journal.getRecent(5)).toEqual([]);
  });
});

describe('getAll', () => {
  it('journal vide → tableau vide', () => {
    expect(journal.getAll()).toEqual([]);
  });

  it('retourne toutes les entrees enregistrees', () => {
    journal.log('o1', 'R1', 'x', 'm1');
    journal.log('o2', 'R2', 'y', 'm2');
    expect(journal.getAll()).toHaveLength(2);
  });
});

describe('getForOrder', () => {
  it('filtre les entrees par orderId', () => {
    journal.log('o1', 'R1', 'x', 'm1');
    journal.log('o2', 'R2', 'y', 'm2');
    journal.log('o1', 'R3', 'z', 'm3');
    const forO1 = journal.getForOrder('o1');
    expect(forO1).toHaveLength(2);
    expect(forO1.map(e => e.message)).toEqual(['m1', 'm3']);
  });

  it('orderId inconnu → tableau vide', () => {
    journal.log('o1', 'R1', 'x', 'm1');
    expect(journal.getForOrder('inexistant')).toEqual([]);
  });

  it('orderId explicitement null → retourne les entrees sans orderId (correspondance stricte)', () => {
    journal.log(null, 'R1', 'x', 'm1');
    journal.log('o1', 'R2', 'y', 'm2');
    expect(journal.getForOrder(null)).toHaveLength(1);
    expect(journal.getForOrder(null)[0].message).toBe('m1');
  });
});

describe('countSuccess', () => {
  it('compte les entrees success:true ET avec orderId non-null', () => {
    journal.log('o1', 'R1', 'x', 'm1', true);
    journal.log('o2', 'R2', 'y', 'm2', false);
    journal.log(null, 'R3', 'z', 'm3', true); // pas de orderId → exclu
    journal.log('o3', 'R4', 'w', 'm4', true);
    expect(journal.countSuccess()).toBe(2);
  });

  it('journal vide → 0', () => {
    expect(journal.countSuccess()).toBe(0);
  });

  it('aucune entree avec orderId → 0', () => {
    journal.log(null, 'R1', 'x', 'm1', true);
    expect(journal.countSuccess()).toBe(0);
  });
});

describe('countChaos', () => {
  it('compte les entrees dont le message contient "Chaos"', () => {
    journal.log('o1', 'R1', 'x', 'Chaos injecté');
    journal.log('o2', 'R2', 'y', 'Action normale');
    journal.log('o3', 'R3', 'z', 'Encore du Chaos ici');
    expect(journal.countChaos()).toBe(2);
  });

  it('aucun message ne contient "Chaos" → 0', () => {
    journal.log('o1', 'R1', 'x', 'Action normale');
    expect(journal.countChaos()).toBe(0);
  });

  it('journal vide → 0', () => {
    expect(journal.countChaos()).toBe(0);
  });

  it('recherche sensible a la casse (ne matche pas "chaos" minuscule)', () => {
    journal.log('o1', 'R1', 'x', 'un chaos minuscule');
    expect(journal.countChaos()).toBe(0);
  });
});

describe('clear', () => {
  it('vide completement le journal', () => {
    journal.log('o1', 'R1', 'x', 'm1');
    journal.log('o2', 'R2', 'y', 'm2');
    journal.clear();
    expect(journal.getAll()).toEqual([]);
    expect(journal.countSuccess()).toBe(0);
  });

  it('peut etre appele sur un journal deja vide sans erreur', () => {
    expect(() => journal.clear()).not.toThrow();
    expect(journal.getAll()).toEqual([]);
  });
});
