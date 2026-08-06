'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../utils/logger', () => ({
  child: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
}));

const { createStoreCredit, getAvailableCredits, applyCredits } = require('../../utils/store-credits');

describe('store-credits', () => {
  it('refuse createStoreCredit car le module est deprecie au profit du wallet', async () => {
    await expect(createStoreCredit()).rejects.toThrow('store-credits.js est DEPRECATED');
  });

  it('retourne un solde vide pour getAvailableCredits sans casser les imports legacy', async () => {
    await expect(getAvailableCredits('user-001')).resolves.toEqual({ credits: [], total_kmf: 0 });
  });

  it('refuse applyCredits car le module est deprecie au profit du wallet', async () => {
    await expect(applyCredits()).rejects.toThrow('store-credits.js est DEPRECATED');
  });
});
