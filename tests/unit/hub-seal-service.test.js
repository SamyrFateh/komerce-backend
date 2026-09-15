'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let query;
let readiness;
let parcelTransition;
let orderTransition;
let computeStatus;

jest.mock('../../db', () => ({
  withTransaction: async (work) => work({ query: (...args) => query(...args) }),
}));

jest.mock('../../services/hub-allocation-service', () => ({
  assertParcelPhysicalReadiness: (...args) => readiness(...args),
}));

jest.mock('../../services/parcel-operations', () => ({
  transitionParcelStatus: (...args) => parcelTransition(...args),
}));

jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => orderTransition(...args),
}));

jest.mock('../../utils/parcels', () => ({
  computeOrderStatus: (...args) => computeStatus(...args),
}));

const { sealHubParcel } = require('../../services/hub-seal-service');

beforeEach(() => {
  query = jest.fn();
  readiness = jest.fn();
  parcelTransition = jest.fn();
  orderTransition = jest.fn();
  computeStatus = jest.fn();
});

test('seal cible exactement le parcel demandé et propage les erreurs du guard', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'p-1', order_id: 'o-anchor', status: 'preparation', reference: 'P1' }] });
  readiness.mockRejectedValue(Object.assign(new Error('incident'), { code: 'HUB_INCIDENT_BLOCKING' }));

  await expect(sealHubParcel('p-1', 'u-1')).rejects.toMatchObject({ code: 'HUB_INCIDENT_BLOCKING' });
  expect(parcelTransition).not.toHaveBeenCalled();
});

test('seal transitionne un seul parcel puis recalcule toutes les commandes membres', async () => {
  query
    .mockResolvedValueOnce({ rows: [{ id: 'p-1', order_id: 'o-anchor', status: 'preparation', reference: 'P1' }] })
    .mockResolvedValueOnce({ rows: [] }) // parcel_events insert
    .mockResolvedValueOnce({ rows: [{ order_id: 'o-1' }, { order_id: 'o-2' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'p-1', status: 'shipped', type: 'standard' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'p-1', status: 'shipped', type: 'standard' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'p-1', status: 'shipped', reference: 'P1' }] });
  readiness.mockResolvedValue({ ready: true, parcel_id: 'p-1', market_id: 'm-1', relais_id: 'r-1' });
  parcelTransition.mockResolvedValue({ ok: true });
  computeStatus.mockReturnValue('shipped');
  orderTransition.mockResolvedValue({ newStatus: 'shipped' });

  const result = await sealHubParcel('p-1', 'u-1', 'sealed');
  expect(result.status).toBe(200);
  expect(parcelTransition).toHaveBeenCalledTimes(1);
  expect(parcelTransition).toHaveBeenCalledWith(expect.anything(), 'p-1', 'shipped');
  expect(orderTransition).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.some(([sql]) => String(sql).includes('safeSyncScanToParcels'))).toBe(false);
});

test('parcel non preparation ne peut pas être scellé', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'p-1', status: 'shipped', reference: 'P1' }] });
  await expect(sealHubParcel('p-1', 'u-1')).resolves.toMatchObject({ status: 400 });
  expect(readiness).not.toHaveBeenCalled();
});
