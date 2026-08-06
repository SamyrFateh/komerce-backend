'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { resolveFrozenClassification } = require('../../services/customs-classification');

describe('customs-classification', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resout une categorie active et fige les taux numeriques', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{
        key: 'food', sh_code: '1901', douane_pct: '5.5', tva_pct: '10', taxe_add_pct: '1',
      }] }),
    };

    await expect(resolveFrozenClassification(client, 'food')).resolves.toEqual({
      customs_category_key: 'food',
      sh_code: '1901',
      douane_pct: 5.5,
      tva_pct: 10,
      taxe_add_pct: 1,
      classification_defaulted: false,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('WHERE key = $1'), ['food']);
  });

  it('retombe sur default si la categorie produit manque', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ key: 'default', sh_code: null, douane_pct: 0, tva_pct: 0, taxe_add_pct: 0 }] }),
    };

    await expect(resolveFrozenClassification(client, 'unknown')).resolves.toEqual({
      customs_category_key: 'default',
      sh_code: null,
      douane_pct: 0,
      tva_pct: 0,
      taxe_add_pct: 0,
      classification_defaulted: true,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1][1]).toEqual(['default']);
  });

  it('interroge directement default si aucune categorie produit nest fournie', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{
        key: 'default', sh_code: '0000', douane_pct: '0', tva_pct: '0', taxe_add_pct: '0',
      }] }),
    };

    await expect(resolveFrozenClassification(client, null)).resolves.toMatchObject({
      customs_category_key: 'default',
      classification_defaulted: true,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][1]).toEqual(['default']);
  });

  it('retourne un repli zero non bloquant si meme default est absent', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(resolveFrozenClassification(client, null)).resolves.toEqual({
      customs_category_key: null,
      sh_code: null,
      douane_pct: 0,
      tva_pct: 0,
      taxe_add_pct: 0,
      classification_defaulted: true,
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});
