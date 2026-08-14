/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

jest.mock('../../js/b-store.js', () => ({ dom: {} }));

const { apiDownload } = require('../../js/b-utils.js');

describe('apiDownload', () => {
  afterEach(() => {
    delete window.K;
  });

  it('délègue à la couche binaire centrale avec les options', async () => {
    const expected = { blob: new Blob(['pdf']), filename: 'facture.pdf' };
    window.K = {
      request: jest.fn(),
      download: jest.fn().mockResolvedValue(expected),
    };

    await expect(apiDownload('/api/auth/me/documents/doc-1/download', { timeoutMs: 20000 }))
      .resolves.toBe(expected);
    expect(window.K.download).toHaveBeenCalledWith(
      '/api/auth/me/documents/doc-1/download',
      { timeoutMs: 20000 }
    );
  });

  it('refuse si le client API central n’est pas chargé', () => {
    expect(() => apiDownload('/api/auth/me/documents/doc-1/download'))
      .toThrow('komerce-api.js manquant');
  });
});
