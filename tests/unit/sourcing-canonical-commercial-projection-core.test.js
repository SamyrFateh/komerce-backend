'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/sourcing-canonical-commercial-projection-core.test.js
 *
 * Feature propriétaire : sourcing
 *
 * Contexte : services/sourcing-canonical-commercial-projection-core.js
 * (criticality high) n'avait aucun test. C'est le cœur de résolution
 * d'état temporel de la doctrine DOCTRINE_CANONICAL_PRODUCT_OFFER_UNIT —
 * un module de fonctions PURES (aucune DB, aucune dépendance) utilisé par
 * les projections offer/unit pour déterminer « quelle est la dernière
 * observation valable » à partir d'un flux d'observations immuables
 * potentiellement désordonné.
 *
 * Invariants prouvés :
 *   1. latestObservation() trie par observed_at, départage par
 *      observation_id en cas d'égalité temporelle exacte — déterministe,
 *      jamais dépendant de l'ordre d'insertion du tableau source.
 *   2. currentState() ne retient QUE les champs présents dans la dernière
 *      observation (present() rejette null/undefined/chaîne vide) — un
 *      champ absent dans la dernière observation mais présent dans une
 *      plus ancienne ne « fuit » jamais dans l'état courant.
 *   3. clone() isole réellement la sortie de l'entrée (mutation de la
 *      sortie ne doit jamais modifier la ligne source).
 *   4. identityRefs() déduplique par (namespace, kind, value) et trie
 *      pour un résultat reproductible entre deux appels équivalents.
 *   5. provenance() conserve l'ordre chronologique et projette
 *      uniquement les champs attendus, sans fuite de données internes.
 */

const {
  clone,
  present,
  latestObservation,
  currentState,
  identityRefs,
  provenance,
} = require('../../services/sourcing-canonical-commercial-projection-core');

describe('clone', () => {
  it('copie profondément — muter la sortie ne modifie jamais la source', () => {
    const source = { a: 1, nested: { b: 2 } };
    const copy = clone(source);
    copy.nested.b = 999;
    expect(source.nested.b).toBe(2);
    expect(copy).toEqual({ a: 1, nested: { b: 999 } });
  });

  it('undefined reste undefined (pas de JSON.stringify(undefined) → erreur)', () => {
    expect(clone(undefined)).toBeUndefined();
  });

  it('null est préservé tel quel', () => {
    expect(clone(null)).toBeNull();
  });
});

describe('present', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    [0, true],
    [false, true],
    ['x', true],
    [{}, true],
  ])('present(%p) → %p', (value, expected) => {
    expect(present(value)).toBe(expected);
  });
});

describe('latestObservation', () => {
  it('retourne la ligne au observed_at le plus récent', () => {
    const rows = [
      { observation_id: 'a', observed_at: '2026-01-01T00:00:00Z' },
      { observation_id: 'b', observed_at: '2026-03-01T00:00:00Z' },
      { observation_id: 'c', observed_at: '2026-02-01T00:00:00Z' },
    ];
    expect(latestObservation(rows).observation_id).toBe('b');
  });

  it('égalité exacte de observed_at → départage déterministe par observation_id', () => {
    const rows = [
      { observation_id: 'zzz', observed_at: '2026-01-01T00:00:00Z' },
      { observation_id: 'aaa', observed_at: '2026-01-01T00:00:00Z' },
    ];
    // Tri croissant sur (observed_at, observation_id) puis .at(-1) : le plus
    // grand observation_id à égalité de date gagne.
    expect(latestObservation(rows).observation_id).toBe('zzz');
  });

  it("l'ordre d'insertion du tableau ne change jamais le résultat", () => {
    const a = { observation_id: '1', observed_at: '2026-01-01T00:00:00Z' };
    const b = { observation_id: '2', observed_at: '2026-06-01T00:00:00Z' };
    expect(latestObservation([a, b]).observation_id).toBe('2');
    expect(latestObservation([b, a]).observation_id).toBe('2');
  });

  it('tableau vide ou absent → null, jamais une exception', () => {
    expect(latestObservation([])).toBeNull();
    expect(latestObservation()).toBeNull();
  });
});

describe('currentState', () => {
  it('ne retient que les champs présents dans la DERNIÈRE observation', () => {
    const rows = [
      { observation_id: '1', observed_at: '2026-01-01T00:00:00Z', normalized: { title: 'Ancien titre', color: 'rouge' } },
      { observation_id: '2', observed_at: '2026-02-01T00:00:00Z', normalized: { title: 'Nouveau titre' } },
    ];
    const { state } = currentState(rows, ['title', 'color']);
    expect(state).toEqual({ title: 'Nouveau titre' });
    // 'color' de l'observation PLUS ANCIENNE ne doit jamais fuiter dans
    // l'état courant, même si le champ demandé existe ailleurs.
    expect(state.color).toBeUndefined();
  });

  it('champ null/vide dans la dernière observation est exclu (present() le rejette)', () => {
    const rows = [
      { observation_id: '1', observed_at: '2026-01-01T00:00:00Z', normalized: { title: 'x', price: '' } },
    ];
    const { state } = currentState(rows, ['title', 'price']);
    expect(state).toEqual({ title: 'x' });
  });

  it("l'état retourné est une copie — mutation ne modifie pas l'observation source", () => {
    const rows = [{ observation_id: '1', observed_at: '2026-01-01T00:00:00Z', normalized: { title: 'x' } }];
    const { state } = currentState(rows, ['title']);
    state.title = 'muté';
    expect(rows[0].normalized.title).toBe('x');
  });

  it('rows vide → state vide, latest null', () => {
    const { state, latest } = currentState([], ['title']);
    expect(state).toEqual({});
    expect(latest).toBeNull();
  });
});

describe('identityRefs', () => {
  it('extrait source_ref et les champs normalisés demandés comme refs typées', () => {
    const rows = [
      { source_id: 'aliexpress', source_ref: 'SKU-1', normalized: { ean: '1234567890123' } },
    ];
    const refs = identityRefs(rows, ['ean']);
    expect(refs).toEqual(
      expect.arrayContaining([
        { namespace: 'aliexpress', kind: 'source_ref', value: 'SKU-1' },
        { namespace: 'aliexpress', kind: 'ean', value: '1234567890123' },
      ])
    );
  });

  it('déduplique les refs identiques (même namespace+kind+value) entre plusieurs observations', () => {
    const rows = [
      { source_id: 'aliexpress', source_ref: 'SKU-1', normalized: {} },
      { source_id: 'aliexpress', source_ref: 'SKU-1', normalized: {} },
    ];
    const refs = identityRefs(rows, []);
    expect(refs).toHaveLength(1);
  });

  it('tri déterministe — même entrée dans un ordre différent produit le même résultat', () => {
    const rowA = { source_id: 'a', source_ref: 'X', normalized: {} };
    const rowB = { source_id: 'b', source_ref: 'Y', normalized: {} };
    expect(identityRefs([rowA, rowB], [])).toEqual(identityRefs([rowB, rowA], []));
  });

  it('champ absent/vide ignoré, ne produit pas de ref fantôme', () => {
    const rows = [{ source_id: 'aliexpress', source_ref: null, normalized: { ean: '' } }];
    expect(identityRefs(rows, ['ean'])).toEqual([]);
  });

  it('rows vide → tableau vide', () => {
    expect(identityRefs([], [])).toEqual([]);
  });
});

describe('provenance', () => {
  it('conserve l’ordre chronologique croissant, projette uniquement les champs attendus', () => {
    const rows = [
      { observation_id: 'b', observed_at: '2026-02-01T00:00:00Z', source_id: 's2', adapter_type: 'scan', principal_ref: null, secret_internal_field: 'ne-doit-jamais-fuiter' },
      { observation_id: 'a', observed_at: '2026-01-01T00:00:00Z', source_id: 's1', adapter_type: 'manual', principal_ref: 'op-1' },
    ];
    const result = provenance(rows);
    expect(result.map(r => r.observation_id)).toEqual(['a', 'b']);
    expect(result[0]).toEqual({
      observation_id: 'a', source_id: 's1', adapter_type: 'manual', principal_ref: 'op-1', observed_at: '2026-01-01T00:00:00Z',
    });
    expect(result[1].secret_internal_field).toBeUndefined();
  });

  it('principal_ref absent → null explicite, pas undefined', () => {
    const rows = [{ observation_id: 'a', observed_at: '2026-01-01T00:00:00Z', source_id: 's1', adapter_type: 'scan' }];
    expect(provenance(rows)[0].principal_ref).toBeNull();
  });

  it('rows vide → tableau vide', () => {
    expect(provenance([])).toEqual([]);
  });
});
