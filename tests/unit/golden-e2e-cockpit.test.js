'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/hub-inbound-reconciliation', () => ({
  reconcileHubInbound: jest.fn().mockResolvedValue({ verdict:'INBOUND_MATCHED' }),
}));
jest.mock('../../services/customer-handoff-reconciliation', () => ({
  reconcileCustomerHandoff: jest.fn().mockResolvedValue({ verdict:'HANDOFF_MATCHED' }),
}));
jest.mock('../../services/order-financial-closure-reconciliation', () => ({
  reconcileOrderFinancialClose: jest.fn().mockResolvedValue({ verdict:'FINANCIAL_CLOSE_MATCHED' }),
}));

const { projectGoldenEvidence } = require('../../services/golden-e2e-cockpit');

test('projette 10 preuves réelles sans mutation DB', async () => {
  const db = { query: jest.fn()
    .mockResolvedValueOnce({ rows:[{ ok:true }] })
    .mockResolvedValueOnce({ rows:[{ ok:true }] })
    .mockResolvedValueOnce({ rows:[{ id:'fulfillment-1', tracking_number:'TRK-1' }] })
    .mockResolvedValueOnce({ rows:[{ ok:true }] })
    .mockResolvedValueOnce({ rows:[{ ok:true }] }) };
  const result = await projectGoldenEvidence(db, {
    id:'order-1', reference:'K-GOLDEN-TEST', status:'collected', payment_status:'paid',
  });
  expect(result.steps).toHaveLength(10);
  expect(result.steps.every(step => step.passed)).toBe(true);
  expect(result.verdict).toBe('FINANCIAL_CLOSE_MATCHED');
  expect(result.doctrine).toBe('read_only_projection_no_business_authority');
  expect(db.query).toHaveBeenCalledTimes(5);
  expect(db.query.mock.calls.every(([sql]) => /^SELECT/i.test(sql.trim()))).toBe(true);
});
