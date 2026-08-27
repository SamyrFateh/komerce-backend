'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const {
  hasDecisionSignalGlobalAuthority,
  requireDecisionSignalGlobalAuthority,
} = require('../../middleware/require-decision-signal-global-authority');

beforeEach(() => jest.clearAllMocks());

test('authority is persisted in decision_signal_global_access_grants and ignores revoked grants', async () => {
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  await expect(hasDecisionSignalGlobalAuthority('user-1')).resolves.toBe(true);
  expect(mockQuery.mock.calls[0][0]).toContain('decision_signal_global_access_grants');
  expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL');
  expect(mockQuery.mock.calls[0][1]).toEqual(['user-1']);
});

test('admin role alone does not imply Action Center authority', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const req = { user: { id: 'admin-1', role: 'admin' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await requireDecisionSignalGlobalAuthority(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'decision_signal_global_access_denied' }));
  expect(next).not.toHaveBeenCalled();
});

test('resolved authority on the request avoids another DB read', async () => {
  const req = { user: { id: 'admin-1' }, decisionSignalGlobalAuthority: true };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  requireDecisionSignalGlobalAuthority(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(mockQuery).not.toHaveBeenCalled();
});
