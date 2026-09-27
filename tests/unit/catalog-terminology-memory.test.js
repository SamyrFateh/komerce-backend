'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  normalizeTerm,
  candidateNgrams,
  loadTerminologyHints,
} = require('../../services/catalog-terminology-memory');

describe('catalog terminology memory', () => {
  test('normalizes accents and punctuation without destroying technical tokens', () => {
    expect(normalizeTerm('Étui USB-C / Bluetooth 5.3')).toBe('etui usb-c / bluetooth 5.3');
  });

  test('builds relevant ngrams from structured source facts', () => {
    const grams = candidateNgrams({
      title: 'Wireless charging stand',
      materials: ['Aluminum alloy'],
      option_axes: [{ display_name: 'Color', values: ['Gold', 'Silver'] }],
    });
    expect(grams).toContain('wireless charging');
    expect(grams).toContain('charging stand');
    expect(grams).toContain('aluminum alloy');
    expect(grams).toContain('gold');
  });

  test('keeps Komerce curated glossary separate and higher-authority from external references', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{ term_source: 'power bank', term_fr: 'batterie externe', note: 'canonique' }],
        })
        .mockResolvedValueOnce({
          rows: [{
            source: 'termium_plus',
            source_record_id: 'T-1',
            dataset_domain: 'electronics-informatics',
            subject_en: 'Portable Power Sources',
            subject_fr: 'Sources portatives d’énergie',
            term_en: 'power bank',
            term_fr: 'bloc d’alimentation portatif',
            source_license: 'Open Government Licence – Canada',
          }],
        }),
    };

    const result = await loadTerminologyHints(q, { title: 'Fast power bank charger' });
    expect(result.curated[0]).toMatchObject({
      authority: 'KOMERCE_CURATED',
      term_fr: 'batterie externe',
    });
    expect(result.references[0]).toMatchObject({
      authority: 'EXTERNAL_REFERENCE',
      source: 'termium_plus',
    });
  });
});
