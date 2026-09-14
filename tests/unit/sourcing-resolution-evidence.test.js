'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  extractObservationEvidence,
  scoreCandidate,
  chooseResolutionRoute,
  optionSignature,
} = require('../../services/sourcing-resolution-evidence');

function productObservation(overrides = {}) {
  return {
    grain: 'product',
    source_id: 'api:alpha',
    source_ref: 'P-42',
    normalized: {
      product_name: 'Chargeur USB-C 65W',
      brand: 'PowerGo',
      supplier_category: 'Chargers',
      specifications: [
        { key: 'GTIN', label: 'GTIN', value: '1234567890123' },
        { key: 'MPN', label: 'Manufacturer part number', value: 'PG-65-GAN' },
        { key: 'model_number', label: 'Model', value: 'GaN 65' },
      ],
    },
    ...overrides,
  };
}

describe('sourcing resolution evidence', () => {
  test('extrait les identifiants universels sans utiliser prix ni stock', () => {
    const evidence = extractObservationEvidence(productObservation({
      normalized: {
        ...productObservation().normalized,
        purchase_price: 19.99,
        stock_available: 17,
      },
    }));

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidence_type: 'source_ref', evidence_key: 'source_scoped_ref' }),
      { evidence_type: 'deterministic_id', evidence_key: 'gtin', value: '1234567890123' },
      { evidence_type: 'deterministic_id', evidence_key: 'mpn', value: 'PG-65-GAN' },
      { evidence_type: 'attribute', evidence_key: 'brand', value: 'powergo' },
      { evidence_type: 'lexical', evidence_key: 'brand_model', value: 'powergo gan 65' },
    ]));
    expect(JSON.stringify(evidence)).not.toContain('19.99');
    expect(JSON.stringify(evidence)).not.toContain('17');
  });

  test('la reference source est namespaced par instance de source', () => {
    const a = extractObservationEvidence(productObservation({ source_id: 'api:alpha' }));
    const b = extractObservationEvidence(productObservation({ source_id: 'api:beta' }));
    const refA = a.find((e) => e.evidence_type === 'source_ref');
    const refB = b.find((e) => e.evidence_type === 'source_ref');
    expect(refA.value).not.toBe(refB.value);
    expect(a.find((e) => e.evidence_key === 'gtin').value).toBe(b.find((e) => e.evidence_key === 'gtin').value);
  });

  test('une unite produit une signature optionnelle stable', () => {
    expect(optionSignature({ Taille: 'M', Couleur: 'Bleu' })).toBe('couleur=bleu|taille=m');
    const evidence = extractObservationEvidence({
      grain: 'unit', source_id: 'api:alpha', source_ref: 'VID-1',
      normalized: { option_values: { Taille: 'M', Couleur: 'Bleu' }, purchase_price: 12 },
    });
    expect(evidence).toContainEqual({ evidence_type: 'lexical', evidence_key: 'option_signature', value: 'couleur=bleu|taille=m' });
  });

  test('un exact source ref sans contradiction peut auto-linker', () => {
    const current = extractObservationEvidence(productObservation());
    const scored = {
      canonical_entity_id: 'c1',
      ...scoreCandidate(current, current, { sourceRefExact: true }),
    };
    expect(chooseResolutionRoute([scored])).toMatchObject({ action: 'LINK', reason: 'exact_source_ref' });
  });

  test('un GTIN exact cross-source peut auto-linker sans contradiction', () => {
    const current = extractObservationEvidence(productObservation({ source_id: 'api:alpha', source_ref: 'A-1' }));
    const candidate = extractObservationEvidence(productObservation({ source_id: 'api:beta', source_ref: 'B-9' }));
    const scored = { canonical_entity_id: 'c2', ...scoreCandidate(current, candidate) };
    expect(scored.gtin_exact).toBe(true);
    expect(scored.source_ref_exact).toBe(false);
    expect(scored.contradiction_score).toBe(0);
    expect(chooseResolutionRoute([scored])).toMatchObject({ action: 'LINK', reason: 'exact_gtin' });
  });

  test('deux candidats forts differents forcent la revue', () => {
    const candidates = [
      { canonical_entity_id: 'a', source_ref_exact: true, gtin_exact: false, contradiction_score: 0, support_score: 0.5, coverage_score: 0.5 },
      { canonical_entity_id: 'b', source_ref_exact: false, gtin_exact: true, contradiction_score: 0, support_score: 0.9, coverage_score: 0.9 },
    ];
    expect(chooseResolutionRoute(candidates)).toMatchObject({ action: 'REVIEW_REQUIRED', reason: 'ambiguous_strong_candidates' });
  });

  test('aucun candidat alloue une nouvelle identite canonique', () => {
    expect(chooseResolutionRoute([])).toEqual({ action: 'NEW_CANONICAL', candidate: null, reason: 'no_candidate' });
  });
});
