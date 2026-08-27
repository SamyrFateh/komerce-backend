'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({
  convertToKMF: jest.fn(),
  scanCandidate: jest.fn(),
}));
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../services/catalog-enrichment', () => ({ enrichAndApply: jest.fn() }));
jest.mock('../../services/catalog-candidate-product-service', () => ({
  createDraftProductFromSourcingCandidate: jest.fn(),
}));
jest.mock('../../services/catalog-promotion', () => ({ promoteCatalog: jest.fn() }));

const {
  SourcingCandidateActionError,
  requireCandidate,
  updateCandidate,
  watchlistCandidate,
  rejectCandidate,
} = require('../../services/sourcing-candidate-actions');

describe('sourcing-candidate-actions', () => {
  it('refuse une devise hors whitelist avant toute lecture ou écriture', async () => {
    const q = { query: jest.fn() };
    await expect(updateCandidate('candidate-1', { currency: 'BTC' }, 'admin-1', q))
      .rejects.toMatchObject({ name: 'SourcingCandidateActionError', status: 400, code: 'candidate_currency_invalid' });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('requireCandidate expose une erreur métier stable quand le candidat n’existe pas', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(requireCandidate('missing', q))
      .rejects.toMatchObject({ status: 404, code: 'candidate_not_found' });
  });

  it('watchlist écrit l’état puis journalise la transition avec l’acteur', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'candidate-1', state: 'scanned' }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    await expect(watchlistCandidate('candidate-1', 'admin-1', q))
      .resolves.toEqual({ state: 'watchlist' });

    expect(q.query.mock.calls[1][0]).toContain("SET state='watchlist'");
    expect(q.query.mock.calls[1][1]).toEqual(['admin-1', 'candidate-1']);
    expect(q.query.mock.calls[2][0]).toContain("'state_change'");
    expect(q.query.mock.calls[2][1]).toEqual(['candidate-1', 'scanned', 'admin-1']);
  });

  it('reject journalise la raison et conserve la transition d’état', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'candidate-1', state: 'scanned' }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    const result = await rejectCandidate('candidate-1', 'Douane', 'admin-1', q);
    expect(result).toEqual({ state: 'rejected', rejected_reason: 'Douane' });
    expect(q.query.mock.calls[1][1]).toEqual(['Douane', 'admin-1', 'candidate-1']);
    expect(q.query.mock.calls[2][1]).toEqual(['candidate-1', 'scanned', 'Douane', 'admin-1']);
  });

  it('exporte une classe d’erreur typée pour les façades HTTP', () => {
    const err = new SourcingCandidateActionError(409, 'Conflict', 'candidate_conflict');
    expect(err).toMatchObject({ name: 'SourcingCandidateActionError', status: 409, code: 'candidate_conflict' });
  });
});
